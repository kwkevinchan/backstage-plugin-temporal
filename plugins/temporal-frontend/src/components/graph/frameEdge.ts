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
  FRAME_WRAP_GAP,
  MARGIN,
  StepLayout,
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

/** How far a smooth step goes out of a box before it turns. */
export const OFFSET = 20;
/** Radius of the corners, as a smooth step has them. */
const RADIUS = 5;

/**
 * How far from its two ends an arrow turns, for the frames around one end
 * and not the other (`parentOf`: the frame around each box and frame).
 */
export function frameInsets(
  layout: StepLayout,
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
  // source (as `routeRowGaps` finds it).
  const centerY = layout.rowGaps?.find(g => g > top(source) && g < top(target));
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

  const frames = [...new Set(parentOf.values())].filter(
    (f): f is string => f !== undefined,
  );
  // A box of a frame around an end can be in the way out of that frame
  // (the source is not in its last column, or the target not in its first
  // one). Then the arrow turns `FRAME_GAP` outside the frames it can leave
  // without crossing a box, or next to its end when it can leave none, and
  // its way down or up crosses the bottom or top border of the others at
  // a right angle.
  const boxes = [...parentOf.keys()].filter(
    id => !frames.includes(id) && id !== source && id !== target,
  );
  const inTheWay = (y: number, x1: number, x2: number) =>
    boxes.some(
      id =>
        layout.positions.has(id) &&
        top(id) < y &&
        bottom(id) > y &&
        left(id) < x2 &&
        right(id) > x1,
    );
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
  const turnOut = clear(firstTurn, middle(source), centerY, from, 1);
  const turnIn = clear(lastTurn, centerY, middle(target), to, -1);
  const sourceInset = turnOut - right(source);
  const targetInset = left(target) - turnIn;
  if (!out && !into && sourceInset === OFFSET && targetInset === OFFSET) {
    // Nothing to keep clear of: the smooth step it was.
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
export function roundedPath(points: Point[], radius = RADIUS): string {
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
 * Space kept between the side of the graph and the turns of arrows that are
 * spread out side by side. An arrow that turns `FRAME_GAP` outside a frame at
 * the side of a row turns `MARGIN` from the side of the graph, which leaves
 * room for one more turn `EDGE_LANE_GAP` farther out.
 */
const EDGE_SIDE = MARGIN - EDGE_LANE_GAP;

/**
 * The edges of a wrapped graph: a smooth step into a later row turns in the
 * gap below the row of its source. The arrows of a graph with frames
 * (`frameEdge`) that run in the same gap are spread out side by side,
 * `EDGE_LANE_GAP` apart, and stay `FRAME_GAP` clear of the rows. So are
 * the turns of those that leave or enter frames, down out of different
 * sources (and into different targets) at one x, nested so that they do not cross: the arrow from the higher
 * source turns farther right, the one into the lower target farther left.
 */
export function routeRowGaps(layout: StepLayout, edges: Edge[]): Edge[] {
  const gaps = layout.rowGaps;
  if (!gaps?.length) return edges;
  const gapOf = (edge: Edge) => {
    if (edge.type !== 'smoothstep' && edge.type !== 'frameEdge') {
      return undefined;
    }
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);
    if (!source || !target) return undefined;
    return gaps.find(g => g > source.y && g < target.y);
  };
  const left = (id: string) => layout.positions.get(id)?.x ?? 0;
  const right = (id: string) => left(id) + boxSize(layout, id).width;
  const middle = (id: string) =>
    (layout.positions.get(id)?.y ?? 0) + boxSize(layout, id).height / 2;
  const data = (edge: Edge) => (edge.data ?? {}) as FrameEdgeData;
  // Where an arrow turns down out of its source, and down into its target.
  const turnOut = (edge: Edge) =>
    Math.round(
      right(edge.source) + Math.max(data(edge).sourceInset ?? 0, OFFSET),
    );
  const turnIn = (edge: Edge) =>
    Math.round(
      left(edge.target) - Math.max(data(edge).targetInset ?? 0, OFFSET),
    );

  // The arrows with frames in each gap, from the one that turns down first:
  // it runs at the top, so the arrows cross as little as possible. Of the
  // arrows that turn down at one x, the one from the lower source runs
  // higher, inside the turns of the others.
  // The boxes and frames that turns spread out stop at, found once.
  let rects: Obstacle[] | undefined;
  const obstacles = () => (rects ??= obstaclesOf(layout));
  const lanes = new Map<Edge, number>();
  const turns = new Map<Edge, FrameEdgeData>();
  const inGap = new Map<number, Edge[]>();
  for (const edge of edges) {
    const gap = edge.type === 'frameEdge' ? gapOf(edge) : undefined;
    if (gap !== undefined) inGap.set(gap, [...(inGap.get(gap) ?? []), edge]);
  }
  const widest = FRAME_WRAP_GAP / 2 - FRAME_GAP;
  for (const shared of inGap.values()) {
    shared.sort(
      (a, b) =>
        turnOut(a) - turnOut(b) ||
        middle(b.source) - middle(a.source) ||
        turnIn(a) - turnIn(b) ||
        middle(b.target) - middle(a.target),
    );
    shared.forEach((edge, i) => {
      const offset = (i - (shared.length - 1) / 2) * EDGE_LANE_GAP;
      lanes.set(edge, Math.max(-widest, Math.min(widest, offset)));
    });
    const gap = gapOf(shared[0])!;
    // Only arrows that turn outside frames: an arrow without frames to
    // leave or enter is a smooth step, which turning elsewhere would change.
    const framed = shared.filter(
      e => data(e).sourceInset || data(e).targetInset,
    );
    spreadTurns(framed, {
      turn: turnOut,
      end: edge => edge.source,
      innerFirst: (a, b) => middle(b) - middle(a),
      direction: 1,
      limit: (at, ends) =>
        nearestSide(
          obstacles(),
          layout.width,
          at,
          1,
          Math.min(...ends.map(middle)),
          gap + widest,
        ),
      set: (edge, at) =>
        turns.set(edge, {
          ...turns.get(edge),
          sourceInset: at - right(edge.source),
        }),
    });
    spreadTurns(framed, {
      turn: turnIn,
      end: edge => edge.target,
      innerFirst: (a, b) => middle(a) - middle(b),
      direction: -1,
      limit: (at, ends) =>
        nearestSide(
          obstacles(),
          layout.width,
          at,
          -1,
          gap - widest,
          Math.max(...ends.map(middle)),
        ),
      set: (edge, at) =>
        turns.set(edge, {
          ...turns.get(edge),
          targetInset: left(edge.target) - at,
        }),
    });
  }
  return edges.map(edge => {
    const centerY = gapOf(edge);
    if (centerY === undefined) return edge;
    if (edge.type === 'frameEdge') {
      const lane = lanes.get(edge) ?? 0;
      return {
        ...edge,
        data: { ...edge.data, ...turns.get(edge), centerY: centerY + lane },
      };
    }
    return { ...edge, type: 'rowGap', data: { ...edge.data, centerY } };
  });
}

/** A box or a frame that spread out turns keep clear of. */
interface Obstacle {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** `FRAME_GAP` for a frame, half of `OFFSET` for a box. */
  clear: number;
}

/** The boxes and frames of a laid out graph; a frame has boxes in it. */
function obstaclesOf(layout: StepLayout): Obstacle[] {
  const rects = [...layout.positions].map(([id, p]) => {
    const size = boxSize(layout, id);
    return {
      left: p.x,
      top: p.y,
      right: p.x + size.width,
      bottom: p.y + size.height,
    };
  });
  return rects.map(r => {
    const frame = rects.some(
      o =>
        o !== r &&
        o.left >= r.left &&
        o.right <= r.right &&
        o.top >= r.top &&
        o.bottom <= r.bottom,
    );
    return { ...r, clear: frame ? FRAME_GAP : OFFSET / 2 };
  });
}

/**
 * How far the turns of arrows down (or up) at `at` can be spread out in
 * `direction`, between `top` and `bottom`: up to the nearest side of a box
 * or border of a frame there, clear of it, or `EDGE_SIDE` inside the graph
 * (`width` wide).
 */
function nearestSide(
  obstacles: Obstacle[],
  width: number,
  at: number,
  direction: 1 | -1,
  top: number,
  bottom: number,
) {
  let limit = direction > 0 ? width - EDGE_SIDE : EDGE_SIDE;
  for (const r of obstacles) {
    if (r.bottom <= top || r.top >= bottom) continue;
    // The near side of a box or frame beyond the turn, or the far border
    // of a frame around it.
    const [near, far] = direction > 0 ? [r.left, r.right] : [r.right, r.left];
    let line: number;
    if ((near - at) * direction > 0) line = near;
    else if ((far - at) * direction > 0) line = far;
    else continue;
    const reach = line - direction * r.clear;
    limit = direction > 0 ? Math.min(limit, reach) : Math.max(limit, reach);
  }
  return limit;
}

/**
 * Spreads out the turns of arrows that turn down at one x, for different
 * ends (sources or targets): the arrows of one end share a turn. The turn of
 * the innermost end stays; each next one is `EDGE_LANE_GAP` farther in
 * `direction`, closer together (by halves of a pixel) when that would pass
 * the `limit` for the turn and the ends.
 */
function spreadTurns(
  edges: Edge[],
  options: {
    turn(edge: Edge): number;
    end(edge: Edge): string;
    innerFirst(a: string, b: string): number;
    direction: 1 | -1;
    limit(at: number, ends: string[]): number;
    set(edge: Edge, at: number): void;
  },
) {
  const { turn, end, direction } = options;
  const byTurn = new Map<number, Edge[]>();
  for (const edge of edges) {
    byTurn.set(turn(edge), [...(byTurn.get(turn(edge)) ?? []), edge]);
  }
  for (const [at, shared] of byTurn) {
    const ends = [...new Set(shared.map(end))].sort(options.innerFirst);
    if (ends.length < 2) continue;
    const room = Math.max(0, (options.limit(at, ends) - at) * direction);
    const step = Math.min(
      EDGE_LANE_GAP,
      Math.floor((2 * room) / (ends.length - 1)) / 2,
    );
    for (const edge of shared) {
      const k = ends.indexOf(end(edge));
      if (k > 0) options.set(edge, at + direction * k * step);
    }
  }
}
