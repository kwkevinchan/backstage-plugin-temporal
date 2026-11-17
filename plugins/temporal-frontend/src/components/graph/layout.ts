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

import dagre from '@dagrejs/dagre';
import type { WorkflowGraphEdge, WorkflowGraphNode } from '../../common';
import { isMarkerStep } from '../steps';

import {
  boxSize,
  FRAME_GAP,
  FRAME_PADDING,
  FRAME_TOP,
  FRAME_WRAP_GAP,
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  NodeSize,
  StepLayout,
} from './geometry';
import {
  frameEdgeCorners,
  FrameEdgeData,
  frameInsets,
  Point,
  routeRowGaps,
} from './frameEdge';
import {
  LayoutEdge,
  LayoutFrame,
  LayoutNode,
  layoutStacked,
  StackBlock,
} from './stackLayout';

export {
  boxSize,
  EDGE_LANE_GAP,
  FRAME_GAP,
  FRAME_PADDING,
  FRAME_TITLE_HEIGHT,
  FRAME_TOP,
  FRAME_WRAP_GAP,
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './geometry';
export type { NodeSize, StepLayout } from './geometry';
export type { LayoutFrame, LayoutNode } from './stackLayout';
/** A model call: three lines (name, model, tokens and tools). */
export const LLM_NODE_WIDTH = 240;
export const LLM_NODE_HEIGHT = 86;
/** A tool call of a model call: a smaller box. */
export const TOOL_NODE_WIDTH = 180;
export const TOOL_NODE_HEIGHT = 52;
/** Widest box, for the columns of a wrapped graph. */
const MAX_NODE_WIDTH = LLM_NODE_WIDTH;

/** Size of the box of a step: model calls are larger, tool calls smaller. */
export function stepSize(node: { llm?: unknown; tool?: unknown }): NodeSize {
  if (node.llm) return { width: LLM_NODE_WIDTH, height: LLM_NODE_HEIGHT };
  if (node.tool) return { width: TOOL_NODE_WIDTH, height: TOOL_NODE_HEIGHT };
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}
/** Space between the columns, between the steps of a column, and around. */
const COLUMN_GAP = 56;
const ROW_GAP = 24;
/** Space between two rows of a wrapped graph. */
const WRAP_GAP = 40;

/** Smallest font size of a step box, in pixels at zoom 1. */
export const NODE_FONT_SIZE = 13;
/**
 * Smallest zoom the graph opens with: the step text stays at least 12px.
 * The view can still be zoomed out by hand or with the fit view control.
 */
export const READABLE_ZOOM = 0.93;
/**
 * Height limits of the graph area. A small graph is centered in the
 * smallest area; a taller one scrolls inside the largest.
 */
export const MIN_GRAPH_HEIGHT = 400;
export const MAX_GRAPH_HEIGHT = 720;

/**
 * Steps shown in the graph. Internal steps are left out, and so are
 * markers (side effects, version and patch markers) unless `showMarkers`
 * is set. The arrows through a left out step are joined, so the graph
 * stays connected.
 */
export function visibleSteps(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  options: { showMarkers?: boolean } = {},
) {
  const hidden = nodes.filter(
    n => n.internal || (!options.showMarkers && isMarkerStep(n)),
  );
  return hideSteps(nodes, edges, new Set(hidden.map(n => n.id)));
}

/**
 * Leaves out the steps in `hiddenIds` and joins the arrows through them,
 * so the graph stays connected.
 */
export function hideSteps<N extends { id: string }>(
  nodes: N[],
  edges: WorkflowGraphEdge[],
  hiddenIds: Set<string>,
): { nodes: N[]; edges: WorkflowGraphEdge[] } {
  const hidden = nodes.filter(n => hiddenIds.has(n.id));
  if (hidden.length === 0) return { nodes, edges };

  const out = new Map<string, Set<string>>();
  const into = new Map<string, Set<string>>();
  const link = (source: string, target: string) => {
    if (source === target) return;
    if (!out.has(source)) out.set(source, new Set());
    if (!into.has(target)) into.set(target, new Set());
    out.get(source)!.add(target);
    into.get(target)!.add(source);
  };
  for (const e of edges) link(e.source, e.target);
  const original = new Set(edges.map(e => `${e.source}\u0000${e.target}`));

  // Join the arrows into and out of each hidden step, then drop it.
  for (const step of hidden) {
    const sources = [...(into.get(step.id) ?? [])];
    const targets = [...(out.get(step.id) ?? [])];
    for (const s of sources) out.get(s)?.delete(step.id);
    for (const t of targets) into.get(t)?.delete(step.id);
    out.delete(step.id);
    into.delete(step.id);
    for (const s of sources) for (const t of targets) link(s, t);
  }

  // A joined arrow is left out when another path leads to the same step.
  const reachable = (from: string, to: string) => {
    const seen = new Set([from]);
    const queue = [...(out.get(from) ?? [])].filter(n => n !== to);
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(out.get(next) ?? []));
    }
    return false;
  };
  const result: WorkflowGraphEdge[] = [];
  for (const [source, targets] of out) {
    for (const target of targets) {
      const joined = !original.has(`${source}\u0000${target}`);
      if (joined && reachable(source, target)) continue;
      result.push({ id: `${source}->${target}`, source, target });
    }
  }
  const shown = nodes.filter(n => !hiddenIds.has(n.id));
  const order = new Map(shown.map((n, i) => [n.id, i]));
  result.sort(
    (a, b) =>
      (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0) ||
      (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0),
  );
  return { nodes: shown, edges: result };
}

/** Space between the rows of a graph laid out top to bottom. */
const RANK_GAP_TB = 40;

/**
 * Positions of the steps, left to right, laid out with dagre (layered
 * graph drawing). Parallel steps end up in the same column.
 *
 * With `width`, a graph wider than that is wrapped like text: its columns
 * continue on a next row, so long runs stay readable without zooming out.
 *
 * With `direction: 'TB'` the steps go top to bottom (parallel steps side by
 * side) and the graph is not wrapped: the definition graph next to its YAML.
 *
 * @alpha
 */
export function layoutSteps(
  nodes: { id: string; size?: NodeSize }[],
  edges: { source: string; target: string }[],
  width?: number,
  options: { direction?: 'LR' | 'TB' } = {},
): StepLayout {
  return layoutGraph(nodes, edges, width, options);
}

/**
 * {@link layoutSteps} with frames around some of the steps, any number of
 * frames deep: dagre lays out the steps as a compound graph, which keeps
 * the steps of a frame together and the steps of other frames out of it.
 * The frame boxes are then drawn around their steps, with the title bar at
 * the top. A wrapped graph never splits an outermost frame across rows.
 *
 * The boxes of a stacked frame (`LayoutFrame.stacked`) go in rows one below
 * the other instead (see `layoutStacked`).
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  width?: number,
  options: {
    direction?: 'LR' | 'TB';
    frames?: LayoutFrame[];
    /** False leaves the rows of frames as dagre laid them out; for tests. */
    lineUpRows?: boolean;
  } = {},
): StepLayout {
  const frames = options.frames ?? [];
  if (options.direction !== 'TB' && frames.some(f => f.stacked)) {
    return layoutStacked(
      nodes,
      edges,
      width,
      { frames, lineUpRows: options.lineUpRows },
      layoutBlocks,
    );
  }
  return layoutBlocks(nodes, edges, width, { ...options, frames });
}

/**
 * {@link layoutGraph} without stacked frames: the stacked frames of
 * `blocks`, laid out on their own, are boxes of their size in it. Arrows
 * into and out of them are lined up with the boxes in them they lead to.
 */
function layoutBlocks(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number | undefined,
  options: {
    direction?: 'LR' | 'TB';
    frames?: LayoutFrame[];
    lineUpRows?: boolean;
    blocks?: Map<string, StackBlock>;
    /** Move a box off a straight arrow that runs through it. */
    clearThrough?: boolean;
  },
): StepLayout {
  const topDown = options.direction === 'TB';
  const frames = options.frames ?? [];
  const blocks = options.blocks ?? new Map<string, StackBlock>();
  const sizeOf = (node: { size?: NodeSize }) =>
    node.size ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
  const compound = frames.length > 0 && !topDown;
  // Stacked frames are frames too, for the rows of a wrapped graph.
  const framed = compound || (blocks.size > 0 && !topDown);
  const graph = new dagre.graphlib.Graph({ compound });
  graph.setGraph({
    rankdir: topDown ? 'TB' : 'LR',
    nodesep: topDown ? COLUMN_GAP / 2 : ROW_GAP,
    ranksep: topDown ? RANK_GAP_TB : COLUMN_GAP,
    marginx: MARGIN,
    marginy: MARGIN,
    ...(compound ? frameSpacing(frames) : {}),
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, sizeOf(node));
  }
  if (compound) {
    for (const frame of frames) graph.setNode(frame.id, {});
    for (const frame of frames) {
      if (frame.parent) graph.setParent(frame.id, frame.parent);
    }
    for (const node of nodes) {
      if (node.parent) graph.setParent(node.id, node.parent);
    }
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, NodeSize>();
  for (const node of nodes) {
    const placed = graph.node(node.id) as { x: number; y: number } | undefined;
    const box = sizeOf(node);
    if (node.size) sizes.set(node.id, box);
    // dagre returns the center; React Flow expects the top left corner.
    positions.set(node.id, {
      x: (placed?.x ?? 0) - box.width / 2,
      y: (placed?.y ?? 0) - box.height / 2,
    });
  }
  const size = graph.graph() as { width?: number; height?: number };
  const layout: StepLayout = {
    positions,
    width: size.width ?? NODE_WIDTH + 2 * MARGIN,
    height: size.height ?? NODE_HEIGHT + 2 * MARGIN,
    wrapped: false,
  };
  if (framed) {
    const framedGraph: FramedGraph = {
      layout,
      nodes,
      edges,
      frames,
      sizes,
      sizeOf,
      width,
      blocks,
      outerBlocks: nodes.filter(n => blocks.has(n.id) && !n.parent),
    };
    if (options.lineUpRows !== false) alignFrameRows(framedGraph);
    if (options.clearThrough) clearStraightThrough(framedGraph);
    if (blocks.size > 0) alignToBlocks(framedGraph);
    return settle(framedGraph, positions);
  }
  if (sizes.size > 0) layout.sizes = sizes;
  if (width === undefined || nodes.length === 0 || topDown) return layout;
  // Fits as it is, at a readable zoom.
  if (layout.width * READABLE_ZOOM <= width) return layout;
  return wrapColumns(layout, width);
}

/**
 * A compound graph as dagre laid it out (`layout`), before its columns are
 * spread out and its frames placed.
 */
interface FramedGraph {
  layout: StepLayout;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  frames: LayoutFrame[];
  /** Sizes of the boxes that are not of the default size. */
  sizes: Map<string, NodeSize>;
  sizeOf: (node: { size?: NodeSize }) => NodeSize;
  /** The width to wrap the graph into. */
  width?: number;
  /** Stacked frames laid out on their own, boxes of this graph. */
  blocks: Map<string, StackBlock>;
  /** The stacked frames in no frame of this graph. */
  outerBlocks: LayoutNode[];
}

/**
 * The graph with the boxes at `positions`: its columns spread out and its
 * frames placed, in one row.
 */
function withFrames(
  graph: FramedGraph,
  positions: Map<string, { x: number; y: number }>,
): StepLayout {
  const { nodes, frames, sizeOf } = graph;
  const sizes = new Map(graph.sizes);
  const layout: StepLayout = { ...graph.layout, positions: new Map(positions) };
  layout.width += spreadFrameColumns(layout.positions, nodes, frames, sizeOf);
  placeFrames(layout, nodes, frames, sizes);
  if (sizes.size > 0) layout.sizes = sizes;
  return layout;
}

/**
 * The frames that are in no other frame, with the stacked frames laid out
 * as boxes that are in none.
 */
const outerFramesOf = (graph: FramedGraph) => [
  ...graph.frames.filter(f => !f.parent).map(f => f.id),
  ...graph.outerBlocks.map(n => n.id),
];

/** The graph with the boxes at `positions`, as it is drawn. */
function settle(
  graph: FramedGraph,
  positions: Map<string, { x: number; y: number }>,
): StepLayout {
  const layout = withFrames(graph, positions);
  const { width } = graph;
  if (width === undefined || graph.nodes.length === 0) return layout;
  // Fits as it is, at a readable zoom.
  if (layout.width * READABLE_ZOOM <= width) return layout;
  return wrapColumns(layout, width, outerFramesOf(graph));
}

/**
 * The row each box ends up in when the graph is wrapped, or nothing when
 * it fits in one row. The rows depend on the columns only, so they are
 * known before the boxes of the frames are lined up.
 */
function wrappedRows(graph: FramedGraph): Map<string, number> | undefined {
  const { width, nodes } = graph;
  if (width === undefined || nodes.length === 0) return undefined;
  const layout = withFrames(graph, graph.layout.positions);
  if (layout.width * READABLE_ZOOM <= width) return undefined;
  const plan = planRows(layout, width, outerFramesOf(graph));
  if (plan.rowCount === 1) return undefined;
  return new Map(
    nodes.map(n => [
      n.id,
      plan.rowOf.get(plan.pieceOf(n.id, layout.positions.get(n.id)!))!,
    ]),
  );
}

/**
 * Spacing of a compound graph. dagre puts the border of a frame on ranks of
 * its own, `2 × depth + 1` ranks for each column: the space between the
 * ranks is cut so that the columns stay about as far apart as without
 * frames, with room for the padding of the frames between them. Frame
 * borders count as dummy boxes in dagre (`edgesep`): the space between a
 * border and a step leaves room for the title bar above the steps.
 */
function frameSpacing(frames: LayoutFrame[]) {
  const depth = Math.max(...frameDepths(frames).values()) + 1;
  const factor = 2 * depth + 1;
  return {
    ranksep: Math.max(16, Math.ceil(COLUMN_GAP / factor)),
    edgesep: 2 * FRAME_TOP - ROW_GAP,
  };
}

/**
 * Lines up the boxes of each frame that holds one row of boxes: no frame in
 * it, and no two of its boxes in one column. dagre can move a box of such a
 * row down to make room for a box outside the frame in its column (a signal
 * above the frame), which leaves a step in the row. The boxes move to the
 * middle that most of them share, as little as needed to keep every box
 * within the top and bottom of the row as dagre laid it out, so the frame
 * never gets larger. A row is lined up only when more of the arrows of the
 * boxes that move end up straight than before, and no arrow, as it is
 * drawn in the finished graph, then runs through or along a box it did not
 * run through or along before (dagre can have moved a box aside for an
 * arrow that passes the frame).
 */
function alignFrameRows(graph: FramedGraph) {
  const { nodes, frames, sizeOf } = graph;
  const positions = graph.layout.positions;
  const rows = wrappedRows(graph);
  const holdsFrames = new Set(frames.map(f => f.parent));
  let through: Map<string, number> | undefined;
  const drawing: ArrowDrawing = {
    parentOf: new Map([
      ...frames.map(f => [f.id, f.parent] as const),
      ...nodes.map(n => [n.id, n.parent] as const),
    ]),
    corners: new Map(),
  };
  for (const frame of frames) {
    if (holdsFrames.has(frame.id)) continue;
    const row = nodes
      .filter(n => n.parent === frame.id)
      .sort((a, b) => positions.get(a.id)!.x - positions.get(b.id)!.x);
    if (row.length < 2) continue;
    const centers = row.map(n =>
      Math.round(positions.get(n.id)!.x + sizeOf(n).width / 2),
    );
    if (new Set(centers).size !== row.length) continue;
    const top = Math.min(...row.map(n => positions.get(n.id)!.y));
    const bottom = Math.max(
      ...row.map(n => positions.get(n.id)!.y + sizeOf(n).height),
    );
    const tallest = Math.max(...row.map(n => sizeOf(n).height));
    // The middle most boxes share, the leftmost one's on a tie.
    const middles = row.map(n => positions.get(n.id)!.y + sizeOf(n).height / 2);
    const shared = middles.map(
      m => middles.filter(o => Math.abs(o - m) < 0.5).length,
    );
    const anchor = middles[shared.indexOf(Math.max(...shared))];
    const middle = Math.min(
      Math.max(anchor, top + tallest / 2),
      bottom - tallest / 2,
    );
    const lined = new Map(positions);
    let moved = false;
    for (const node of row) {
      const p = positions.get(node.id)!;
      const y = middle - sizeOf(node).height / 2;
      if (Math.abs(y - p.y) < 0.5) continue;
      lined.set(node.id, { x: p.x, y });
      moved = true;
    }
    if (!moved || !straightens(graph, rows, positions, lined)) continue;
    // No arrow may run through a box it ran along or past before, nor along
    // a box it ran past.
    const before = through ?? arrowsThroughBoxes(graph, positions, drawing);
    const after = arrowsThroughBoxes(graph, lined, drawing);
    through = before;
    if ([...after].some(([hit, level]) => level > (before.get(hit) ?? 0))) {
      continue;
    }
    for (const node of row) positions.set(node.id, lined.get(node.id)!);
    through = after;
  }
}

/**
 * Moves a box up or down, by as little as clears it, when a straight arrow
 * between two other boxes runs through it. The ends stay, so the arrow stays
 * straight. A box moves only when the new place overlaps no other box. Used
 * for a row of a stacked frame: lining that row up puts boxes of different
 * heights on one middle, and the arrow then runs through the taller one.
 */
function clearStraightThrough(graph: FramedGraph) {
  const { nodes, edges, sizeOf } = graph;
  const positions = graph.layout.positions;
  const size = (id: string) => {
    const node = nodes.find(n => n.id === id);
    return node ? sizeOf(node) : { width: NODE_WIDTH, height: NODE_HEIGHT };
  };
  const middle = (id: string) => positions.get(id)!.y + size(id).height / 2;
  for (const edge of edges) {
    if (!positions.has(edge.source) || !positions.has(edge.target)) continue;
    const y1 = middle(edge.source);
    const y2 = middle(edge.target);
    if (Math.abs(y1 - y2) >= 0.5) continue;
    const y = (y1 + y2) / 2;
    const source = positions.get(edge.source)!;
    const target = positions.get(edge.target)!;
    const [x1, x2] = [source.x + size(edge.source).width, target.x].sort(
      (a, b) => a - b,
    );
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      // A stacked frame is one box here; moving it would shift a whole row.
      if (graph.blocks.has(node.id)) continue;
      const p = positions.get(node.id);
      if (!p) continue;
      const box = size(node.id);
      if (p.x >= x2 || p.x + box.width <= x1) continue;
      if (y <= p.y || y >= p.y + box.height) continue;
      const tryMove = (dy: number) => {
        const top = p.y + dy;
        const bottom = top + box.height;
        return !nodes.some(other => {
          if (other.id === node.id) return false;
          const q = positions.get(other.id);
          if (!q) return false;
          const o = size(other.id);
          return (
            p.x < q.x + o.width &&
            q.x < p.x + box.width &&
            top < q.y + o.height &&
            q.y < bottom
          );
        });
      };
      // Clear of the line, then a few pixels more so the stroke is not on
      // the border of the box. The exact clearance if that overlaps a box.
      const offset = (extra: number) => {
        const up = p.y + box.height - y + extra;
        const down = y - p.y + extra;
        const dy = up <= down ? -up : down;
        const otherDy = dy < 0 ? down : -up;
        if (tryMove(dy)) return dy;
        if (tryMove(otherDy)) return otherDy;
        return undefined;
      };
      const chosen = offset(8) ?? offset(0);
      if (chosen === undefined) continue;
      positions.set(node.id, { x: p.x, y: p.y + chosen });
    }
  }
}

/**
 * Moves the boxes and frames in no frame up or down to line up with the
 * boxes they lead to or come from in a stacked frame, laid out as one box
 * (`blocks`): dagre lines them up with the middle of the stacked frame.
 * From the left, each one moves so that its first arrow from a box in a
 * stacked frame, or from a box or frame that moved, is straight; then from
 * the right, each one that did not move, by its first arrow into one. A
 * box or frame moves only when both ends of that arrow are in one row of a
 * wrapped graph, it then stays `ROW_GAP` clear of the other boxes and
 * frames above and below it, and no arrow then runs through or along a box
 * it did not before.
 */
function alignToBlocks(graph: FramedGraph) {
  const { nodes, frames, blocks, edges, sizeOf } = graph;
  const positions = graph.layout.positions;
  const parentOf = new Map<string, string | undefined>([
    ...frames.map(f => [f.id, f.parent] as const),
    ...nodes.map(n => [n.id, n.parent] as const),
  ]);
  const topOf = (id: string) => {
    let at = id;
    for (let depth = 0; depth <= frames.length; depth++) {
      const parent = parentOf.get(at);
      if (parent === undefined) break;
      at = parent;
    }
    return at;
  };
  const members = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const top = topOf(node.id);
    members.set(top, [...(members.get(top) ?? []), node]);
  }
  const height = new Map(nodes.map(n => [n.id, sizeOf(n).height]));
  const middle = (id: string, inner?: string) => {
    const block = blocks.get(id);
    const at = positions.get(id)!.y;
    if (!block || inner === undefined) return at + height.get(id)! / 2;
    const p = block.positions.get(inner)!;
    const size = block.sizes.get(inner)?.height ?? NODE_HEIGHT;
    return at + p.y + size / 2;
  };
  const left = (top: string) =>
    Math.min(...members.get(top)!.map(n => positions.get(n.id)!.x));
  const tops = [...members.keys()].sort((a, b) => left(a) - left(b));
  const drawing: ArrowDrawing = { parentOf, corners: new Map() };
  let through: Map<string, number> | undefined;
  const rows = wrappedRows(graph);
  const top0 = Math.min(...nodes.map(n => positions.get(n.id)!.y));
  const bottom0 = Math.max(
    ...nodes.map(n => positions.get(n.id)!.y + height.get(n.id)!),
  );
  // Lined up: the stacked frames, and what moved to line up with them.
  const lined = new Set<string>(tops.filter(top => blocks.has(top)));
  const lineUp = (top: string, edge: LayoutEdge, into: boolean) => {
    const [own, other] = into
      ? [
          middle(edge.target, edge.inner?.target),
          middle(edge.source, edge.inner?.source),
        ]
      : [
          middle(edge.source, edge.inner?.source),
          middle(edge.target, edge.inner?.target),
        ];
    const dy = other - own;
    if (Math.abs(dy) < 0.5) return true;
    const moved = new Map(positions);
    for (const { id } of members.get(top)!) {
      const p = positions.get(id)!;
      moved.set(id, { x: p.x, y: p.y + dy });
    }
    if (crowds(graph, moved, top, tops)) return false;
    const before = through ?? arrowsThroughBoxes(graph, positions, drawing);
    const after = arrowsThroughBoxes(graph, moved, drawing);
    through = before;
    if ([...after].some(([hit, level]) => level > (before.get(hit) ?? 0))) {
      return false;
    }
    for (const { id } of members.get(top)!) positions.set(id, moved.get(id)!);
    through = after;
    return true;
  };
  // An arrow from or into something lined up: into a stacked frame, only
  // one that leads to a box in it; only in one row of a wrapped graph.
  const linedEnd = (edge: LayoutEdge, end: 'source' | 'target') => {
    const id = edge[end];
    if (blocks.has(id) && topOf(id) === id) {
      if (edge.inner?.[end] === undefined) return false;
    } else if (!lined.has(topOf(id))) return false;
    return !rows || rows.get(edge.source) === rows.get(edge.target);
  };
  // From the left, by the arrows in; then from the right, by those out.
  for (const top of tops) {
    if (lined.has(top)) continue;
    const edge = edges.find(
      e =>
        topOf(e.target) === top &&
        topOf(e.source) !== top &&
        linedEnd(e, 'source'),
    );
    if (edge && lineUp(top, edge, true)) lined.add(top);
  }
  for (const top of [...tops].reverse()) {
    if (lined.has(top)) continue;
    const edge = edges.find(
      e =>
        topOf(e.source) === top &&
        topOf(e.target) !== top &&
        linedEnd(e, 'target'),
    );
    if (edge && lineUp(top, edge, false)) lined.add(top);
  }
  // The graph grows by what moved past its top or bottom.
  const top1 = Math.min(...nodes.map(n => positions.get(n.id)!.y));
  const bottom1 = Math.max(
    ...nodes.map(n => positions.get(n.id)!.y + height.get(n.id)!),
  );
  const down = Math.max(0, top0 - top1);
  if (down > 0) {
    for (const [id, p] of positions) {
      positions.set(id, { x: p.x, y: p.y + down });
    }
  }
  graph.layout.height += down + Math.max(0, bottom1 - bottom0);
}

/**
 * True when the box or frame `top` (in no frame), with the boxes at
 * `positions`, comes closer than `ROW_GAP` to another of `tops` above or
 * below it.
 */
function crowds(
  graph: FramedGraph,
  positions: Map<string, { x: number; y: number }>,
  top: string,
  tops: string[],
) {
  const layout = withFrames(graph, positions);
  const rect = (id: string) => {
    const p = layout.positions.get(id)!;
    const size = boxSize(layout, id);
    return {
      left: p.x,
      top: p.y,
      right: p.x + size.width,
      bottom: p.y + size.height,
    };
  };
  const a = rect(top);
  return tops.some(other => {
    if (other === top) return false;
    const b = rect(other);
    return (
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom + ROW_GAP &&
      b.top < a.bottom + ROW_GAP
    );
  });
}

/**
 * True when more of the arrows into and out of the boxes that move are
 * straight (both ends in one row, at one middle) with the boxes at `after`
 * than at `before`.
 */
function straightens(
  graph: FramedGraph,
  rows: Map<string, number> | undefined,
  before: Map<string, { x: number; y: number }>,
  after: Map<string, { x: number; y: number }>,
) {
  const sizeOf = new Map(graph.nodes.map(n => [n.id, graph.sizeOf(n)]));
  const middle = (id: string, at: typeof before) =>
    at.get(id)!.y + sizeOf.get(id)!.height / 2;
  const moves = (id: string) => before.get(id)!.y !== after.get(id)!.y;
  const straight = (at: typeof before) =>
    graph.edges.filter(
      e =>
        (moves(e.source) || moves(e.target)) &&
        (!rows || rows.get(e.source) === rows.get(e.target)) &&
        Math.abs(middle(e.source, at) - middle(e.target, at)) < 0.5,
    ).length;
  return straight(after) > straight(before);
}

/**
 * How close an arrow may come to a box, other than its ends, before it
 * counts as running along it: an arrow on the side of a box reads as one
 * into it.
 */
const BOX_CLEARANCE = 1.5;
/** An arrow that runs along a box, and one that runs through it. */
const ALONG = 1;
const THROUGH = 2;

/** What the arrows of a graph are drawn from, kept while its rows line up. */
interface ArrowDrawing {
  /** The frame around each box and frame. */
  parentOf: Map<string, string | undefined>;
  /** The corners of the arrows drawn so far, by their ends and turns. */
  corners: Map<string, Point[]>;
}

/**
 * The arrows that run through a box other than their ends (`THROUGH`), or
 * along its side, `BOX_CLEARANCE` from it or closer (`ALONG`), with the
 * boxes at `positions`, as the finished graph draws them: with the turns
 * `frameInsets` gives them, routed by `routeRowGaps` into later rows, along
 * the path of `frameEdgePath`. Only the boxes within the bounds of an arrow
 * are looked at.
 */
function arrowsThroughBoxes(
  graph: FramedGraph,
  positions: Map<string, { x: number; y: number }>,
  drawing: ArrowDrawing,
): Map<string, number> {
  const layout = settle(graph, positions);
  const { parentOf } = drawing;
  // From the top down, to look only at the boxes as high as an arrow.
  const boxes = graph.nodes
    .map(({ id }) => {
      const p = layout.positions.get(id)!;
      const size = boxSize(layout, id);
      return {
        id,
        left: p.x - BOX_CLEARANCE,
        top: p.y - BOX_CLEARANCE,
        right: p.x + size.width + BOX_CLEARANCE,
        bottom: p.y + size.height + BOX_CLEARANCE,
        // Inside the box: not along its border.
        inner: {
          left: p.x + 0.5,
          top: p.y + 0.5,
          right: p.x + size.width - 0.5,
          bottom: p.y + size.height - 0.5,
        },
      };
    })
    .sort((a, b) => a.top - b.top);
  const tallest = Math.max(0, ...boxes.map(b => b.bottom - b.top));
  /** The first box whose top is at `y` or below. */
  const firstBelow = (y: number) => {
    let [low, high] = [0, boxes.length];
    while (low < high) {
      const mid = (low + high) >> 1;
      if (boxes[mid].top < y) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const arrows = routeRowGaps(
    layout,
    graph.edges.map(({ source, target }, i) => ({
      id: String(i),
      source,
      target,
      type: 'frameEdge',
      data: frameInsets(layout, parentOf, source, target),
    })),
  );
  const found = new Map<string, number>();
  for (const { source, target, data } of arrows) {
    const s = layout.positions.get(source)!;
    const t = layout.positions.get(target)!;
    const ends = {
      sourceX: s.x + boxSize(layout, source).width,
      sourceY: (s.y + (s.y + boxSize(layout, source).height)) / 2,
      targetX: t.x,
      targetY: (t.y + (t.y + boxSize(layout, target).height)) / 2,
    };
    // The same arrow is drawn again for each row that lines up.
    const turns = (data ?? {}) as FrameEdgeData;
    const key = `${Object.values(ends)} ${turns.sourceInset} ${
      turns.targetInset
    } ${turns.centerY}`;
    let corners = drawing.corners.get(key);
    if (!corners) {
      corners = frameEdgeCorners(ends, turns);
      drawing.corners.set(key, corners);
    }
    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    for (let i = firstBelow(top - tallest); i < boxes.length; i++) {
      const box = boxes[i];
      if (box.top > bottom) break;
      if (box.right < left || box.left > right || box.bottom < top) continue;
      if (box.id === source || box.id === target) continue;
      if (pathThroughBox(corners, box)) {
        found.set(
          `${source} ${target} ${box.id}`,
          pathThroughBox(corners, box.inner) ? THROUGH : ALONG,
        );
      }
    }
  }
  return found;
}

/** True when a line through `points` runs inside a box or on its border. */
function pathThroughBox(
  points: { x: number; y: number }[],
  box: { left: number; top: number; right: number; bottom: number },
) {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    // The part of the segment inside the box (Liang-Barsky).
    let from = 0;
    let to = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const sides: [number, number][] = [
      [-dx, a.x - box.left],
      [dx, box.right - a.x],
      [-dy, a.y - box.top],
      [dy, box.bottom - a.y],
    ];
    for (const [p, q] of sides) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) from = Math.max(from, t);
      else to = Math.min(to, t);
      if (from > to) return false;
    }
    return true;
  });
}

/** How many frames are around each frame: 0 for an outermost one. */
function frameDepths(frames: LayoutFrame[]): Map<string, number> {
  const parentOf = new Map(frames.map(f => [f.id, f.parent]));
  const depths = new Map<string, number>();
  for (const frame of frames) {
    let d = 0;
    let p = frame.parent;
    while (p && d < frames.length) {
      d++;
      p = parentOf.get(p);
    }
    depths.set(frame.id, d);
  }
  return depths;
}

/**
 * Spaces the columns of a compound graph. dagre leaves about `COLUMN_GAP`
 * between two columns (more in a graph with deeply nested frames) and
 * the padding of the frames is taken from it; here each gap is
 * `COLUMN_GAP` plus `FRAME_PADDING` for each frame border in it, so a box
 * outside a frame is `COLUMN_GAP` from its outermost border, as far as
 * from a box without frames, and two frames next to each other are
 * `COLUMN_GAP` apart. Returns how much wider the graph got.
 */
function spreadFrameColumns(
  positions: Map<string, { x: number; y: number }>,
  nodes: { id: string; size?: NodeSize; parent?: string }[],
  frames: LayoutFrame[],
  sizeOf: (node: { size?: NodeSize }) => NodeSize,
): number {
  const parentOf = new Map(frames.map(f => [f.id, f.parent]));
  const chainOf = new Map<string, string[]>();
  for (const node of nodes) {
    const chain: string[] = [];
    for (let p = node.parent; p && chain.length <= frames.length; ) {
      chain.push(p);
      p = parentOf.get(p);
    }
    chainOf.set(node.id, chain);
  }
  // The boxes of one column share their center.
  const byCenter = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    const center = Math.round(p.x + sizeOf(node).width / 2);
    byCenter.set(center, [...(byCenter.get(center) ?? []), node]);
  }
  const columns = [...byCenter.keys()]
    .sort((a, b) => a - b)
    .map(center => byCenter.get(center)!);
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  columns.forEach((column, i) => {
    for (const node of column) {
      for (const frame of chainOf.get(node.id)!) {
        if (!first.has(frame)) first.set(frame, i);
        last.set(frame, i);
      }
    }
  });
  // Most borders of one box: of frames that end after it, or start before.
  const borders = (
    column: typeof nodes,
    ends: Map<string, number>,
    i: number,
  ) =>
    Math.max(
      0,
      ...column.map(
        n => chainOf.get(n.id)!.filter(f => ends.get(f) === i).length,
      ),
    );
  const left = (column: typeof nodes) =>
    Math.min(...column.map(n => positions.get(n.id)!.x));
  const right = (column: typeof nodes) =>
    Math.max(...column.map(n => positions.get(n.id)!.x + sizeOf(n).width));
  const gaps = columns.map((column, i) =>
    i === 0 ? 0 : left(column) - right(columns[i - 1]),
  );
  let shift = 0;
  for (let i = 1; i < columns.length; i++) {
    const count =
      borders(columns[i - 1], last, i - 1) + borders(columns[i], first, i);
    shift += COLUMN_GAP + FRAME_PADDING * count - gaps[i];
    if (shift === 0) continue;
    for (const node of columns[i]) {
      const p = positions.get(node.id)!;
      positions.set(node.id, { x: p.x + shift, y: p.y });
    }
  }
  return shift;
}

/**
 * Boxes of the frames, innermost first: around the boxes in each frame,
 * with the padding and the title bar. The graph grows when a frame needs
 * more room than dagre left at the edges.
 */
function placeFrames(
  layout: StepLayout,
  nodes: { id: string; size?: NodeSize; parent?: string }[],
  frames: LayoutFrame[],
  sizes: Map<string, NodeSize>,
) {
  const rects = new Map<
    string,
    { left: number; top: number; right: number; bottom: number }
  >();
  const grow = (
    id: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => {
    const r = rects.get(id);
    rects.set(
      id,
      r
        ? {
            left: Math.min(r.left, left),
            top: Math.min(r.top, top),
            right: Math.max(r.right, right),
            bottom: Math.max(r.bottom, bottom),
          }
        : { left, top, right, bottom },
    );
  };
  for (const node of nodes) {
    if (!node.parent) continue;
    const p = layout.positions.get(node.id)!;
    const size = node.size ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    grow(node.parent, p.x, p.y, p.x + size.width, p.y + size.height);
  }
  // Innermost frames first.
  const depths = frameDepths(frames);
  const ordered = [...frames].sort(
    (a, b) => depths.get(b.id)! - depths.get(a.id)!,
  );
  let minX = 0;
  let minY = 0;
  let maxX = layout.width;
  let maxY = layout.height;
  for (const frame of ordered) {
    const inner = rects.get(frame.id);
    if (!inner) continue;
    const box = {
      left: inner.left - FRAME_PADDING,
      top: inner.top - FRAME_TOP,
      right: inner.right + FRAME_PADDING,
      bottom: inner.bottom + FRAME_PADDING,
    };
    rects.set(frame.id, box);
    if (frame.parent) {
      grow(frame.parent, box.left, box.top, box.right, box.bottom);
    }
    layout.positions.set(frame.id, { x: box.left, y: box.top });
    sizes.set(frame.id, {
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
    minX = Math.min(minX, box.left - MARGIN);
    minY = Math.min(minY, box.top - MARGIN);
    maxX = Math.max(maxX, box.right + MARGIN);
    maxY = Math.max(maxY, box.bottom + MARGIN);
  }
  // Frames that reach past the margin move everything right or down.
  if (minX < 0 || minY < 0) {
    for (const [id, p] of layout.positions) {
      layout.positions.set(id, { x: p.x - minX, y: p.y - minY });
    }
  }
  layout.width = maxX - minX;
  layout.height = maxY - minY;
}

/**
 * Moves the columns of a laid out graph into rows of at most `width`.
 * Columns are as wide as the widest box (the column width of a step, or
 * of a model call), and fill each row from the left. Each of `outerFrames` stays in one row, with the boxes in its
 * width. With frames, the rows keep `FRAME_GAP` more at their sides and
 * between them, for the arrows that go around the frames into the next row.
 */
export function wrapColumns(
  layout: StepLayout,
  width: number,
  outerFrames: string[] = [],
): StepLayout {
  const plan = planRows(layout, width, outerFrames);
  if (plan.rowCount === 1) return layout;
  const { side, rowGap, pieceOf, pieceWidth, pieceLeft, rowOf, leftOf } = plan;
  const rowCount = plan.rowCount;

  // Height of each row, from the boxes in it.
  const top = new Array<number>(rowCount).fill(Infinity);
  const bottom = new Array<number>(rowCount).fill(-Infinity);
  for (const [id, p] of layout.positions) {
    const r = rowOf.get(pieceOf(id, p))!;
    top[r] = Math.min(top[r], p.y);
    bottom[r] = Math.max(bottom[r], p.y + boxSize(layout, id).height);
  }
  const offsets: number[] = [];
  const rowGaps: number[] = [];
  let y = MARGIN;
  for (let r = 0; r < rowCount; r++) {
    offsets.push(y);
    if (top[r] !== Infinity) y += bottom[r] - top[r] + rowGap;
    if (r < rowCount - 1) rowGaps.push(y - rowGap / 2);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, p] of layout.positions) {
    const piece = pieceOf(id, p);
    const r = rowOf.get(piece)!;
    positions.set(id, {
      x:
        side +
        leftOf.get(piece)! +
        (piece >= 0
          ? (pieceWidth.get(piece)! - boxSize(layout, id).width) / 2
          : p.x - pieceLeft.get(piece)!),
      y: offsets[r] + (p.y - top[r]),
    });
  }
  const wrapped: StepLayout = {
    positions,
    width: 2 * side + plan.widest,
    height: y - rowGap + MARGIN,
    wrapped: true,
    rowGaps,
  };
  if (layout.sizes) wrapped.sizes = layout.sizes;
  return wrapped;
}

/**
 * The rows of {@link wrapColumns}: the piece (a column, or an outermost
 * frame with the boxes in its width) of each box, and the row and left of
 * each piece.
 */
function planRows(layout: StepLayout, width: number, outerFrames: string[]) {
  const framed = outerFrames.length > 0;
  const side = framed ? MARGIN + FRAME_GAP : MARGIN;
  const rowGap = framed ? FRAME_WRAP_GAP : WRAP_GAP;
  // Boxes of one column share their center; columns of steps are as wide
  // as the widest step when some steps are larger.
  const stepColumn = layout.sizes ? MAX_NODE_WIDTH : NODE_WIDTH;
  const center = (id: string, p: { x: number }) =>
    Math.round(p.x + boxSize(layout, id).width / 2);

  // An outermost frame moves as one piece, with every box whose center is
  // in its width (the frames in it, and the steps above or below it).
  const spans = outerFrames
    .map(id => {
      const p = layout.positions.get(id)!;
      return { left: p.x, right: p.x + boxSize(layout, id).width };
    })
    .sort((a, b) => a.left - b.left);
  const merged: { left: number; right: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.left <= last.right) {
      last.right = Math.max(last.right, span.right);
    } else merged.push({ ...span });
  }
  const spanOf = (x: number) =>
    merged.findIndex(s => x >= s.left && x <= s.right);

  // The pieces: a column of boxes, or a frame with the boxes in its width.
  // A frame piece is keyed by `-1 - index`, a column by its center.
  const pieceWidth = new Map<number, number>();
  const pieceLeft = new Map<number, number>();
  const pieceRight = new Map<number, number>();
  const pieceOf = (id: string, p: { x: number }) => {
    const x = center(id, p);
    const span = spanOf(x);
    return span >= 0 ? -1 - span : x;
  };
  for (const [id, p] of layout.positions) {
    const key = pieceOf(id, p);
    const w = boxSize(layout, id).width;
    if (key >= 0) {
      pieceWidth.set(key, Math.max(pieceWidth.get(key) ?? stepColumn, w));
    } else {
      pieceLeft.set(key, Math.min(pieceLeft.get(key) ?? p.x, p.x));
      pieceRight.set(key, Math.max(pieceRight.get(key) ?? p.x + w, p.x + w));
    }
  }
  for (const [key, right] of pieceRight) {
    pieceWidth.set(key, right - pieceLeft.get(key)!);
  }
  const centerOf = (key: number) =>
    key >= 0 ? key : pieceLeft.get(key)! + pieceWidth.get(key)! / 2;
  const pieces = [...pieceWidth.keys()].sort(
    (a, b) => centerOf(a) - centerOf(b),
  );

  // Pieces into rows, from the left.
  const room = width - 2 * side;
  const rowOf = new Map<number, number>();
  const leftOf = new Map<number, number>();
  let row = 0;
  let x = 0;
  let widest = 0;
  for (const piece of pieces) {
    const w = pieceWidth.get(piece)!;
    if (x > 0 && x + w > room) {
      row++;
      x = 0;
    }
    rowOf.set(piece, row);
    leftOf.set(piece, x);
    x += w + COLUMN_GAP;
    widest = Math.max(widest, x - COLUMN_GAP);
  }
  return {
    side,
    rowGap,
    pieceOf,
    pieceWidth,
    pieceLeft,
    rowOf,
    leftOf,
    widest,
    rowCount: row + 1,
  };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The view a graph opens with: as large as possible up to zoom 1, never
 * below the readable zoom. A graph that fits is centered; one that does
 * not starts at its first step (top left), and the rest can be panned to.
 */
export function initialViewport(
  layout: { width: number; height: number },
  canvas: { width: number; height: number },
): Viewport {
  const fit = Math.min(
    1,
    canvas.width / layout.width,
    canvas.height / layout.height,
  );
  const zoom = Math.max(READABLE_ZOOM, fit);
  const spareX = canvas.width - layout.width * zoom;
  const spareY = canvas.height - layout.height * zoom;
  return {
    x: spareX > 0 ? spareX / 2 : 0,
    y: spareY > 0 ? spareY / 2 : 0,
    zoom,
  };
}

/**
 * Height of the graph area: the laid out graph at its zoom, within limits.
 *
 * @alpha
 */
export function graphHeight(
  layout: { width: number; height: number },
  width: number,
): number {
  const zoom = Math.max(READABLE_ZOOM, Math.min(1, width / layout.width));
  return Math.round(
    Math.min(
      MAX_GRAPH_HEIGHT,
      Math.max(MIN_GRAPH_HEIGHT, layout.height * zoom),
    ),
  );
}

/**
 * The view moved as little as needed to show the step at `position`
 * (top left corner, in graph coordinates) inside the canvas. The zoom
 * stays as it is.
 */
export function panIntoView(
  viewport: Viewport,
  position: { x: number; y: number },
  canvas: { width: number; height: number },
  size: NodeSize = { width: NODE_WIDTH, height: NODE_HEIGHT },
): Viewport {
  const { zoom } = viewport;
  const margin = MARGIN;
  const shift = (start: number, length: number, available: number) => {
    const end = start + length;
    if (length + 2 * margin > available) return margin - start;
    if (start < margin) return margin - start;
    if (end > available - margin) return available - margin - end;
    return 0;
  };
  const left = position.x * zoom + viewport.x;
  const top = position.y * zoom + viewport.y;
  return {
    x: viewport.x + shift(left, size.width * zoom, canvas.width),
    y: viewport.y + shift(top, size.height * zoom, canvas.height),
    zoom,
  };
}

/**
 * The view moved back as little as needed so the graph does not leave
 * empty space where steps could be: a graph wider (or taller) than the
 * canvas covers it from edge to edge, one that fits stays inside it. So the
 * first column keeps its margin and is never cut off.
 */
export function keepInGraph(
  viewport: Viewport,
  layout: { width: number; height: number },
  canvas: { width: number; height: number },
): Viewport {
  const { zoom } = viewport;
  const clamp = (value: number, spare: number) =>
    Math.min(Math.max(value, Math.min(0, spare)), Math.max(0, spare));
  return {
    x: clamp(viewport.x, canvas.width - layout.width * zoom),
    y: clamp(viewport.y, canvas.height - layout.height * zoom),
    zoom,
  };
}
