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

/**
 * The gap between two rows of a stacked frame (`stackGaps`) that an arrow
 * from `source` to `target` runs across.
 *
 * - Both in the frame, into a later row: the gap below the row of the
 *   source. Past rows in between, the gap above the row of the target
 *   instead, when the way down next to the target would cross a box (or
 *   come closer than `FRAME_GAP` to a frame) and the way down next to the
 *   source would not.
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
  if (!layout.stackGaps) return undefined;
  const s = layout.positions.get(source);
  const t = layout.positions.get(target);
  if (!s || !t) return undefined;
  const contains = (frame: string, id: string) => {
    const f = layout.positions.get(frame);
    const p = layout.positions.get(id)!;
    if (!f) return false;
    const outer = boxSize(layout, frame);
    const inner = boxSize(layout, id);
    return (
      p.x >= f.x &&
      p.y >= f.y &&
      p.x + inner.width <= f.x + outer.width &&
      p.y + inner.height <= f.y + outer.height
    );
  };
  // The boxes and frames other than the ends and the frames around them.
  let rects:
    | {
        left: number;
        top: number;
        right: number;
        bottom: number;
        frame: boolean;
      }[]
    | undefined;
  /**
   * True when a line down at `x` between `y1` and `y2` runs through no box,
   * and `FRAME_GAP` clear of the sides of frames.
   */
  const clearDown = (x: number, y1: number, y2: number) => {
    rects ??= [...layout.positions]
      .filter(
        ([id]) =>
          id !== source &&
          id !== target &&
          !contains(id, source) &&
          !contains(id, target),
      )
      .map(([id, p]) => ({
        left: p.x,
        top: p.y,
        right: p.x + boxSize(layout, id).width,
        bottom: p.y + boxSize(layout, id).height,
        // A frame has other boxes in it.
        frame: [...layout.positions.keys()].some(
          o => o !== id && contains(id, o),
        ),
      }));
    return !rects.some(r => {
      if (r.top >= y2 || r.bottom <= y1) return false;
      const near = r.frame ? FRAME_GAP : 0;
      return r.left - near < x && r.right + near > x;
    });
  };
  for (const [frame, gaps] of layout.stackGaps) {
    if (!contains(frame, source) || !contains(frame, target)) continue;
    const between = gaps.filter(g => g > s.y && g < t.y);
    if (between.length > 1) {
      // Past other rows: down next to the target, or else down next to the
      // source to the gap above the row of the target.
      const [first, last] = [between[0], between[between.length - 1]];
      const into = t.x - OFFSET;
      const out = s.x + boxSize(layout, source).width + OFFSET;
      const middleOf = (p: { y: number }, id: string) =>
        p.y + boxSize(layout, id).height / 2;
      if (
        !clearDown(into, first, middleOf(t, target)) &&
        clearDown(out, middleOf(s, source), last)
      ) {
        return last;
      }
    }
    if (between.length > 0) return between[0];
    const up = [...gaps].reverse().find(g => g < s.y && g > t.y);
    if (up !== undefined) return up;
  }
  // Out of a stacked frame with boxes on the way to its side: the gap below
  // the row of the source; into one, the gap above the row of the target.
  const middle = (id: string) =>
    layout.positions.get(id)!.y + boxSize(layout, id).height / 2;
  const inTheWay = (end: string, y: number, x1: number, x2: number) =>
    [...layout.positions].some(([id, p]) => {
      if (id === source || id === target || contains(id, end)) return false;
      const size = boxSize(layout, id);
      return (
        p.y < y && p.y + size.height > y && p.x < x2 && p.x + size.width > x1
      );
    });
  let found: { gap: number; area: number } | undefined;
  for (const [frame, gaps] of layout.stackGaps) {
    const f = layout.positions.get(frame);
    if (!f) continue;
    const size = boxSize(layout, frame);
    const area = size.width * size.height;
    if (found && found.area <= area) continue;
    let gap: number | undefined;
    if (contains(frame, source) && !contains(frame, target)) {
      const from = s.x + boxSize(layout, source).width;
      if (inTheWay(source, middle(source), from, f.x + size.width)) {
        gap = gaps.find(g => g > s.y);
      }
    } else if (contains(frame, target) && !contains(frame, source)) {
      if (inTheWay(target, middle(target), f.x, t.x)) {
        gap = [...gaps].reverse().find(g => g < t.y);
      }
    }
    if (gap !== undefined) found = { gap, area };
  }
  return found?.gap;
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
