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

import { Edge, getSmoothStepPath, Position } from '@xyflow/react';
import {
  boxSize,
  EDGE_LANE_GAP,
  FRAME_GAP,
  OFFSET,
  rowGapOf,
  stackGapOf,
  stackSidePad,
  stackTurnIn,
  stackTurnOut,
  StepGraphLayout,
} from './geometry';

/*
 * Arrows of a graph with frames around some of its steps. An arrow that
 * leaves or enters frames turns `FRAME_GAP` outside the outermost of them
 * (or of the ones it can leave without crossing a box of them, into a later
 * row), so it never runs along a frame border, and crosses the borders
 * straight.
 */

/** Data of an arrow that leaves or enters frames. */
export type FrameEdgeData = {
  /**
   * How far right of its source the arrow turns: outside the frames around
   * the source that are not around the target, `FRAME_GAP` clear of them.
   * 0 when there are none.
   */
  sourceInset?: number;
  /** The same left of the target, for the frames around it only. */
  targetInset?: number;
  /** The y of the gap between two rows that the arrow runs along. */
  centerY?: number;
};

/** Radius of the corners, as a smooth step has them. */
const RADIUS = 5;

/**
 * How far from its two ends an arrow turns, for the frames around one end
 * and not the other (`parentOf`: the frame around each box and frame).
 */
export function frameInsets(
  layout: StepGraphLayout,
  parentOf: ReadonlyMap<string, string | undefined>,
  source: string,
  target: string,
): FrameEdgeData & { sourceInset: number; targetInset: number } {
  const chain = (id: string) => {
    const frames: string[] = [];
    for (let p = parentOf.get(id); p && frames.length <= parentOf.size; ) {
      frames.push(p);
      p = parentOf.get(p);
    }
    return frames;
  };
  const from = chain(source);
  const to = chain(target);
  // The frames around one end only, the outermost last.
  const own = (chainOf: string[], other: string[]) =>
    chainOf.filter(f => !other.includes(f));
  const outer = (chainOf: string[], other: string[]) =>
    own(chainOf, other).pop();
  const left = (id: string) => layout.positions.get(id)?.x ?? 0;
  const right = (id: string) => left(id) + boxSize(layout, id).width;
  const top = (id: string) => layout.positions.get(id)?.y ?? 0;
  const bottom = (id: string) => top(id) + boxSize(layout, id).height;
  const middle = (id: string) => (top(id) + bottom(id)) / 2;
  const out = outer(from, to);
  const into = outer(to, from);
  const insets = {
    sourceInset: out ? right(out) - right(source) + FRAME_GAP : 0,
    targetInset: into ? left(target) - left(into) + FRAME_GAP : 0,
  };
  const farTurnOut = right(source) + Math.max(insets.sourceInset, OFFSET);
  const farTurnIn = left(target) - Math.max(insets.targetInset, OFFSET);

  // An arrow into a later row runs back in the gap below the row of its
  // source (as `routeRowGaps` finds it). In a stacked frame, an arrow into
  // an earlier row runs in the gap above the row of its source.
  const wrappedGap = layout.rowGaps?.find(
    g => g > top(source) && g < top(target),
  );
  const stackGap =
    wrappedGap === undefined ? stackGapOf(layout, source, target) : undefined;
  const centerY = wrappedGap ?? stackGap;
  if (centerY === undefined) {
    // In one row: straight across the borders, or turning once between
    // the frames. Without room between them (the target is above or below
    // the frame of the source, or the other way round) any way around the
    // frames would cross other boxes: the smooth step it was.
    if ((!out && !into) || farTurnOut > farTurnIn) {
      return { sourceInset: 0, targetInset: 0 };
    }
    return insets;
  }

  const frameIds = new Set(parentOf.values());
  const frames = [...frameIds].filter((f): f is string => f !== undefined);
  // A box of a frame around an end can be in the way out of that frame
  // (the source is not in its last column, or the target not in its first
  // one). Then the arrow turns `FRAME_GAP` outside the frames it can leave
  // without crossing a box, or next to its end when it can leave none, and
  // its way down or up crosses the bottom or top border of the others at
  // a right angle.
  const inTheWay = (y: number, x1: number, x2: number) => {
    for (const id of parentOf.keys()) {
      if (frameIds.has(id) || id === source || id === target) continue;
      const p = layout.positions.get(id);
      if (!p || p.y >= y || p.x >= x2) continue;
      const size = boxSize(layout, id);
      if (p.y + size.height > y && p.x + size.width > x1) return true;
    }
    return false;
  };
  const outTurns = [
    right(source) + OFFSET,
    ...own(from, to).map(f => right(f) + FRAME_GAP),
    farTurnOut,
  ];
  const inTurns = [
    left(target) - OFFSET,
    ...own(to, from).map(f => left(f) - FRAME_GAP),
    farTurnIn,
  ];
  const firstTurn = outTurns.reduce((turn, next) =>
    turn === farTurnOut || inTheWay(middle(source), right(source), next)
      ? turn
      : next,
  );
  const lastTurn = inTurns.reduce((turn, next) =>
    turn === farTurnIn || inTheWay(middle(target), next, left(target))
      ? turn
      : next,
  );

  // The two turns down (or up) stay clear of the borders of other frames
  // next to them: the first one moves right, the last one left.
  const clear = (
    x: number,
    y1: number,
    y2: number,
    skip: string[],
    direction: 1 | -1,
  ) => {
    const [low, high] = [Math.min(y1, y2), Math.max(y1, y2)];
    let at = x;
    for (let moved = true, i = 0; moved && i <= frames.length; i++) {
      moved = false;
      for (const f of frames) {
        if (skip.includes(f) || bottom(f) <= low || top(f) >= high) continue;
        for (const line of [left(f), right(f)]) {
          if (Math.abs(at - line) < FRAME_GAP) {
            at = line + direction * FRAME_GAP;
            moved = true;
          }
        }
      }
    }
    return at;
  };
  // Down a side lane of a stacked frame, past its rows, when the way
  // next to the source or the target is not clear.
  const routedOut =
    stackGap !== undefined ? stackTurnOut(layout, source, target) : undefined;
  const routedIn =
    stackGap !== undefined ? stackTurnIn(layout, source, target) : undefined;
  const turnOut =
    routedOut || clear(firstTurn, middle(source), centerY, from, 1);
  const turnIn = routedIn ?? clear(lastTurn, centerY, middle(target), to, -1);
  const sourceInset = turnOut - right(source);
  const targetInset = left(target) - turnIn;
  if (
    !out &&
    !into &&
    sourceInset === OFFSET &&
    targetInset === OFFSET &&
    stackGap === undefined
  ) {
    // Nothing to keep clear of: the smooth step it was. Between the rows of
    // a stacked frame the turns stay, next to the ends.
    return { sourceInset: 0, targetInset: 0 };
  }
  // The centerY itself comes from `routeRowGaps`.
  return { sourceInset, targetInset };
}

/** A point of an arrow. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The corners of an arrow from the right side of a box to the left side of
 * another, that leaves or enters frames. Into a later row it goes right
 * out of the frames of its source, down to the gap between the rows, left
 * to outside the frames of its target, down to the target, and straight
 * into it. In one row it is a straight line, or turns once between the
 * frames of its two ends.
 */
export function frameEdgePoints(
  source: Point,
  target: Point,
  data: FrameEdgeData,
): Point[] {
  const out = source.x + Math.max(data.sourceInset ?? 0, OFFSET);
  const into = target.x - Math.max(data.targetInset ?? 0, OFFSET);
  if (data.centerY !== undefined) {
    const y = data.centerY;
    return [
      source,
      { x: out, y: source.y },
      { x: out, y },
      { x: into, y },
      { x: into, y: target.y },
      target,
    ];
  }
  if (Math.abs(source.y - target.y) < 0.5) return [source, target];
  const x = (out + into) / 2;
  return [source, { x, y: source.y }, { x, y: target.y }, target];
}

/** An SVG path through the corners, with rounded corners. */
function roundedPath(points: Point[], radius = RADIUS): string {
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let path = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const bend = Math.min(distance(a, b) / 2, distance(b, c) / 2, radius);
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      path += `L${b.x} ${b.y}`;
    } else {
      // Along the first segment to the bend, then a curve to the second.
      const inX = b.x + (a.x === b.x ? 0 : Math.sign(a.x - b.x) * bend);
      const inY = b.y + (a.y === b.y ? 0 : Math.sign(a.y - b.y) * bend);
      const outX = b.x + (c.x === b.x ? 0 : Math.sign(c.x - b.x) * bend);
      const outY = b.y + (c.y === b.y ? 0 : Math.sign(c.y - b.y) * bend);
      path += `L ${inX},${inY}Q ${b.x},${b.y} ${outX},${outY}`;
    }
  }
  const end = points[points.length - 1];
  return `${path}L${end.x} ${end.y}`;
}

/**
 * The path of an arrow of a graph with frames. Without frames to leave or
 * enter it is the smooth step it was (turning in the gap between two rows,
 * with `centerY`).
 */
export function frameEdgePath(
  ends: {
    sourceX: number;
    sourceY: number;
    sourcePosition?: Position;
    targetX: number;
    targetY: number;
    targetPosition?: Position;
  },
  data: FrameEdgeData = {},
): string {
  if (!data.sourceInset && !data.targetInset) {
    return getSmoothStepPath({
      sourceX: ends.sourceX,
      sourceY: ends.sourceY,
      sourcePosition: ends.sourcePosition ?? Position.Right,
      targetX: ends.targetX,
      targetY: ends.targetY,
      targetPosition: ends.targetPosition ?? Position.Left,
      centerY: data.centerY,
    })[0];
  }
  return roundedPath(
    frameEdgePoints(
      { x: ends.sourceX, y: ends.sourceY },
      { x: ends.targetX, y: ends.targetY },
      data,
    ),
  );
}

/**
 * The corners of the path {@link frameEdgePath} draws, from its source to
 * its target (with the ends of the rounded corners of a smooth step).
 */
export function frameEdgeCorners(
  ends: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  data: FrameEdgeData = {},
): Point[] {
  if (data.sourceInset || data.targetInset) {
    return frameEdgePoints(
      { x: ends.sourceX, y: ends.sourceY },
      { x: ends.targetX, y: ends.targetY },
      data,
    );
  }
  return [
    ...frameEdgePath(ends, data).matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g),
  ].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
}

/**
 * The edges of a wrapped graph, and of the rows of a stacked frame: an arrow
 * into another row turns in the gap between the rows (`rowGapOf`). Arrows
 * that share a gap run on one line in it. At the sides of a stacked frame
 * the arrows run in lanes (see `spreadSides`).
 */
export function routeRowGaps(layout: StepGraphLayout, edges: Edge[]): Edge[] {
  if (!layout.rowGaps?.length && !layout.stackGaps?.size) return edges;
  const routed = edges.map(edge => {
    if (edge.type !== 'smoothstep' && edge.type !== 'frameEdge') return edge;
    const centerY = rowGapOf(layout, edge.source, edge.target);
    if (centerY === undefined) return edge;
    if (edge.type === 'frameEdge') {
      return { ...edge, data: { ...edge.data, centerY } };
    }
    return { ...edge, type: 'rowGap', data: { ...edge.data, centerY } };
  });
  return layout.stackGaps ? spreadSides(layout, routed) : routed;
}

/**
 * The turns of the arrows that run down (or up) at the sides of a stacked
 * frame, past its rows, in lanes: arrows into one box (or out of one) share
 * a lane, and arrows whose parts there run past each other get lanes of
 * their own, `EDGE_LANE_GAP` apart (closer when more than three do not
 * fit), between `FRAME_GAP` from the frame and `FRAME_GAP` from its rows.
 * On the left, where arrows turn into their targets, the arrow into the
 * lower target runs farther out; on the right, where they turn out of their
 * sources, the arrow out of the higher source does. An arrow that a side
 * lane past the inner one leads past the rows (see `stackTurnOut`) takes a
 * lane after the others, a full lane from each of them.
 */
function spreadSides(layout: StepGraphLayout, edges: Edge[]): Edge[] {
  /** A part of an arrow down or up, next to its source or its target. */
  type Part = {
    edge: Edge;
    into: boolean;
    end: string;
    x: number;
    top: number;
    bottom: number;
  };
  const left = (id: string) => layout.positions.get(id)?.x ?? 0;
  const right = (id: string) => left(id) + boxSize(layout, id).width;
  const middle = (id: string) =>
    (layout.positions.get(id)?.y ?? 0) + boxSize(layout, id).height / 2;
  const data = new Map<Edge, FrameEdgeData>();
  const parts = (edge: Edge): Part[] => {
    const d = (edge.data ?? {}) as FrameEdgeData;
    if (edge.type !== 'frameEdge' || d.centerY === undefined) return [];
    if (!d.sourceInset && !d.targetInset) return [];
    const points = frameEdgePoints(
      { x: right(edge.source), y: middle(edge.source) },
      { x: left(edge.target), y: middle(edge.target) },
      d,
    );
    const part = (a: Point, b: Point, into: boolean): Part => ({
      edge,
      into,
      end: into ? edge.target : edge.source,
      x: a.x,
      top: Math.min(a.y, b.y),
      bottom: Math.max(a.y, b.y),
    });
    return [
      part(points[1], points[2], false),
      part(points[3], points[4], true),
    ];
  };
  const all = edges.flatMap(parts);
  for (const [frame] of layout.stackGaps!) {
    const at = layout.positions.get(frame);
    if (!at) continue;
    const size = boxSize(layout, frame);
    const pad = stackSidePad(layout, frame);
    const sides = [
      { from: at.x, to: at.x + pad, outward: -1 as const },
      {
        from: at.x + size.width - pad,
        to: at.x + size.width,
        outward: 1 as const,
      },
    ];
    for (const { from, to, outward } of sides) {
      const inSide = all.filter(
        p =>
          p.x > from &&
          p.x < to &&
          p.bottom > at.y &&
          p.top < at.y + size.height,
      );
      // The parts of the arrows into (or out of) one box, together.
      const groups = new Map<string, Part[]>();
      for (const p of inSide) {
        const key = `${p.into}\u0000${p.end}`;
        groups.set(key, [...(groups.get(key) ?? []), p]);
      }
      type Span = { list: Part[]; top: number; bottom: number; end: number };
      const spans: Span[] = [...groups.values()].map(list => ({
        list,
        top: Math.min(...list.map(p => p.top)),
        bottom: Math.max(...list.map(p => p.bottom)),
        end: middle(list[0].end),
      }));
      const room = pad - 2 * FRAME_GAP;
      // The innermost lane is where the turns are, next to the rows.
      const inner = outward < 0 ? to - FRAME_GAP : from + FRAME_GAP;
      /** The lanes of `list`, or nothing when they need no spreading. */
      const spread = (list: Span[]) => {
        if (list.length < 2) return undefined;
        // Farther out first: the lower target on the left, the higher
        // source on the right.
        const sorted = [...list].sort((a, b) =>
          outward < 0 ? b.end - a.end : a.end - b.end,
        );
        const lanes: Span[][] = [];
        const laneOf = sorted.map(span => {
          let k = lanes.findIndex(lane =>
            lane.every(o => o.bottom <= span.top || o.top >= span.bottom),
          );
          if (k < 0) k = lanes.push([]) - 1;
          lanes[k].push(span);
          return k;
        });
        if (lanes.length < 2) return undefined;
        const step = Math.min(
          EDGE_LANE_GAP,
          Math.floor((2 * room) / (lanes.length - 1)) / 2,
        );
        return new Map(
          sorted.map((span, i) => [
            span,
            inner + outward * (lanes.length - 1 - laneOf[i]) * step,
          ]),
        );
      };
      // A turn that `stackTurnOut` (or `stackTurnIn`) put in a lane past the
      // inner one, because the inner one runs through a box, goes in after
      // the others: in the nearest lane a full lane from each of them, out
      // to a lane from the border of the frame. With no such lane, all of
      // them are spread out together.
      const routed = (span: Span) =>
        span.list.every(p => {
          const lane = p.into
            ? stackTurnIn(layout, p.edge.source, p.edge.target)
            : stackTurnOut(layout, p.edge.source, p.edge.target);
          return (
            lane !== undefined &&
            Math.abs(lane - p.x) < 0.5 &&
            Math.abs(lane - inner) >= 0.5
          );
        });
      const first = spans.filter(span => !routed(span));
      const later = spans.filter(routed);
      let xs = spread(first) ?? new Map<Span, number>();
      const xOf = (span: Span) => xs.get(span) ?? span.list[0].x;
      const reach = room + FRAME_GAP - EDGE_LANE_GAP;
      for (const span of later) {
        const placed = [...first, ...later.slice(0, later.indexOf(span))];
        let found: number | undefined;
        for (let k = 0; k * EDGE_LANE_GAP <= reach + 0.01; k++) {
          const x = inner + outward * k * EDGE_LANE_GAP;
          const clear = placed.every(
            o =>
              o.bottom <= span.top ||
              o.top >= span.bottom ||
              Math.abs(xOf(o) - x) >= EDGE_LANE_GAP,
          );
          if (clear) {
            found = x;
            break;
          }
        }
        if (found === undefined) {
          xs = spread(spans) ?? new Map();
          break;
        }
        xs.set(span, found);
      }
      for (const [span, x] of xs) {
        for (const p of span.list) {
          const d = { ...(p.edge.data as FrameEdgeData), ...data.get(p.edge) };
          if (p.into) d.targetInset = left(p.edge.target) - x;
          else d.sourceInset = x - right(p.edge.source);
          data.set(p.edge, d);
        }
      }
    }
  }
  return edges.map(edge =>
    data.has(edge) ? { ...edge, data: data.get(edge) } : edge,
  );
}
