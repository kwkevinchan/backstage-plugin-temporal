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

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;
/** A model call: three lines (name, model, tokens and tools). */
export const LLM_NODE_WIDTH = 240;
export const LLM_NODE_HEIGHT = 86;
/** A tool call of a model call: a smaller box. */
export const TOOL_NODE_WIDTH = 180;
export const TOOL_NODE_HEIGHT = 52;
/** Widest box, for the columns of a wrapped graph. */
const MAX_NODE_WIDTH = LLM_NODE_WIDTH;

/**
 * Size of the box of a step.
 *
 * @alpha
 */
export interface NodeSize {
  width: number;
  height: number;
}

/** Size of the box of a step: model calls are larger, tool calls smaller. */
export function stepSize(node: { llm?: unknown; tool?: unknown }): NodeSize {
  if (node.llm) return { width: LLM_NODE_WIDTH, height: LLM_NODE_HEIGHT };
  if (node.tool) return { width: TOOL_NODE_WIDTH, height: TOOL_NODE_HEIGHT };
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}
/** Space between the columns, between the steps of a column, and around. */
const COLUMN_GAP = 56;
const ROW_GAP = 24;
export const MARGIN = 16;
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

/**
 * Positions and size of a laid out step graph.
 *
 * @alpha
 */
export interface StepLayout {
  positions: Map<string, { x: number; y: number }>;
  /** Size of each box, for boxes that are not of the default size. */
  sizes?: Map<string, NodeSize>;
  /** Size of the laid out graph, with its margin. */
  width: number;
  height: number;
  /** True when the columns were wrapped into more than one row. */
  wrapped: boolean;
  /**
   * In a wrapped graph, the y of the middle of the gap below each row but
   * the last: an arrow into a later row runs across it, clear of the boxes.
   */
  rowGaps?: number[];
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
 * A frame around steps, laid out with them: the steps (and frames) whose
 * `parent` it is, plus room for its title bar.
 */
export interface LayoutFrame {
  id: string;
  /** The frame around this one. */
  parent?: string;
}

/** Space between a frame and the boxes in it, below and on the sides. */
export const FRAME_PADDING = 12;
/** Height of the title bar of a frame of steps. */
export const FRAME_TITLE_HEIGHT = 30;
/** Space above the boxes of a frame: its title bar and a gap. */
export const FRAME_TOP = FRAME_TITLE_HEIGHT + 8;

/**
 * {@link layoutSteps} with frames around some of the steps, any number of
 * frames deep: dagre lays out the steps as a compound graph, which keeps
 * the steps of a frame together and the steps of other frames out of it.
 * The frame boxes are then drawn around their steps, with the title bar at
 * the top. A wrapped graph never splits an outermost frame across rows.
 */
export function layoutGraph(
  nodes: { id: string; size?: NodeSize; parent?: string }[],
  edges: { source: string; target: string }[],
  width?: number,
  options: { direction?: 'LR' | 'TB'; frames?: LayoutFrame[] } = {},
): StepLayout {
  const topDown = options.direction === 'TB';
  const frames = options.frames ?? [];
  const sizeOf = (node: { size?: NodeSize }) =>
    node.size ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
  const compound = frames.length > 0 && !topDown;
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
  if (compound) placeFrames(layout, nodes, frames, sizes);
  if (sizes.size > 0) layout.sizes = sizes;
  if (width === undefined || nodes.length === 0 || topDown) return layout;
  // Fits as it is, at a readable zoom.
  if (layout.width * READABLE_ZOOM <= width) return layout;
  return wrapColumns(
    layout,
    width,
    compound ? frames.filter(f => !f.parent).map(f => f.id) : [],
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

/** Size of a laid out box. */
export function boxSize(layout: StepLayout, id: string): NodeSize {
  return layout.sizes?.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/**
 * Moves the columns of a laid out graph into rows of at most `width`.
 * Columns are as wide as the widest box (the column width of a step, or
 * more for a large box such as an expanded loop), and fill each row from
 * the left. Each of `outerFrames` stays in one row, with the boxes in its
 * width.
 */
function wrapColumns(
  layout: StepLayout,
  width: number,
  outerFrames: string[] = [],
): StepLayout {
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
      pieceWidth.set(
        key,
        Math.max(pieceWidth.get(key) ?? 0, p.x + w - pieceLeft.get(key)!),
      );
    }
  }
  const centerOf = (key: number) =>
    key >= 0 ? key : pieceLeft.get(key)! + pieceWidth.get(key)! / 2;
  const pieces = [...pieceWidth.keys()].sort(
    (a, b) => centerOf(a) - centerOf(b),
  );

  // Pieces into rows, from the left.
  const room = width - 2 * MARGIN;
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
  const rowCount = row + 1;
  if (rowCount === 1) return layout;

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
    if (top[r] !== Infinity) y += bottom[r] - top[r] + WRAP_GAP;
    if (r < rowCount - 1) rowGaps.push(y - WRAP_GAP / 2);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, p] of layout.positions) {
    const piece = pieceOf(id, p);
    const r = rowOf.get(piece)!;
    positions.set(id, {
      x:
        MARGIN +
        leftOf.get(piece)! +
        (piece >= 0
          ? (pieceWidth.get(piece)! - boxSize(layout, id).width) / 2
          : p.x - pieceLeft.get(piece)!),
      y: offsets[r] + (p.y - top[r]),
    });
  }
  const wrapped: StepLayout = {
    positions,
    width: 2 * MARGIN + widest,
    height: y - WRAP_GAP + MARGIN,
    wrapped: true,
    rowGaps,
  };
  if (layout.sizes) wrapped.sizes = layout.sizes;
  return wrapped;
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
