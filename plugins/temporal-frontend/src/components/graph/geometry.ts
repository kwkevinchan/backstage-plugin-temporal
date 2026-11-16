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
}

/**
 * Space kept clear around the border of a frame of steps: the arrows that
 * run along it and the boxes outside it stay at least this far from it.
 */
export const FRAME_GAP = 20;
/** Space between two arrows that run side by side between two rows. */
export const EDGE_LANE_GAP = 10;
/**
 * Space between two rows of a wrapped graph with frames: the arrows into
 * the next row run in it side by side, `FRAME_GAP` clear of the frames.
 */
export const FRAME_WRAP_GAP = 2 * (FRAME_GAP + EDGE_LANE_GAP);

/** Size of a laid out box. */
export function boxSize(layout: StepLayout, id: string): NodeSize {
  return layout.sizes?.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
}
