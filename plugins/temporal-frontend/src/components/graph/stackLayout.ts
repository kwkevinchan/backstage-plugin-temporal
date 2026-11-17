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
  copyStackSidePads,
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
  stackSidePadEntries,
  StepLayout,
} from './geometry';

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
  const blocks = new Map<string, StackBlock>();
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
        for (const child of children(id)) visit(child, id);
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
    const afterOf = (id: string) =>
      (frameById.get(id) ?? nodeById.get(id))?.after;
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
        for (const [id, pad] of stackSidePadEntries(part.laid)) {
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
      for (const [id, pad] of stackSidePadEntries(row))
        rememberPad(block, id, pad);
    }
    blocks.set(frame, block);
    return block;
  }

  return region(children(undefined), width);
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
  };
  copyStackSidePads(layout, next);
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
