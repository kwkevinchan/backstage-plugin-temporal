/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  EDGE_LANE_GAP,
  FRAME_GAP,
  FRAME_PADDING,
  FRAME_TOP,
  NODE_HEIGHT,
  NODE_WIDTH,
  NodeSize,
  OFFSET,
  setStackSidePad,
  STACK_GAP,
  STACK_SIDE,
  StepLayout,
} from './geometry';

/** Room between a column and a part placed beside the boxes of a frame. */
const BESIDE_GAP = 2 * (FRAME_GAP + EDGE_LANE_GAP);
/** Room between the boxes of a frame and the lanes beside them. */
const BESIDE_LANE_GAP = 2 * FRAME_GAP;

/*
 * Frames whose boxes are stacked in rows, one below the other. Each such
 * frame is laid out on its own, from the innermost one out: its rows are
 * laid out left to right and put one below the other, and the frame is
 * then one box of the given size in the layout of the boxes around it.
 */

/** A box of a graph to lay out. */
export interface LayoutNode {
  id: string;
  size?: NodeSize;
  /** The frame around it. */
  parent?: string;
  /**
   * In a stacked frame: the box an arrow into this one comes from. It goes
   * in a row of its own, below the row of that box.
   */
  after?: string;
}

/**
 * A frame around steps, laid out with them: the steps (and frames) whose
 * `parent` it is, plus room for its title bar.
 */
export interface LayoutFrame {
  id: string;
  /** The frame around this one. */
  parent?: string;
  /**
   * The boxes and frames in it are stacked in rows, in the order of their
   * first box in the list of boxes: each frame in a row of its own, the
   * boxes between them in a row together.
   */
  stacked?: boolean;
  /** As `LayoutNode.after`. */
  after?: string;
}

/** An arrow of a layout with stacked frames as boxes. */
export interface LayoutEdge {
  source: string;
  target: string;
  /** The ends in a stacked frame laid out as one box (`source`, `target`). */
  inner?: { source?: string; target?: string };
}

/** A stacked frame laid out on its own. */
export interface StackBlock {
  width: number;
  height: number;
  /** Top left of the frame (0, 0) and of each box and frame in it. */
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, NodeSize>;
  /** The gaps between the rows of the frame and of the stacked ones in it. */
  stackGaps: Map<string, number[]>;
}

/** Lays out a graph in which stacked frames are boxes of a given size. */
export type LayOutBlocks = (
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number | undefined,
  options: {
    frames: LayoutFrame[];
    lineUpRows?: boolean;
    blocks: Map<string, StackBlock>;
    /**
     * Move a box off an arrow in its row that runs through it. Set for
     * the rows of a stacked frame, where a taller box lined up on the same
     * middle hides the arrow.
     */
    clearThrough?: boolean;
  },
) => StepLayout;

/**
 * Lays out a graph with stacked frames (`LayoutFrame.stacked`). The rows of
 * a stacked frame start at its left side. The boxes and frames placed below
 * a box that an arrow into them comes from (`after`) go in a row right after
 * the row of that box, one for all the boxes of that row: each part where
 * its arrow turns down next to its box, from the left and at least twice
 * `FRAME_GAP` after the part before, moved left as far as needed (and
 * possible) to stay within the widest other row, and a lane at a time to
 * where the arrow into it turns a lane away from where the arrows out of
 * and into the other boxes above, and out of the parts before it, do. The
 * gap between two rows is a lane taller for each arrow in it past three,
 * counting arrows that leave or enter the frame through it. The side
 * channel is a lane wider for each arrow past the rows, past three.
 * The rest of the graph is laid out with `layOut`, each stacked frame as
 * one box.
 */
export function layoutStacked(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  width: number | undefined,
  options: { frames: LayoutFrame[]; lineUpRows?: boolean },
  layOut: LayOutBlocks,
): StepLayout {
  const { frames } = options;
  const frameById = new Map(frames.map(f => [f.id, f]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const parentOf = new Map<string, string | undefined>();
  for (const f of frames) parentOf.set(f.id, f.parent);
  for (const n of nodes) parentOf.set(n.id, n.parent);
  // The order of a box or frame: of its first box in `nodes`.
  const first = new Map<string, number>();
  nodes.forEach((n, i) => {
    let id: string | undefined = n.id;
    for (let depth = 0; id !== undefined && depth <= frames.length; depth++) {
      first.set(id, Math.min(first.get(id) ?? Infinity, i));
      id = parentOf.get(id);
    }
  });
  const orderOf = (id: string) => first.get(id) ?? Infinity;
  const childrenOf = new Map<string | undefined, string[]>();
  for (const [id, parent] of parentOf) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => orderOf(a) - orderOf(b));
  }
  const children = (id: string | undefined) => childrenOf.get(id) ?? [];
  const afterOf = (id: string) =>
    (frameById.get(id) ?? nodeById.get(id))?.after;
  const blocks = new Map<string, StackBlock>();
  /** Boxes and frames placed beside the boxes of a frame, without a lane. */
  const unplaced: string[] = [];
  /** Side channels wider than `STACK_SIDE`, by the block they belong to. */
  const padsOfBlock = new WeakMap<StackBlock, Map<string, number>>();
  const rememberPad = (block: StackBlock, frame: string, pad: number) => {
    if (pad <= STACK_SIDE) return;
    let pads = padsOfBlock.get(block);
    if (!pads) {
      pads = new Map();
      padsOfBlock.set(block, pads);
    }
    pads.set(frame, pad);
  };

  /**
   * The boxes and frames of `top` (of one frame) laid out together, with
   * everything in them; the stacked frames among them laid out on their
   * own. With `chain`, unconnected parts follow each other left to right.
   */
  function region(
    top: string[],
    regionWidth: number | undefined,
    chain = false,
    clearThrough = false,
  ): StepLayout {
    const regionNodes: LayoutNode[] = [];
    const regionFrames: LayoutFrame[] = [];
    const regionBlocks = new Map<string, StackBlock>();
    const repOf = new Map<string, string>();
    /** Boxes and frames beside the boxes of a frame, by that frame. */
    const besides = new Map<string, string[]>();
    const visit = (id: string, parent?: string, rep?: string) => {
      if (rep !== undefined) {
        repOf.set(id, rep);
        for (const child of children(id)) visit(child, undefined, rep);
        return;
      }
      repOf.set(id, id);
      const frame = frameById.get(id);
      if (frame?.stacked) {
        const block = blockOf(id);
        regionBlocks.set(id, block);
        regionNodes.push({
          id,
          size: { width: block.width, height: block.height },
          ...(parent ? { parent } : {}),
        });
        for (const child of children(id)) visit(child, undefined, id);
      } else if (frame) {
        regionFrames.push(parent ? { id, parent } : { id });
        for (const child of children(id)) {
          if (afterOf(child) === undefined) visit(child, id);
          else besides.set(id, [...(besides.get(id) ?? []), child]);
        }
      } else {
        const { size } = nodeById.get(id)!;
        regionNodes.push({
          id,
          ...(size ? { size } : {}),
          ...(parent ? { parent } : {}),
        });
      }
    };
    for (const id of top) visit(id);
    regionNodes.sort((a, b) => orderOf(a.id) - orderOf(b.id));
    const regionEdges: LayoutEdge[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const source = repOf.get(e.source);
      const target = repOf.get(e.target);
      if (!source || !target || source === target) continue;
      const key = `${source}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const inner = {
        ...(source !== e.source ? { source: e.source } : {}),
        ...(target !== e.target ? { target: e.target } : {}),
      };
      regionEdges.push(
        Object.keys(inner).length > 0
          ? { source, target, inner }
          : { source, target },
      );
    }
    if (chain) regionEdges.push(...chainParts(regionNodes, regionEdges));
    const layout = layOut(regionNodes, regionEdges, regionWidth, {
      frames: regionFrames,
      lineUpRows: options.lineUpRows,
      blocks: regionBlocks,
      clearThrough,
    });
    for (const [frame, items] of besides) {
      placeBeside(layout, frame, items, clearThrough);
    }
    // The stacked frames, laid out on their own, where their boxes are.
    const sizes = new Map(layout.sizes ?? []);
    const stackGaps = new Map(layout.stackGaps ?? []);
    for (const [id, block] of regionBlocks) {
      const at = layout.positions.get(id)!;
      for (const [inner, p] of block.positions) {
        layout.positions.set(inner, { x: at.x + p.x, y: at.y + p.y });
      }
      for (const [inner, size] of block.sizes) sizes.set(inner, size);
      for (const [inner, gaps] of block.stackGaps) {
        stackGaps.set(
          inner,
          gaps.map(g => at.y + g),
        );
      }
    }
    if (sizes.size > 0) layout.sizes = sizes;
    if (stackGaps.size > 0) layout.stackGaps = stackGaps;
    for (const block of regionBlocks.values()) {
      for (const [frame, pad] of padsOfBlock.get(block) ?? []) {
        setStackSidePad(layout, frame, pad);
      }
    }
    return layout;
  }

  /** The child of `frame` that `id` is in (or is). */
  const childOf = (frame: string, id: string) => {
    let at: string | undefined = id;
    for (let depth = 0; at !== undefined && depth <= frames.length; depth++) {
      const parent = parentOf.get(at);
      if (parent === frame) return at;
      at = parent;
    }
    return undefined;
  };

  /**
   * The parts of `items` (of `frame`) that arrows connect, in the order of
   * their first items.
   */
  function connected(items: string[], frame: string): string[][] {
    const partOf = new Map(items.map(id => [id, id]));
    const find = (id: string): string =>
      partOf.get(id) === id ? id : find(partOf.get(id)!);
    for (const e of edges) {
      const [a, b] = [childOf(frame, e.source), childOf(frame, e.target)];
      if (!a || !b || !partOf.has(a) || !partOf.has(b)) continue;
      partOf.set(find(a), find(b));
    }
    const parts = new Map<string, string[]>();
    for (const id of items) {
      const root = find(id);
      parts.set(root, [...(parts.get(root) ?? []), id]);
    }
    return [...parts.values()];
  }

  /**
   * Puts the boxes and frames placed beside the boxes of `frame` (`after`,
   * in a frame that is not stacked) into its laid out frame: the boxes of
   * the frame stay as they are, on their line; each part of the boxes
   * beside them goes in a lane below them, starting a column after
   * the box an arrow into it comes from (`after`) and, when it leads back
   * to a box of the frame, reaching to a column before that box (a frame
   * is drawn that wide; the boxes from that one on move right when the
   * part needs more room). Parts that run side by side go in lanes of
   * their own, one below the other, the shorter ones nearer the boxes, and
   * a part goes in a lane farther down only around the parts in the lanes
   * between it and the boxes.
   */
  function placeBeside(
    layout: StepLayout,
    frame: string,
    items: string[],
    clearThrough: boolean,
  ) {
    const sizes = new Map(layout.sizes ?? []);
    const size = (id: string) =>
      sizes.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    const at = (id: string) => layout.positions.get(id)!;
    const main = children(frame).filter(id => !items.includes(id));
    const rect = (id: string) => ({
      left: at(id).x,
      right: at(id).x + size(id).width,
      top: at(id).y,
      bottom: at(id).y + size(id).height,
    });
    /** The column of a box of the frame: the boxes of the frame across it. */
    const column = (id: string) => {
      const r = rect(id);
      const across = main
        .map(rect)
        .filter(o => o.left < r.right && r.left < o.right);
      return {
        left: Math.min(...across.map(o => o.left)),
        right: Math.max(...across.map(o => o.right)),
      };
    };
    const shift = (from: number, dx: number) => {
      for (const [id, p] of layout.positions) {
        const child = childOf(frame, id);
        if (!child || child === frame || items.includes(child)) continue;
        if (rect(child).left >= from - 0.5) {
          layout.positions.set(id, { x: p.x + dx, y: p.y });
        }
      }
    };
    const parts = connected(items, frame).map(part => {
      const inPart = (id: string) => part.includes(childOf(frame, id) ?? '');
      const source = childOf(frame, afterOf(part[0])!)!;
      const targets = edges
        .filter(e => inPart(e.source) && !inPart(e.target))
        .map(e => childOf(frame, e.target))
        .filter((id): id is string => id !== undefined && main.includes(id));
      const laid = normalized(region(part, undefined, true, clearThrough));
      return { part, source, targets, laid, x: 0, right: 0, y: 0 };
    });
    /** The first box after the source that the part leads back to. */
    const targetOf = (part: (typeof parts)[number]) => {
      const after = part.targets.filter(
        t => rect(t).left > rect(part.source).right,
      );
      return after.length === 0
        ? undefined
        : after.reduce((a, b) => (rect(b).left < rect(a).left ? b : a));
    };
    /** The gap after (or before) a column, to the next column of the frame. */
    const gapAfter = (right: number) => {
      const next = main.map(rect).filter(o => o.left > right - 0.5);
      return next.length === 0
        ? BESIDE_GAP
        : Math.max(2 * FRAME_GAP, Math.min(...next.map(o => o.left)) - right);
    };
    const gapBefore = (left: number) => {
      const before = main.map(rect).filter(o => o.right < left + 0.5);
      return before.length === 0
        ? BESIDE_GAP
        : Math.max(2 * FRAME_GAP, left - Math.max(...before.map(o => o.right)));
    };
    // The part starts a column gap after the column of its source; the boxes
    // from the target on move right when it needs more room than the columns
    // between them.
    // The gaps as the columns were laid out.
    const gapOut = new Map(
      parts.map(p => [p.source, gapAfter(column(p.source).right)]),
    );
    const gapIn = new Map(
      parts.flatMap(p => {
        const target = targetOf(p);
        return target ? [[target, gapBefore(column(target).left)]] : [];
      }),
    );
    const startOf = (part: (typeof parts)[number]) =>
      column(part.source).right + gapOut.get(part.source)!;
    /**
     * True when an arrow out of a box of the frame left of `x` runs on past
     * the column there: out of the frame, or into a box past the column
     * right after its own.
     */
    const crossed = (x: number) => {
      const before = main.map(rect).filter(o => o.right < x + 0.5);
      if (before.length === 0) return false;
      const last = Math.max(...before.map(o => o.right));
      return edges.some(e => {
        const from = childOf(frame, e.source);
        if (!from || items.includes(from)) return false;
        if (rect(from).right >= x + 0.5) return false;
        const to = childOf(frame, e.target);
        if (to === undefined) return true;
        if (items.includes(to) || rect(to).left < x - 0.5) return false;
        return column(from).right < last - 0.5;
      });
    };
    for (let moved = true, i = 0; moved && i <= parts.length; i++) {
      moved = false;
      for (const part of parts) {
        const target = targetOf(part);
        if (!target) continue;
        const left = column(target).left;
        const need =
          startOf(part) + part.laid.width + gapIn.get(target)! - left;
        if (need > 0.5) {
          if (crossed(left)) {
            // An arrow of the frame runs on past where the boxes move: the
            // groups go in a row below the frame instead.
            unplaced.push(...items);
          }
          shift(left, need);
          moved = true;
        }
      }
    }
    for (const part of parts) {
      const target = targetOf(part);
      part.x = startOf(part);
      part.right = target
        ? column(target).left - gapIn.get(target)!
        : part.x + part.laid.width;
    }
    // Lanes: the turns down out of the source and up into the target, or
    // the right side of a part that leads nowhere (`ends`).
    const span = (part: (typeof parts)[number]) => {
      const target = targetOf(part);
      return {
        from: (column(part.source).right + part.x) / 2,
        to: target ? (part.right + column(target).left) / 2 : part.right,
        ends: !target,
      };
    };
    const lanes: { part: (typeof parts)[number]; lane: number }[] = [];
    // The shorter parts first, nearer the boxes.
    const order = [...parts].sort((a, b) => {
      const [p, q] = [span(a), span(b)];
      return p.to - p.from - (q.to - q.from) || p.from - q.from;
    });
    for (const part of order) {
      const own = span(part);
      const apart = (o: { from: number; to: number }) =>
        o.to + FRAME_GAP <= own.from || own.to + FRAME_GAP <= o.from;
      // An arrow up past the right side of a part a frame gap from it.
      const within = (
        inner: { from: number; to: number; ends: boolean },
        outer: { from: number; to: number },
      ) =>
        inner.from >= outer.from &&
        inner.to + (inner.ends ? FRAME_GAP : 0) <= outer.to;
      const fits = (lane: number) =>
        lanes.every(other => {
          const o = span(other.part);
          // Arrows down from two boxes would turn at one place.
          if (
            other.part.source !== part.source &&
            Math.abs(o.from - own.from) < EDGE_LANE_GAP
          ) {
            return false;
          }
          if (other.lane === lane) return apart(o);
          if (other.lane < lane) return apart(o) || within(o, own);
          return apart(o) || within(own, o);
        });
      let lane = 0;
      while (lane < parts.length && !fits(lane)) lane++;
      if (lane < parts.length) {
        lanes.push({ part, lane });
      } else {
        // No lane where its arrows pass clear of the others: none of the
        // parts goes beside the boxes.
        unplaced.push(...items);
        lanes.push({
          part,
          lane: Math.max(0, ...lanes.map(l => l.lane + 1)),
        });
      }
    }
    // The lanes one below the other, below the boxes.
    let below = Math.max(...main.map(rect).map(r => r.bottom));
    for (let lane = 0; lane < parts.length; lane++) {
      const inLane = lanes.filter(l => l.lane === lane);
      if (inLane.length === 0) continue;
      const height = Math.max(...inLane.map(l => l.part.laid.height));
      const top = below + BESIDE_LANE_GAP;
      for (const { part } of inLane) {
        part.y = top + (height - part.laid.height) / 2;
      }
      below = top + height;
    }
    // The parts where they go; a frame that the arrow back out of the part
    // leaves reaches to the column before the target.
    const stackGaps = new Map(layout.stackGaps ?? []);
    for (const part of parts) {
      const { laid } = part;
      for (const [id, p] of laid.positions) {
        layout.positions.set(id, { x: part.x + p.x, y: part.y + p.y });
      }
      for (const [id, s] of laid.sizes ?? []) sizes.set(id, s);
      for (const [id, gaps] of laid.stackGaps ?? []) {
        stackGaps.set(
          id,
          gaps.map(g => part.y + g),
        );
      }
      for (const [id, pad] of laid.stackSidePads ?? []) {
        setStackSidePad(layout, id, pad);
      }
      // Reaching to the column before the target: a part of one box or
      // frame is drawn that wide; of more, the last ones move right.
      const extra = part.right - part.x - laid.width;
      if (extra > 0.5) {
        const last = part.part.filter(id => {
          const p = laid.positions.get(id)!;
          return p.x + size(id).width >= laid.width - 0.5;
        });
        for (const item of last) {
          if (part.part.length === 1) {
            sizes.set(item, { ...size(item), width: size(item).width + extra });
            continue;
          }
          for (const [id, p] of layout.positions) {
            if (id !== item && childOf(item, id) === undefined) continue;
            if (!laid.positions.has(id)) continue;
            layout.positions.set(id, { x: p.x + extra, y: p.y });
          }
        }
      }
    }
    // The frame around them all.
    const all = [...main, ...items].map(rect);
    const box = rect(frame);
    const left = Math.min(box.left, ...all.map(r => r.left - FRAME_PADDING));
    const top = Math.min(box.top, ...all.map(r => r.top - FRAME_TOP));
    const right = Math.max(box.right, ...all.map(r => r.right + FRAME_PADDING));
    const bottom = Math.max(
      box.bottom,
      ...all.map(r => r.bottom + FRAME_PADDING),
    );
    layout.positions.set(frame, { x: left, y: top });
    sizes.set(frame, { width: right - left, height: bottom - top });
    layout.sizes = sizes;
    if (stackGaps.size > 0) layout.stackGaps = stackGaps;
  }

  /** A stacked frame laid out on its own, at (0, 0). */
  function blockOf(frame: string): StackBlock {
    const cached = blocks.get(frame);
    if (cached) return cached;
    /**
     * A row: boxes and frames of `frame`; or (`units`) the boxes and frames
     * placed below a box of the row of `anchor`, by that box.
     */
    type Row = {
      items: string[];
      anchor?: string;
      units?: Map<string, string[]>;
    };
    const rows: Row[] = [];
    const placed: Row[] = [];
    for (const id of children(frame)) {
      const after = afterOf(id);
      const anchor = after === undefined ? undefined : childOf(frame, after);
      if (after !== undefined && anchor !== undefined && anchor !== id) {
        let row = placed.find(r => r.anchor === anchor);
        if (!row) {
          row = { items: [], anchor, units: new Map() };
          placed.push(row);
        }
        row.items.push(id);
        row.units!.set(after, [...(row.units!.get(after) ?? []), id]);
        continue;
      }
      const last = rows[rows.length - 1];
      if (!frameById.has(id) && last && !frameById.has(last.items[0])) {
        last.items.push(id);
      } else {
        rows.push({ items: [id] });
      }
    }
    // Placed below a box that is itself placed: a row of their own at the end.
    for (const row of [...placed]) {
      if (rows.some(r => r.items.includes(row.anchor!))) continue;
      placed.splice(placed.indexOf(row), 1);
      rows.push({ items: row.items });
    }
    // Placed below boxes of one row: one row.
    for (const row of [...placed]) {
      const home = rows.find(r => r.items.includes(row.anchor!));
      const earlier = placed.find(
        r => r !== row && home!.items.includes(r.anchor!),
      );
      if (!earlier || placed.indexOf(earlier) > placed.indexOf(row)) continue;
      earlier.items.push(...row.items);
      for (const [after, items] of row.units!) {
        earlier.units!.set(after, [
          ...(earlier.units!.get(after) ?? []),
          ...items,
        ]);
      }
      placed.splice(placed.indexOf(row), 1);
    }
    // Rows placed below a box go right after the row of that box.
    const ordered: Row[] = [];
    for (const row of rows) {
      ordered.push(row);
      for (const below of placed) {
        if (row.items.includes(below.anchor!)) ordered.push(below);
      }
    }
    const lay = (items: string[], chain: boolean) =>
      normalized(region(items, undefined, chain, true));
    const laidRows = new Map(
      rows.map(row => [
        row,
        lay(
          row.items,
          row.items.every(id => !frameById.has(id)),
        ),
      ]),
    );
    const widest = Math.max(0, ...rows.map(r => laidRows.get(r)!.width));
    for (const row of placed) {
      const above = laidRows.get(
        rows.find(r => r.items.includes(row.anchor!))!,
      )!;
      // Each part starts where the arrow into it turns down next to the box
      // above, from the left; after the part before it, the arrow out of
      // that one and the arrow into this one turn a lane apart.
      const parts = [...row.units!].flatMap(([after, items]) => {
        const at = above.positions.get(after);
        const turn = at
          ? at.x +
            (above.sizes?.get(after)?.width ?? NODE_WIDTH) +
            OFFSET +
            FRAME_GAP
          : 0;
        // Groups placed below one box are parts of their own.
        return connected(items, frame).map(part => ({
          laid: lay(part, true),
          turn,
          after,
        }));
      });
      parts.sort((a, b) => a.turn - b.turn);
      let end = -Infinity;
      const xs = parts.map(part => {
        const x = Math.max(0, part.turn, end + 2 * FRAME_GAP);
        end = x + part.laid.width;
        return x;
      });
      // As far as the widest other row allows.
      const shift = Math.min(xs[0], Math.max(0, end - widest));
      // The arrow into a part turns down a lane away from where arrows turn
      // out of and into the other boxes and frames of the row above, and out
      // of the parts before it: the part moves a lane at a time, within the
      // widest row where it can.
      let last = -Infinity;
      parts.forEach((part, k) => {
        const turns = [
          ...[...above.positions]
            .filter(([id]) => id !== part.after)
            .flatMap(([id, p]) => [
              p.x + (above.sizes?.get(id)?.width ?? NODE_WIDTH) + OFFSET,
              p.x - OFFSET,
            ]),
          ...parts
            .slice(0, k)
            .map((before, j) => xs[j] + before.laid.width + OFFSET),
        ];
        const clear = (x: number) =>
          !turns.some(t => Math.abs(x - FRAME_GAP - t) < EDGE_LANE_GAP);
        const start = Math.max(xs[k] - shift, last);
        const within = (x: number) =>
          x + part.laid.width <= Math.max(widest, start + part.laid.width);
        // The nearest clear place right within the widest row or left,
        // else right past the widest row.
        const lanes = Array.from(
          { length: turns.length + 1 },
          (_, lane) => (lane + 1) * EDGE_LANE_GAP,
        );
        const near = lanes
          .flatMap(d => [start + d, start - d])
          .find(
            o => clear(o) && (o > start ? within(o) : o >= Math.max(0, last)),
          );
        xs[k] = clear(start)
          ? start
          : near ?? lanes.map(d => start + d).find(clear) ?? start;
        last = xs[k] + part.laid.width + 2 * FRAME_GAP;
      });
      const joinedSizes = new Map<string, NodeSize>();
      const joinedGaps = new Map<string, number[]>();
      const joined: StepLayout = {
        positions: new Map(),
        sizes: joinedSizes,
        stackGaps: joinedGaps,
        width: xs[xs.length - 1] + parts[parts.length - 1].laid.width,
        height: Math.max(...parts.map(part => part.laid.height)),
        wrapped: false,
      };
      parts.forEach((part, k) => {
        const x = xs[k];
        for (const [id, p] of part.laid.positions) {
          joined.positions.set(id, { x: x + p.x, y: p.y });
        }
        for (const [id, size] of part.laid.sizes ?? []) {
          joinedSizes.set(id, size);
        }
        for (const [id, list] of part.laid.stackGaps ?? []) {
          joinedGaps.set(id, list);
        }
        for (const [id, pad] of part.laid.stackSidePads ?? []) {
          setStackSidePad(joined, id, pad);
        }
      });
      laidRows.set(row, joined);
    }
    const laid = ordered.map(row => laidRows.get(row)!);
    const block: StackBlock = {
      width: 0,
      height: 0,
      positions: new Map([[frame, { x: 0, y: 0 }]]),
      sizes: new Map(),
      stackGaps: new Map(),
    };
    // The arrows in each gap between two rows: into a later row, in the gap
    // below the row of the source (and, past rows, the one above the row of
    // the target); into an earlier row, in the gap above the row of the
    // source. A gap holds three lanes; it is a lane taller for each more.
    const rowOfItem = new Map(
      ordered.flatMap((row, i) => row.items.map(id => [id, i] as const)),
    );
    const inGap = laid.map(() => new Set<string>());
    for (const e of edges) {
      const a = rowOfItem.get(childOf(frame, e.source) ?? '');
      const b = rowOfItem.get(childOf(frame, e.target) ?? '');
      if (a === undefined || b === undefined || a === b) continue;
      const key = `${e.source}\u0000${e.target}`;
      if (a < b) {
        inGap[a].add(key);
        inGap[b - 1].add(key);
      } else {
        inGap[a - 1].add(key);
      }
    }
    // Arrows that leave this frame, or enter it, through a gap: this is the
    // innermost stacked frame of that end, and a box of the row is in the
    // way out to the side (or in from it). They take a lane in that gap too.
    const innermostStacked = (id: string) => {
      let at = parentOf.get(id);
      for (let depth = 0; at !== undefined && depth <= frames.length; depth++) {
        if (frameById.get(at)?.stacked) return at;
        at = parentOf.get(at);
      }
      return undefined;
    };
    const wayBlocked = (
      rowLayout: StepLayout,
      id: string,
      toward: 'left' | 'right',
    ) => {
      const p = rowLayout.positions.get(id);
      if (!p) return false;
      const size = rowLayout.sizes?.get(id) ?? {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
      const y = p.y + size.height / 2;
      const [x1, x2] =
        toward === 'right' ? [p.x + size.width, rowLayout.width] : [0, p.x];
      for (const [other, q] of rowLayout.positions) {
        if (other === id) continue;
        const o = rowLayout.sizes?.get(other) ?? {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        };
        const holds =
          q.x <= p.x + 0.5 &&
          q.y <= p.y + 0.5 &&
          q.x + o.width >= p.x + size.width - 0.5 &&
          q.y + o.height >= p.y + size.height - 0.5 &&
          (o.width > size.width + 0.5 || o.height > size.height + 0.5);
        if (holds) continue;
        if (q.y < y && q.y + o.height > y && q.x < x2 && q.x + o.width > x1) {
          return true;
        }
      }
      return false;
    };
    for (const e of edges) {
      const fromHere = innermostStacked(e.source) === frame;
      const toHere = innermostStacked(e.target) === frame;
      if (fromHere === toHere) continue;
      const key = `${e.source}\u0000${e.target}`;
      if (fromHere) {
        const row = rowOfItem.get(childOf(frame, e.source) ?? '');
        if (
          row !== undefined &&
          row < laid.length - 1 &&
          wayBlocked(laid[row], e.source, 'right')
        ) {
          inGap[row].add(key);
        }
      } else {
        const row = rowOfItem.get(childOf(frame, e.target) ?? '');
        if (
          row !== undefined &&
          row > 0 &&
          wayBlocked(laid[row], e.target, 'left')
        ) {
          inGap[row - 1].add(key);
        }
      }
    }
    // Arrows past rows in between run in the side channel. Three lanes fit
    // in `STACK_SIDE`; each further lane widens the channel.
    const sideSources = new Set<string>();
    const sideTargets = new Set<string>();
    for (const e of edges) {
      const a = rowOfItem.get(childOf(frame, e.source) ?? '');
      const b = rowOfItem.get(childOf(frame, e.target) ?? '');
      if (a === undefined || b === undefined || Math.abs(a - b) <= 1) continue;
      sideSources.add(e.source);
      sideTargets.add(e.target);
    }
    const sideLanes = Math.max(sideSources.size, sideTargets.size);
    const sidePad = STACK_SIDE + Math.max(0, sideLanes - 3) * EDGE_LANE_GAP;
    const gapHeight = (i: number) =>
      STACK_GAP + Math.max(0, inGap[i].size - 3) * EDGE_LANE_GAP;
    const gaps: number[] = [];
    let y = 0;
    let right = 0;
    for (const [i, row] of laid.entries()) {
      for (const [id, p] of row.positions) {
        block.positions.set(id, {
          x: sidePad + p.x,
          y: FRAME_TOP + y + p.y,
        });
      }
      for (const [id, size] of row.sizes ?? []) block.sizes.set(id, size);
      const top = FRAME_TOP + y;
      for (const [id, list] of row.stackGaps ?? []) {
        block.stackGaps.set(
          id,
          list.map(g => top + g),
        );
      }
      right = Math.max(right, row.width);
      y += row.height;
      if (i < laid.length - 1) {
        gaps.push(FRAME_TOP + y + gapHeight(i) / 2);
        y += gapHeight(i);
      }
    }
    block.width = sidePad + right + sidePad;
    block.height = FRAME_TOP + y + FRAME_PADDING;
    block.sizes.set(frame, { width: block.width, height: block.height });
    block.stackGaps.set(frame, gaps);
    rememberPad(block, frame, sidePad);
    for (const row of laid) {
      for (const [id, pad] of row.stackSidePads ?? [])
        rememberPad(block, id, pad);
    }
    blocks.set(frame, block);
    return block;
  }

  const layout = region(children(undefined), width);
  if (unplaced.length > 0) layout.unplacedBeside = unplaced;
  return layout;
}

/**
 * A laid out part of a graph moved to (0, 0): the top left of its boxes and
 * frames, with its width and height.
 */
function normalized(layout: StepLayout) {
  const size = (id: string) =>
    layout.sizes?.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [id, p] of layout.positions) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x + size(id).width);
    bottom = Math.max(bottom, p.y + size(id).height);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, NodeSize>();
  for (const [id, p] of layout.positions) {
    positions.set(id, { x: p.x - left, y: p.y - top });
    sizes.set(id, size(id));
  }
  const stackGaps = new Map<string, number[]>();
  for (const [id, gaps] of layout.stackGaps ?? []) {
    stackGaps.set(
      id,
      gaps.map(g => g - top),
    );
  }
  const next: StepLayout = {
    positions,
    sizes,
    stackGaps,
    width: right - left,
    height: bottom - top,
    wrapped: false,
    ...(layout.stackSidePads
      ? { stackSidePads: new Map(layout.stackSidePads) }
      : {}),
  };
  return next;
}

/**
 * Arrows that put the unconnected parts of a row of boxes one after the
 * other, in the order of their first boxes: from the last box of each part
 * to the first box of the next one.
 */
function chainParts(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutEdge[] {
  const part = new Map(nodes.map(n => [n.id, n.id]));
  const find = (id: string): string => {
    const up = part.get(id)!;
    if (up === id) return id;
    const root = find(up);
    part.set(id, root);
    return root;
  };
  for (const e of edges) {
    if (part.has(e.source) && part.has(e.target)) {
      part.set(find(e.source), find(e.target));
    }
  }
  // `nodes` are in order: the parts in the order of their first boxes.
  const parts = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    parts.set(root, [...(parts.get(root) ?? []), n.id]);
  }
  const list = [...parts.values()];
  return list.slice(1).map((ids, i) => {
    const before = list[i];
    return { source: before[before.length - 1], target: ids[0] };
  });
}
