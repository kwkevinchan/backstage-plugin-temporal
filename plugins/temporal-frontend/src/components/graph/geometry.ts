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

/*
 * Sizes and places of the boxes of a laid out graph, shared by the layout
 * and the arrows.
 */

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;
/** Space around the boxes of a laid out graph. */
export const MARGIN = 16;

/**
 * Size of the box of a step.
 *
 * @alpha
 */
export interface NodeSize {
  width: number;
  height: number;
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
  /**
   * In a frame whose boxes are stacked in rows, the y of the middle of the
   * gap below each row but the last, by the ID of the frame: an arrow into
   * another row of the frame runs across one of them.
   */
  stackGaps?: Map<string, number[]>;
}

/**
 * Space kept clear around the border of a frame of steps: the arrows that
 * run along it and the boxes outside it stay at least this far from it.
 */
export const FRAME_GAP = 20;
/** How far a smooth step goes out of a box before it turns. */
export const OFFSET = 20;
/** Space between two arrows that run side by side between two rows. */
export const EDGE_LANE_GAP = 10;
/**
 * Space between two rows of a wrapped graph with frames: the arrows into
 * the next row run in it side by side, `FRAME_GAP` clear of the frames.
 */
export const FRAME_WRAP_GAP = 2 * (FRAME_GAP + EDGE_LANE_GAP);

/** Space between the rows of a stacked frame: arrows run in it. */
export const STACK_GAP = FRAME_WRAP_GAP;
/**
 * Space at the sides of a stacked frame: arrows into and out of its rows
 * turn there, side by side in up to three lanes `EDGE_LANE_GAP` apart,
 * `FRAME_GAP` clear of the frame and of the rows.
 */
export const STACK_SIDE = 2 * FRAME_GAP + 2 * EDGE_LANE_GAP;

/** Space between a frame and the boxes in it, below and on the sides. */
export const FRAME_PADDING = 12;
/** Height of the title bar of a frame of steps. */
export const FRAME_TITLE_HEIGHT = 30;
/** Space above the boxes of a frame: its title bar and a gap. */
export const FRAME_TOP = FRAME_TITLE_HEIGHT + 8;

/** Size of a laid out box. */
export function boxSize(layout: StepLayout, id: string): NodeSize {
  return layout.sizes?.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** A laid out box or frame. */
interface Rect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** True for a frame: it has other boxes in it. */
  frame: boolean;
}

/** How an arrow runs between the rows of a stacked frame. */
interface StackRoute {
  /** The gap it runs across. */
  gap: number;
  /** Where it turns out of its source, when not next to the source. */
  turnOut?: number;
  /**
   * Where it turns down into its target, when that is a side lane of the
   * frame rather than next to the target. The long vertical then stays in
   * the side channel instead of running through the rows below.
   */
  turnIn?: number;
}

/**
 * Side channel of a stacked frame when arrows past its rows need more than
 * the three lanes `STACK_SIDE` holds. Absent means `STACK_SIDE`.
 */
const sidePads = new WeakMap<StepLayout, Map<string, number>>();

/** The side channel of `frame`, or `STACK_SIDE` when it was not widened. */
export function stackSidePad(layout: StepLayout, frame: string): number {
  return sidePads.get(layout)?.get(frame) ?? STACK_SIDE;
}

/** Records a side channel wider than `STACK_SIDE` for `frame`. */
export function setStackSidePad(
  layout: StepLayout,
  frame: string,
  pad: number,
): void {
  if (pad <= STACK_SIDE) return;
  let pads = sidePads.get(layout);
  if (!pads) {
    pads = new Map();
    sidePads.set(layout, pads);
  }
  pads.set(frame, pad);
}

/** The side channels recorded for `layout`, if it has any wider than `STACK_SIDE`. */
export function stackSidePadEntries(
  layout: StepLayout,
): Iterable<[string, number]> {
  return sidePads.get(layout)?.entries() ?? [];
}

/** Keeps the side channels when a layout is copied into a new object. */
export function copyStackSidePads(from: StepLayout, to: StepLayout): void {
  const pads = sidePads.get(from);
  if (pads) sidePads.set(to, new Map(pads));
}

/**
 * The boxes and frames of a stacked layout and the routes of its arrows,
 * found once for each layout: a laid out graph does not change.
 */
const stackCache = new WeakMap<
  StepLayout,
  {
    rects: Rect[];
    routes: Map<string, StackRoute | undefined>;
    rooms: Map<number, number | undefined>;
  }
>();

function cacheOf(layout: StepLayout) {
  let cached = stackCache.get(layout);
  if (!cached) {
    const rects = [...layout.positions].map(([id, p]) => {
      const size = boxSize(layout, id);
      return {
        id,
        left: p.x,
        top: p.y,
        right: p.x + size.width,
        bottom: p.y + size.height,
        frame: false,
      };
    });
    // Larger first: a frame is larger than the boxes in it.
    const bySize = [...rects].sort(
      (a, b) =>
        (b.right - b.left) * (b.bottom - b.top) -
        (a.right - a.left) * (a.bottom - a.top),
    );
    bySize.forEach((r, i) => {
      r.frame = bySize
        .slice(i + 1)
        .some(
          o =>
            o.left >= r.left &&
            o.top >= r.top &&
            o.right <= r.right &&
            o.bottom <= r.bottom,
        );
    });
    cached = { rects, routes: new Map(), rooms: new Map() };
    stackCache.set(layout, cached);
  }
  return cached;
}

/**
 * The gap between two rows of a stacked frame (`stackGaps`) that an arrow
 * from `source` to `target` runs across.
 *
 * - Both in the frame, into a later row: the gap below the row of the
 *   source. Past rows in between, when the way down where the arrow turns
 *   into the target would cross a box (or come closer than `FRAME_GAP` to
 *   a frame, or to where arrows turn next to a box), the gap above the row of the
 *   target instead: down where it turns out of the source, or else down
 *   the right side of the frame (`stackTurnOut`), whichever is clear.
 * - Both in the frame, into an earlier row: the gap above the row of the
 *   source.
 * - Out of the frame, with a box between the source and the side of the
 *   frame: the gap below the row of the source; into the frame, with a box
 *   between its side and the target, the gap above the row of the target
 *   (of the innermost such frame).
 *
 * Nothing otherwise, as for two boxes in one row.
 */
export function stackGapOf(
  layout: StepLayout,
  source: string,
  target: string,
): number | undefined {
  return stackRoute(layout, source, target)?.gap;
}

/**
 * Where an arrow between the rows of a stacked frame turns down out of its
 * source when the way down next to it is not clear (see `stackGapOf`): on
 * the right side of the frame. Nothing when it turns next to its source.
 */
export function stackTurnOut(
  layout: StepLayout,
  source: string,
  target: string,
): number | undefined {
  return stackRoute(layout, source, target)?.turnOut;
}

/**
 * Where an arrow turns down on its way into the target when that turn is a
 * side lane of a stacked frame (see `stackGapOf`), so the vertical that
 * crosses the rows below runs in the side channel. Nothing when it turns
 * next to the target.
 */
export function stackTurnIn(
  layout: StepLayout,
  source: string,
  target: string,
): number | undefined {
  return stackRoute(layout, source, target)?.turnIn;
}

/**
 * How far an arrow can run from the middle of a gap between two rows of a
 * stacked frame (`stackGaps`), `FRAME_GAP` clear of the rows above and
 * below it; nothing for another y.
 */
export function stackGapRoom(
  layout: StepLayout,
  gap: number,
): number | undefined {
  if (!layout.stackGaps) return undefined;
  const cached = cacheOf(layout);
  if (cached.rooms.has(gap)) return cached.rooms.get(gap);
  let room: number | undefined;
  const byId = new Map(cached.rects.map(r => [r.id, r]));
  for (const [frame, gaps] of layout.stackGaps) {
    const f = byId.get(frame);
    if (!f || !gaps.includes(gap)) continue;
    let [above, below] = [f.top, f.bottom];
    for (const r of cached.rects) {
      if (r === f || r.left < f.left || r.right > f.right) continue;
      if (r.top < f.top || r.bottom > f.bottom) continue;
      if (r.bottom <= gap) above = Math.max(above, r.bottom);
      else if (r.top >= gap) below = Math.min(below, r.top);
    }
    room = Math.min(gap - above, below - gap) - FRAME_GAP;
  }
  cached.rooms.set(gap, room);
  return room;
}

function stackRoute(
  layout: StepLayout,
  source: string,
  target: string,
): StackRoute | undefined {
  if (!layout.stackGaps) return undefined;
  const s = layout.positions.get(source);
  const t = layout.positions.get(target);
  if (!s || !t) return undefined;
  const { rects, routes } = cacheOf(layout);
  const key = `${source}\u0000${target}`;
  if (routes.has(key)) return routes.get(key);
  const route = findStackRoute(layout, rects, source, target);
  routes.set(key, route);
  return route;
}

function findStackRoute(
  layout: StepLayout,
  rects: Rect[],
  source: string,
  target: string,
): StackRoute | undefined {
  const s = layout.positions.get(source)!;
  const t = layout.positions.get(target)!;
  const byId = new Map(rects.map(r => [r.id, r]));
  const contains = (frame: string, id: string) => {
    const f = byId.get(frame);
    const r = byId.get(id);
    return (
      !!f &&
      !!r &&
      r.left >= f.left &&
      r.top >= f.top &&
      r.right <= f.right &&
      r.bottom <= f.bottom
    );
  };
  // The boxes and frames other than the ends and the frames around them.
  const others = rects.filter(
    r =>
      r.id !== source &&
      r.id !== target &&
      !contains(r.id, source) &&
      !contains(r.id, target),
  );
  /**
   * True when a line down at `x` between `y1` and `y2` runs `FRAME_GAP`
   * clear of the sides of frames, and clear of where arrows turn out of
   * and into boxes (`OFFSET` from them) by half a lane.
   */
  const clearDown = (x: number, y1: number, y2: number) =>
    !others.some(r => {
      if (r.top >= y2 || r.bottom <= y1) return false;
      const near = r.frame ? FRAME_GAP : OFFSET + EDGE_LANE_GAP / 2;
      return r.left - near < x && r.right + near > x;
    });
  /**
   * True when a box, or with `frames` a frame too, is across a line at `y`
   * from `x1` to `x2`.
   */
  const across = (y: number, x1: number, x2: number, frames = true) =>
    others.some(
      r =>
        (frames || !r.frame) &&
        r.top < y &&
        r.bottom > y &&
        r.left < x2 &&
        r.right > x1,
    );
  const middle = (id: string) => {
    const r = byId.get(id)!;
    return (r.top + r.bottom) / 2;
  };
  // The frames around one end only, the innermost first.
  const own = (end: string, other: string) =>
    rects
      .filter(r => r.frame && contains(r.id, end) && !contains(r.id, other))
      .sort((a, b) => a.right - a.left - (b.right - b.left));
  /**
   * Where the arrow turns down out of its source, as `frameInsets` turns
   * it: outside the frames around the source it can leave without passing
   * a box, `FRAME_GAP` clear of them, or next to the source.
   */
  const turnOutOf = () => {
    const from = byId.get(source)!;
    let at = from.right + OFFSET;
    for (const f of own(source, target)) {
      if (across(middle(source), from.right, f.right + FRAME_GAP, false)) {
        break;
      }
      at = f.right + FRAME_GAP;
    }
    return at;
  };
  /** The same for the turn down into the target. */
  const turnInto = () => {
    const into = byId.get(target)!;
    let at = into.left - OFFSET;
    for (const f of own(target, source)) {
      if (across(middle(target), f.left - FRAME_GAP, into.left, false)) break;
      at = f.left - FRAME_GAP;
    }
    return at;
  };
  /**
   * A lane in the side channel of `frame` where a line from `y1` to `y2`
   * stays clear of the rows. The inner right lane first (where a single
   * side arrow already turns), then one and two lanes further out, then the
   * same on the left. The outer lanes sit `EDGE_LANE_GAP` past the inner
   * one, so a box that fills the row still leaves the half-lane clearance
   * `clearDown` asks for. Nothing when every such lane is blocked.
   */
  const sideLane = (frame: Rect, y1: number, y2: number) => {
    const pad = stackSidePad(layout, frame.id);
    const [low, high] = [Math.min(y1, y2), Math.max(y1, y2)];
    const lanes = [
      frame.right - pad + FRAME_GAP,
      frame.right - pad + FRAME_GAP + EDGE_LANE_GAP,
      frame.right - pad + FRAME_GAP + 2 * EDGE_LANE_GAP,
      frame.left + pad - FRAME_GAP,
      frame.left + pad - FRAME_GAP - EDGE_LANE_GAP,
      frame.left + pad - FRAME_GAP - 2 * EDGE_LANE_GAP,
    ];
    return lanes.find(
      x =>
        x >= frame.left + FRAME_GAP &&
        x <= frame.right - FRAME_GAP &&
        clearDown(x, low, high),
    );
  };
  for (const [frame, gaps] of layout.stackGaps!) {
    if (!contains(frame, source) || !contains(frame, target)) continue;
    const between = gaps.filter(g => g > s.y && g < t.y);
    if (between.length > 1) {
      // Past other rows: down next to the target, else down next to the
      // source or in a side lane of the frame to the gap above the row of
      // the target. Two groups side by side in a row between them (signals
      // received during one round) take the side lane even when the way
      // down next to the target is clear, so the arrow does not run across
      // that row.
      const [first, last] = [between[0], between[between.length - 1]];
      const frameRect = byId.get(frame)!;
      const end = byId.get(source)!.right;
      const band = rects.filter(
        r =>
          r.frame &&
          r.id !== frame &&
          r.top >= first &&
          r.bottom <= last &&
          r.left >= frameRect.left &&
          r.right <= frameRect.right,
      );
      const sideBySide = band.some(r =>
        band.some(o => o !== r && o.top < r.bottom && r.top < o.bottom),
      );
      const sidePast = () => {
        const side = sideLane(frameRect, middle(source), last);
        if (
          side !== undefined &&
          !across(middle(source), end, side, false) &&
          clearDown(side, middle(source), last)
        ) {
          return { gap: last, turnOut: side };
        }
        return undefined;
      };
      if (sideBySide) {
        const side = sidePast();
        if (side) return side;
      }
      if (!clearDown(turnInto(), first, middle(target))) {
        if (clearDown(turnOutOf(), middle(source), last)) return { gap: last };
        const side = sidePast();
        if (side) return side;
      }
    }
    if (between.length > 0) return { gap: between[0] };
    const up = [...gaps].reverse().find(g => g < s.y && g > t.y);
    if (up !== undefined) return { gap: up };
  }
  // Out of a stacked frame with boxes on the way to its side: the gap below
  // the row of the source; into one, the gap above the row of the target.
  // When the vertical on from that gap to the other end would run through a
  // lower row, it turns in a side lane instead (`stackTurnIn` / `turnOut`).
  let found:
    | { gap: number; area: number; turnOut?: number; turnIn?: number }
    | undefined;
  for (const [frame, gaps] of layout.stackGaps!) {
    const f = byId.get(frame);
    if (!f) continue;
    const area = (f.right - f.left) * (f.bottom - f.top);
    if (found && found.area <= area) continue;
    let route: { gap: number; turnOut?: number; turnIn?: number } | undefined;
    if (contains(frame, source) && !contains(frame, target)) {
      if (across(middle(source), byId.get(source)!.right, f.right)) {
        const gap = gaps.find(g => g > s.y);
        if (gap !== undefined) {
          const into = turnInto();
          const turnIn = clearDown(into, gap, middle(target))
            ? undefined
            : sideLane(f, gap, middle(target));
          route = { gap, ...(turnIn !== undefined ? { turnIn } : {}) };
        }
      }
    } else if (contains(frame, target) && !contains(frame, source)) {
      if (across(middle(target), f.left, t.x)) {
        const gap = [...gaps].reverse().find(g => g < t.y);
        if (gap !== undefined) {
          const out = turnOutOf();
          let turnOut: number | undefined;
          if (!clearDown(out, middle(source), gap)) {
            const side = sideLane(f, middle(source), gap);
            if (
              side !== undefined &&
              !across(middle(source), byId.get(source)!.right, side, false)
            ) {
              turnOut = side;
            }
          }
          route = { gap, ...(turnOut !== undefined ? { turnOut } : {}) };
        }
      }
    }
    if (route) found = { ...route, area };
  }
  if (!found) return undefined;
  const route: StackRoute = { gap: found.gap };
  if (found.turnOut !== undefined) route.turnOut = found.turnOut;
  if (found.turnIn !== undefined) route.turnIn = found.turnIn;
  return route;
}

/**
 * The gap between two rows that an arrow from `source` to `target` runs
 * across: into a later row of a wrapped graph, the gap below the row of the
 * source (`rowGaps`), or else the one of a stacked frame (`stackGapOf`).
 */
export function rowGapOf(
  layout: StepLayout,
  source: string,
  target: string,
): number | undefined {
  const s = layout.positions.get(source);
  const t = layout.positions.get(target);
  if (!s || !t) return undefined;
  return (
    layout.rowGaps?.find(g => g > s.y && g < t.y) ??
    stackGapOf(layout, source, target)
  );
}
