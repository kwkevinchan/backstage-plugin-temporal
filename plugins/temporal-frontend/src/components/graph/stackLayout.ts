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
  FRAME_GAP,
  FRAME_PADDING,
  FRAME_TOP,
  FRAME_WRAP_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  NodeSize,
  OFFSET,
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
  },
) => StepLayout;

/** Space between the rows of a stacked frame: arrows run in it. */
export const STACK_GAP = FRAME_WRAP_GAP;
/**
 * Space at the sides of a stacked frame: an arrow into another row turns
 * there, `FRAME_GAP` clear of the frame and of the frames in it.
 */
export const STACK_SIDE = 2 * FRAME_GAP;

/**
 * Lays out a graph with stacked frames (`LayoutFrame.stacked`). The rows of
 * a stacked frame start at its left side, but a row placed below the box an
 * arrow into it comes from (`after`) starts where that arrow turns down
 * next to it, as far as the widest other row allows. The rest of the graph
 * is laid out with `layOut`, each stacked frame as one box.
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

  /**
   * The boxes and frames of `top` (of one frame) laid out together, with
   * everything in them; the stacked frames among them laid out on their
   * own. With `chain`, unconnected parts follow each other left to right.
   */
  function region(
    top: string[],
    regionWidth: number | undefined,
    chain = false,
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

  /** A stacked frame laid out on its own, at (0, 0). */
  function blockOf(frame: string): StackBlock {
    const cached = blocks.get(frame);
    if (cached) return cached;
    type Row = { items: string[]; after?: string };
    const rows: Row[] = [];
    const placed: Row[] = [];
    const afterOf = (id: string) =>
      (frameById.get(id) ?? nodeById.get(id))?.after;
    for (const id of children(frame)) {
      const after = afterOf(id);
      const anchor = after === undefined ? undefined : childOf(frame, after);
      if (after !== undefined && anchor !== undefined && anchor !== id) {
        const row = placed.find(r => r.after === after);
        if (row) row.items.push(id);
        else placed.push({ items: [id], after });
        continue;
      }
      const last = rows[rows.length - 1];
      if (
        !frameById.has(id) &&
        last &&
        !last.after &&
        !frameById.has(last.items[0])
      ) {
        last.items.push(id);
      } else {
        rows.push({ items: [id] });
      }
    }
    // Rows placed below a box go right after the row of that box.
    const ordered: Row[] = [];
    for (const row of rows) {
      ordered.push(row);
      for (const below of placed) {
        if (row.items.includes(childOf(frame, below.after!)!)) {
          ordered.push(below);
        }
      }
    }
    for (const below of placed) {
      if (!ordered.includes(below)) ordered.push(below);
    }

    const laid = ordered.map(row => {
      const run = row.items.every(id => !frameById.has(id));
      return normalized(region(row.items, undefined, run));
    });
    const widest = Math.max(
      0,
      ...laid.filter((_, i) => !ordered[i].after).map(l => l.width),
    );
    const block: StackBlock = {
      width: 0,
      height: 0,
      positions: new Map([[frame, { x: 0, y: 0 }]]),
      sizes: new Map(),
      stackGaps: new Map(),
    };
    const gaps: number[] = [];
    let y = 0;
    let right = 0;
    for (const [i, row] of laid.entries()) {
      let x = 0;
      const { after } = ordered[i];
      if (after !== undefined) {
        // Where the arrow from the box above turns down next to it.
        const above = laid.find((l, j) => j < i && l.positions.has(after));
        const at = above?.positions.get(after);
        if (above && at) {
          const turn = at.x + (above.sizes.get(after)?.width ?? NODE_WIDTH);
          x = Math.max(
            0,
            Math.min(turn + OFFSET + FRAME_GAP, widest - row.width),
          );
        }
      }
      for (const [id, p] of row.positions) {
        block.positions.set(id, {
          x: STACK_SIDE + x + p.x,
          y: FRAME_TOP + y + p.y,
        });
      }
      for (const [id, size] of row.sizes) block.sizes.set(id, size);
      const top = FRAME_TOP + y;
      for (const [id, list] of row.stackGaps) {
        block.stackGaps.set(
          id,
          list.map(g => top + g),
        );
      }
      right = Math.max(right, x + row.width);
      y += row.height;
      if (i < laid.length - 1) {
        gaps.push(FRAME_TOP + y + STACK_GAP / 2);
        y += STACK_GAP;
      }
    }
    block.width = STACK_SIDE + right + STACK_SIDE;
    block.height = FRAME_TOP + y + FRAME_PADDING;
    block.sizes.set(frame, { width: block.width, height: block.height });
    block.stackGaps.set(frame, gaps);
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
  return {
    positions,
    sizes,
    stackGaps,
    width: right - left,
    height: bottom - top,
  };
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
