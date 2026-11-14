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

import { getSmoothStepPath, Position } from '@xyflow/react';
import { boxSize, FRAME_GAP, StepLayout } from './layout';

/*
 * Arrows of a graph with frames around some of its steps. An arrow that
 * leaves or enters frames turns `FRAME_GAP` outside the outermost of them,
 * so it never runs along a frame border, and crosses the borders straight.
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
const OFFSET = 20;
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
  // The outermost frame around one end only.
  const outer = (frames: string[], other: string[]) =>
    frames.filter(f => !other.includes(f)).pop();
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
  const firstTurn = right(source) + Math.max(insets.sourceInset, OFFSET);
  const lastTurn = left(target) - Math.max(insets.targetInset, OFFSET);

  // An arrow into a later row runs back in the gap below the row of its
  // source (as `routeRowGaps` finds it).
  const centerY = layout.rowGaps?.find(g => g > top(source) && g < top(target));
  if (centerY === undefined) {
    // In one row: straight across the borders, or turning once between
    // the frames. Without room between them (the target is above or below
    // the frame of the source, or the other way round) any way around the
    // frames would cross other boxes: the smooth step it was.
    if ((!out && !into) || firstTurn > lastTurn) {
      return { sourceInset: 0, targetInset: 0 };
    }
    return insets;
  }

  // The two turns down (or up) stay clear of the borders of other frames
  // next to them: the first one moves right, the last one left.
  const frames = [...new Set(parentOf.values())].filter(
    (f): f is string => f !== undefined,
  );
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
