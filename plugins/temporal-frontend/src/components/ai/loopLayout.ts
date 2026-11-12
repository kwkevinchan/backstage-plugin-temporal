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
  boxSize,
  layoutSteps,
  NODE_HEIGHT,
  NODE_WIDTH,
  NodeSize,
  StepLayout,
} from '../graph/layout';

/*
 * Layout of an expanded loop: a header box (the loop, with its collapse
 * button), then one frame per round, top to bottom. The steps of a round
 * are laid out left to right inside its frame and wrap inside it when the
 * frame would be wider than the graph. The main graph lays out the whole
 * loop as one large box, so wrapping the main graph never splits it.
 */

/** Height of the title bar of a round frame. */
export const FRAME_HEADER_HEIGHT = 32;
/** Narrowest round frame, so its title fits. */
export const MIN_FRAME_WIDTH = 300;
/** Space between two round frames, for the arrow between them. */
export const FRAME_GAP = 28;
/** Space between the loop header and the first note or frame. */
const HEADER_GAP = 16;
/** Height of a note above the first frame or below the last one. */
export const NOTE_HEIGHT = 20;
const NOTE_GAP = 8;
/** Height of a frame body without steps (all of them hidden). */
const EMPTY_BODY_HEIGHT = 40;

export interface LoopBlockInput {
  /** ID of the loop box: the header gets it. */
  id: string;
  frames: {
    id: string;
    steps: { id: string; size?: NodeSize }[];
    edges: { source: string; target: string }[];
  }[];
  /** A note above the first frame: rounds of an earlier run. */
  noteBefore?: boolean;
  /** A note below the last frame: the loop goes on in the next run. */
  noteAfter?: boolean;
}

/** IDs of the notes of an expanded loop. */
export const noteBeforeId = (id: string) => `${id}#before`;
export const noteAfterId = (id: string) => `${id}#after`;

/** A laid out expanded loop, with positions from its top left corner. */
export interface LoopBlockLayout {
  width: number;
  height: number;
  /** Header, notes, frames and steps. */
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, NodeSize>;
}

/**
 * Lays out an expanded loop. With `width`, the steps of a round wrap
 * inside its frame when the frame would be wider.
 */
export function layoutLoopBlock(
  input: LoopBlockInput,
  width?: number,
): LoopBlockLayout {
  const inner = input.frames.map(frame =>
    frame.steps.length > 0
      ? layoutSteps(frame.steps, frame.edges, width)
      : undefined,
  );
  const frameWidth = Math.max(
    MIN_FRAME_WIDTH,
    NODE_WIDTH,
    ...inner.map(l => l?.width ?? 0),
  );
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, NodeSize>();
  const place = (id: string, x: number, y: number, size: NodeSize) => {
    positions.set(id, { x, y });
    sizes.set(id, size);
  };
  place(input.id, 0, 0, { width: NODE_WIDTH, height: NODE_HEIGHT });
  let y = NODE_HEIGHT + HEADER_GAP;
  if (input.noteBefore) {
    place(noteBeforeId(input.id), 0, y, {
      width: frameWidth,
      height: NOTE_HEIGHT,
    });
    y += NOTE_HEIGHT + NOTE_GAP;
  }
  input.frames.forEach((frame, i) => {
    const steps = inner[i];
    const body = steps?.height ?? EMPTY_BODY_HEIGHT;
    place(frame.id, 0, y, {
      width: frameWidth,
      height: FRAME_HEADER_HEIGHT + body,
    });
    if (steps) {
      for (const step of frame.steps) {
        const p = steps.positions.get(step.id)!;
        place(
          step.id,
          p.x,
          y + FRAME_HEADER_HEIGHT + p.y,
          boxSize(steps, step.id),
        );
      }
    }
    y += FRAME_HEADER_HEIGHT + body + FRAME_GAP;
  });
  y -= FRAME_GAP;
  if (input.noteAfter) {
    y += NOTE_GAP;
    place(noteAfterId(input.id), 0, y, {
      width: frameWidth,
      height: NOTE_HEIGHT,
    });
    y += NOTE_HEIGHT;
  }
  return { width: frameWidth, height: y, positions, sizes };
}

/**
 * The main graph with its expanded loops put in place: each loop box of
 * the main layout is replaced by the header, notes, frames and steps of
 * its block.
 */
export function placeLoopBlocks(
  layout: StepLayout,
  blocks: Map<string, LoopBlockLayout>,
): StepLayout {
  if (blocks.size === 0) return layout;
  const positions = new Map(layout.positions);
  const sizes = new Map(layout.sizes ?? []);
  for (const [id, block] of blocks) {
    const origin = layout.positions.get(id) ?? { x: 0, y: 0 };
    for (const [part, p] of block.positions) {
      positions.set(part, { x: origin.x + p.x, y: origin.y + p.y });
      sizes.set(part, block.sizes.get(part)!);
    }
  }
  return { ...layout, positions, sizes };
}
