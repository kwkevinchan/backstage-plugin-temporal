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
  OFFSET,
  rowGapOf,
  stackGapRoom,
  stackGapOf,
  stackSidePad,
  stackTurnIn,
  stackTurnOut,
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

export { OFFSET } from './geometry';
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
    // a stacked frame the turns stay, so that they can move into lanes.
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
 * (`frameEdge`) that run in the same gap, also between the rows of a
 * stacked frame, are spread out side by side, `EDGE_LANE_GAP` apart, and
 * stay `FRAME_GAP` clear of the rows. So are the turns of those that leave
 * or enter frames, down out of different sources (and into different
 * targets) at one x, nested: the arrow from the higher source turns farther
 * right, the one into the lower target farther left; closer together where
 * a box or frame next to them leaves less room. Turns less than
 * `EDGE_LANE_GAP` apart are spread out together the same way, the full
 * `EDGE_LANE_GAP` apart, where they all fit and none of them then runs on
 * another arrow; otherwise only the turns at one x are spread out. The
 * turns of an arrow up into an earlier row of a stacked frame are not
 * spread out with the others: where it would come closer than a lane to
 * another arrow (not into its target or out of its source), it turns a lane
 * farther out of its source and into its target, while there is room. The
 * gap between two rows of a stacked frame has room for each arrow in it a
 * lane apart (see `layoutStacked`); in one too low for them the lanes are
 * closer together. At the sides of a stacked frame the arrows then run in
 * lanes (see `spreadSides`).
 */
export function routeRowGaps(layout: StepLayout, edges: Edge[]): Edge[] {
  if (!layout.rowGaps?.length && !layout.stackGaps?.size) return edges;
  const gapOf = (edge: Edge) => {
    if (edge.type !== 'smoothstep' && edge.type !== 'frameEdge') {
      return undefined;
    }
    return rowGapOf(layout, edge.source, edge.target);
  };
  /** True for an arrow up into an earlier row, across `gap`. */
  const rising = (edge: Edge, gap: number) =>
    (layout.positions.get(edge.source)?.y ?? 0) > gap;
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

  // The arrows with frames in each gap run in lanes, from the one that
  // turns down first out of its source at the top, where `frameInsets`
  // turns it: an arrow that runs left in its lane then does not cross the
  // turns down of the arrows in the lanes below it. The lanes keep that
  // order when turns are spread out; turns spread out together from
  // different x can change places, and their arrows can then cross. Of the
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
  // How far from its middle an arrow in a gap can run: in the gap between
  // two rows of a stacked frame, as far as its rows leave room.
  const widestOf = (gap: number) =>
    layout.rowGaps?.includes(gap)
      ? FRAME_WRAP_GAP / 2 - FRAME_GAP
      : stackGapRoom(layout, gap) ?? FRAME_WRAP_GAP / 2 - FRAME_GAP;
  // Where the turns of `into` put an arrow turn down out of its source and
  // into its target.
  const outOf = (edge: Edge, into: Map<Edge, FrameEdgeData>) => {
    const inset = into.get(edge)?.sourceInset;
    return inset === undefined ? turnOut(edge) : right(edge.source) + inset;
  };
  const inTo = (edge: Edge, into: Map<Edge, FrameEdgeData>) => {
    const inset = into.get(edge)?.targetInset;
    return inset === undefined ? turnIn(edge) : left(edge.target) - inset;
  };
  // Only arrows that turn outside frames: an arrow without frames to leave
  // or enter is a smooth step, which turning elsewhere would change. Not
  // the arrows up into an earlier row either.
  const framedIn = (shared: Edge[], gap: number) =>
    shared.filter(
      e => (data(e).sourceInset || data(e).targetInset) && !rising(e, gap),
    );
  /** Spreads out the turns of the arrows in a gap into `into`. */
  const spreadGap = (
    gap: number,
    shared: Edge[],
    into: Map<Edge, FrameEdgeData>,
    clear?: (x: number, top: number, bottom: number, run: Edge[]) => boolean,
  ) => {
    const framed = framedIn(shared, gap);
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
          gap + widestOf(gap),
        ),
      clear:
        clear && ((edge, at, run) => clear(at, middle(edge.source), gap, run)),
      set: (edge, at) =>
        into.set(edge, {
          ...into.get(edge),
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
          gap - widestOf(gap),
          Math.max(...ends.map(middle)),
        ),
      clear:
        clear && ((edge, at, run) => clear(at, gap, middle(edge.target), run)),
      set: (edge, at) =>
        into.set(edge, {
          ...into.get(edge),
          targetInset: left(edge.target) - at,
        }),
    });
  };
  // The turns with the turns at each x spread out on their own, and the
  // parts of the arrows that run down there.
  const alone = new Map<Edge, FrameEdgeData>();
  for (const [gap, shared] of inGap) spreadGap(gap, shared, alone);
  const downs: { edge: Edge; x: number; top: number; bottom: number }[] = [];
  const framed = new Set(
    [...inGap].flatMap(([gap, shared]) => framedIn(shared, gap)),
  );
  for (const edge of edges) {
    if (edge.type !== 'frameEdge') continue;
    if (!layout.positions.has(edge.source)) continue;
    if (!layout.positions.has(edge.target)) continue;
    const gap = gapOf(edge);
    const [out, into] = [outOf(edge, alone), inTo(edge, alone)];
    if (
      gap !== undefined &&
      (framed.has(edge) || out > into || rising(edge, gap))
    ) {
      const [outTop, outBottom] = [middle(edge.source), gap].sort(
        (a, b) => a - b,
      );
      const [inTop, inBottom] = [gap, middle(edge.target)].sort(
        (a, b) => a - b,
      );
      downs.push(
        { edge, x: out, top: outTop, bottom: outBottom },
        { edge, x: into, top: inTop, bottom: inBottom },
      );
    } else {
      // In one row, or a smooth step to a target farther right: down
      // halfway between the ends.
      const [top, bottom] = [middle(edge.source), middle(edge.target)].sort(
        (a, b) => a - b,
      );
      downs.push({ edge, x: (out + into) / 2, top, bottom });
    }
  }
  /** True when no arrow but those of `run` runs down at `x` there. */
  const clearAt = (x: number, top: number, bottom: number, run: Edge[]) =>
    !downs.some(
      d =>
        !run.includes(d.edge) &&
        Math.abs(d.x - x) < EDGE_LANE_GAP / 2 &&
        Math.min(d.bottom, bottom) > Math.max(d.top, top),
    );
  for (const [gap, shared] of inGap) {
    spreadGap(gap, shared, turns, clearAt);
    shared.sort(
      (a, b) =>
        turnOut(a) - turnOut(b) ||
        middle(b.source) - middle(a.source) ||
        turnIn(a) - turnIn(b) ||
        middle(b.target) - middle(a.target),
    );
    // In a wrapped graph the lanes past the room share the outermost one;
    // between stacked rows they are closer together instead.
    const widest = widestOf(gap);
    const stacked = !layout.rowGaps?.includes(gap);
    const step =
      stacked && shared.length > 1
        ? Math.min(
            EDGE_LANE_GAP,
            Math.floor((4 * widest) / (shared.length - 1)) / 2,
          )
        : EDGE_LANE_GAP;
    shared.forEach((edge, i) => {
      const offset = (i - (shared.length - 1) / 2) * step;
      lanes.set(edge, Math.max(-widest, Math.min(widest, offset)));
    });
    // Arrows between two adjacent rows that share a source or a target and
    // turn between the steps, rather than in a side channel, each take a
    // lane. Arrows into one box down the side of the frame still share one.
    if (stacked) {
      const adjacentRow = (edge: Edge) => {
        const sy = layout.positions.get(edge.source)?.y ?? 0;
        const ty = layout.positions.get(edge.target)?.y ?? 0;
        const [low, high] = sy < ty ? [sy, ty] : [ty, sy];
        let between = 0;
        for (const gaps of layout.stackGaps!.values()) {
          for (const g of gaps) if (g > low && g < high) between++;
        }
        return between === 1;
      };
      const inChannel = (x: number) => {
        for (const [frame] of layout.stackGaps!) {
          const at = layout.positions.get(frame);
          if (!at) continue;
          const width = boxSize(layout, frame).width;
          const pad = stackSidePad(layout, frame);
          if (x > at.x && x < at.x + pad) return true;
          if (x > at.x + width - pad && x < at.x + width) return true;
        }
        return false;
      };
      const place = (
        list: Edge[],
        read: (edge: Edge) => number,
        write: (edge: Edge, x: number) => void,
        direction: 1 | -1,
      ) => {
        if (list.length < 2) return;
        const base =
          direction > 0
            ? Math.min(...list.map(read))
            : Math.max(...list.map(read));
        const limit = nearestSide(
          obstacles(),
          layout.width,
          base,
          direction,
          gap - widest,
          gap + widest,
        );
        const room = Math.max(0, (limit - base) * direction);
        const lane =
          list.length < 2 || room >= (list.length - 1) * EDGE_LANE_GAP
            ? EDGE_LANE_GAP
            : Math.min(
                EDGE_LANE_GAP,
                Math.floor((2 * room) / Math.max(1, list.length - 1)) / 2,
              );
        [...list]
          .sort(
            (a, b) =>
              (read(b) - read(a)) * direction || a.id.localeCompare(b.id),
          )
          .forEach((edge, i) => {
            const previous = read(edge);
            const x = base + direction * i * lane;
            if (Math.abs(x - previous) < 0.01) return;
            write(edge, x);
            for (const part of downs) {
              if (part.edge === edge && Math.abs(part.x - previous) < 0.5) {
                part.x = x;
              }
            }
          });
      };
      const bySource = new Map<string, Edge[]>();
      const byTarget = new Map<string, Edge[]>();
      for (const edge of shared) {
        if (!adjacentRow(edge)) continue;
        const out = outOf(edge, turns);
        const into = inTo(edge, turns);
        if (!inChannel(out)) {
          bySource.set(edge.source, [
            ...(bySource.get(edge.source) ?? []),
            edge,
          ]);
        }
        if (!inChannel(into)) {
          byTarget.set(edge.target, [
            ...(byTarget.get(edge.target) ?? []),
            edge,
          ]);
        }
      }
      for (const list of bySource.values()) {
        place(
          list,
          edge => outOf(edge, turns),
          (edge, x) => {
            turns.set(edge, {
              ...turns.get(edge),
              sourceInset: x - right(edge.source),
            });
          },
          1,
        );
      }
      for (const list of byTarget.values()) {
        place(
          list,
          edge => inTo(edge, turns),
          (edge, x) => {
            turns.set(edge, {
              ...turns.get(edge),
              targetInset: left(edge.target) - x,
            });
          },
          -1,
        );
      }
    }
    // An arrow up into an earlier row turns a lane farther out of its
    // source (and into its target) while it would come closer than a lane
    // to another arrow there, as far as the boxes and frames next to it
    // leave room.
    for (const edge of shared) {
      if (!rising(edge, gap)) continue;
      if (!data(edge).sourceInset && !data(edge).targetInset) continue;
      // Clear of the other arrows down there by a lane, but those into its
      // target (or out of its source), which share the turn.
      const free = (x: number, top: number, bottom: number, into: boolean) =>
        !downs.some(
          d =>
            d.edge !== edge &&
            (into
              ? d.edge.target !== edge.target
              : d.edge.source !== edge.source) &&
            Math.abs(d.x - x) < EDGE_LANE_GAP &&
            Math.min(d.bottom, bottom) > Math.max(d.top, top),
        );
      const moveOff = (
        x: number,
        direction: 1 | -1,
        top: number,
        bottom: number,
      ) => {
        const into = direction < 0;
        const limit = nearestSide(
          obstacles(),
          layout.width,
          x,
          direction,
          top,
          bottom,
        );
        let at = x;
        while (
          !free(at, top, bottom, into) &&
          (limit - (at + direction * EDGE_LANE_GAP)) * direction >= 0
        ) {
          at += direction * EDGE_LANE_GAP;
        }
        return free(at, top, bottom, into) ? at : x;
      };
      const out = moveOff(
        outOf(edge, turns),
        1,
        gap - widestOf(gap),
        middle(edge.source),
      );
      const into = moveOff(
        inTo(edge, turns),
        -1,
        middle(edge.target),
        gap + widestOf(gap),
      );
      // The other arrows keep clear of where it runs now.
      const [outPart, inPart] = downs.filter(d => d.edge === edge);
      if (outPart) outPart.x = out;
      if (inPart) inPart.x = into;
      turns.set(edge, {
        ...turns.get(edge),
        sourceInset: out - right(edge.source),
        targetInset: left(edge.target) - into,
      });
    }
  }
  const routed = edges.map(edge => {
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
 * sources, the arrow out of the higher source does.
 */
function spreadSides(layout: StepLayout, edges: Edge[]): Edge[] {
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
      const spans = [...groups.values()].map(list => ({
        list,
        top: Math.min(...list.map(p => p.top)),
        bottom: Math.max(...list.map(p => p.bottom)),
        end: middle(list[0].end),
      }));
      if (spans.length < 2) continue;
      // Farther out first: the lower target on the left, the higher source
      // on the right.
      spans.sort((a, b) => (outward < 0 ? b.end - a.end : a.end - b.end));
      const lanes: { top: number; bottom: number }[][] = [];
      const laneOf = spans.map(span => {
        let k = lanes.findIndex(lane =>
          lane.every(o => o.bottom <= span.top || o.top >= span.bottom),
        );
        if (k < 0) k = lanes.push([]) - 1;
        lanes[k].push(span);
        return k;
      });
      if (lanes.length < 2) continue;
      const room = pad - 2 * FRAME_GAP;
      const step = Math.min(
        EDGE_LANE_GAP,
        Math.floor((2 * room) / (lanes.length - 1)) / 2,
      );
      // The innermost lane is where the turns are, next to the rows.
      const inner = outward < 0 ? to - FRAME_GAP : from + FRAME_GAP;
      spans.forEach((span, i) => {
        const x = inner + outward * (lanes.length - 1 - laneOf[i]) * step;
        for (const p of span.list) {
          const d = { ...(p.edge.data as FrameEdgeData), ...data.get(p.edge) };
          if (p.into) d.targetInset = left(p.edge.target) - x;
          else d.sourceInset = x - right(p.edge.source);
          data.set(p.edge, d);
        }
      });
    }
  }
  return edges.map(edge =>
    data.has(edge) ? { ...edge, data: data.get(edge) } : edge,
  );
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
 * the `limit` for the turn and the ends. With `clear`, turns at other x
 * that turns spread out before them come within `EDGE_LANE_GAP` of join
 * them and are spread out together, the full `EDGE_LANE_GAP` apart and each
 * one never closer to its end than it was, when all of them fit within the
 * `limit` and none of them then runs on another arrow.
 */
function spreadTurns(
  edges: Edge[],
  options: {
    turn(edge: Edge): number;
    end(edge: Edge): string;
    innerFirst(a: string, b: string): number;
    direction: 1 | -1;
    limit(at: number, ends: string[]): number;
    /**
     * False when the turn of `edge` at `at` runs on another arrow. Without
     * it, only the turns at one x are spread out.
     */
    clear?(edge: Edge, at: number, run: Edge[]): boolean;
    set(edge: Edge, at: number): void;
  },
) {
  const { turn, end, direction } = options;
  const beyond = (a: number, b: number) => (a - b) * direction > 0;
  const farther = (a: number, b: number) => (beyond(a, b) ? a : b);
  type Run = { shared: Edge[]; ends: string[]; turns: number[] };
  /**
   * The turns of a run of arrows spread out, by the index of their end; for
   * turns at more than one x (`full`), the full `EDGE_LANE_GAP` apart, and
   * nothing when they do not fit.
   */
  const spread = (shared: Edge[], full: boolean): Run | undefined => {
    const ends = [...new Set(shared.map(end))].sort(options.innerFirst);
    // The farthest turn of each end.
    const own = ends.map(e =>
      shared
        .filter(edge => end(edge) === e)
        .map(turn)
        .reduce(farther),
    );
    if (ends.length < 2) return { shared, ends, turns: own };
    const at = own[0];
    const limit = options.limit(at, ends);
    const room = Math.max(0, (limit - at) * direction);
    const step = full
      ? EDGE_LANE_GAP
      : Math.min(EDGE_LANE_GAP, Math.floor((2 * room) / (ends.length - 1)) / 2);
    const turns: number[] = [];
    for (const [k, x] of own.entries()) {
      const next = k === 0 ? x : turns[k - 1] + direction * step;
      // Never closer to the end than its own turn, nor past the limit.
      if (full && beyond(next, x) && beyond(next, limit)) return undefined;
      turns.push(farther(x, next));
    }
    return { shared, ends, turns };
  };

  // The turns at each x, in `direction`.
  const atX = new Map<number, Edge[]>();
  for (const edge of edges) {
    atX.set(turn(edge), [...(atX.get(turn(edge)) ?? []), edge]);
  }
  // Runs of turns that join, each one closed with the turns at each x of
  // it on their own when they do not all fit or one runs on another arrow.
  const runs: Run[] = [];
  let joined: Edge[][] = [];
  let run: Run | undefined;
  const close = (fits: boolean) => {
    if (!run) return;
    const onTop = (edge: Edge) => {
      const at = run!.turns[run!.ends.indexOf(end(edge))];
      return at !== turn(edge) && !options.clear?.(edge, at, run!.shared);
    };
    if (joined.length > 1 && (!fits || run.shared.some(onTop))) {
      runs.push(...joined.map(at => spread(at, false)!));
    } else {
      runs.push(run);
    }
  };
  for (const [x, shared] of [...atX].sort(
    (a, b) => (a[0] - b[0]) * direction,
  )) {
    const reaches =
      run &&
      options.clear &&
      (x - run.turns.reduce(farther)) * direction < EDGE_LANE_GAP;
    const merged = reaches && spread([...run!.shared, ...shared], true);
    if (merged) {
      run = merged;
      joined.push(shared);
      continue;
    }
    close(!reaches);
    joined = [shared];
    run = spread(shared, false)!;
  }
  close(true);
  for (const { shared, ends, turns } of runs) {
    if (ends.length < 2) continue;
    for (const edge of shared) {
      const k = ends.indexOf(end(edge));
      if (k > 0 || turns[k] !== turn(edge)) options.set(edge, turns[k]);
    }
  }
}
