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

import { layoutSteps, NODE_HEIGHT, NODE_WIDTH } from './layout';
import {
  FRAME_GAP,
  FRAME_HEADER_HEIGHT,
  layoutLoopBlock,
  LoopBlockInput,
  MIN_FRAME_WIDTH,
  noteAfterId,
  noteBeforeId,
  placeLoopBlocks,
} from './loopLayout';

/** A loop with `rounds` rounds of `steps` steps in a row. */
function loop(rounds: number, steps = 2, first = 1): LoopBlockInput {
  return {
    id: 'loop:refine',
    frames: Array.from({ length: rounds }, (_, r) => {
      const ids = Array.from(
        { length: steps },
        (__, s) => `r${first + r}-s${s + 1}`,
      );
      return {
        id: `loop:refine#${first + r}`,
        steps: ids.map(id => ({ id })),
        edges: ids.slice(1).map((id, i) => ({ source: ids[i], target: id })),
      };
    }),
  };
}

const box = (block: ReturnType<typeof layoutLoopBlock>, id: string) => ({
  ...block.positions.get(id)!,
  ...block.sizes.get(id)!,
});

describe('layoutLoopBlock', () => {
  it('puts the header on top and one frame per round below it', () => {
    const block = layoutLoopBlock(loop(3));
    const header = box(block, 'loop:refine');
    expect(header).toEqual({
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
    const frames = [1, 2, 3].map(i => box(block, `loop:refine#${i}`));
    // Top to bottom, the same width, the gap for the arrow between them.
    for (const frame of frames) {
      expect(frame.x).toBe(0);
      expect(frame.width).toBe(block.width);
    }
    for (const [i, frame] of frames.slice(1).entries()) {
      const before = frames[i];
      expect(frame.y).toBe(before.y + before.height + FRAME_GAP);
    }
    expect(frames[0].y).toBeGreaterThan(header.y + header.height);
    const last = frames[2];
    expect(block.height).toBe(last.y + last.height);
  });

  it('lays out the steps of a round left to right inside its frame', () => {
    const block = layoutLoopBlock(loop(2, 3));
    for (const round of [1, 2]) {
      const frame = box(block, `loop:refine#${round}`);
      const steps = [1, 2, 3].map(s => box(block, `r${round}-s${s}`));
      for (const step of steps) {
        expect(step.y).toBeGreaterThanOrEqual(frame.y + FRAME_HEADER_HEIGHT);
        expect(step.y + step.height).toBeLessThanOrEqual(
          frame.y + frame.height,
        );
        expect(step.x + step.width).toBeLessThanOrEqual(frame.x + frame.width);
      }
      expect(steps[0].x).toBeLessThan(steps[1].x);
      expect(steps[1].x).toBeLessThan(steps[2].x);
      expect(steps[0].y).toBe(steps[1].y);
    }
  });

  it('wraps a round with many steps inside its frame, which gets taller', () => {
    const wide = layoutLoopBlock(loop(1, 8));
    const wrapped = layoutLoopBlock(loop(1, 8), 700);
    expect(wrapped.width).toBeLessThanOrEqual(700);
    expect(wrapped.height).toBeGreaterThan(wide.height);
    const frame = box(wrapped, 'loop:refine#1');
    for (let s = 1; s <= 8; s++) {
      const step = box(wrapped, `r1-s${s}`);
      expect(step.x + step.width).toBeLessThanOrEqual(frame.width);
      expect(step.y + step.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });

  it('shows notes for the rounds of the earlier and the next run', () => {
    const block = layoutLoopBlock({
      ...loop(10, 2, 11),
      noteBefore: true,
      noteAfter: true,
    });
    const before = box(block, noteBeforeId('loop:refine'));
    const after = box(block, noteAfterId('loop:refine'));
    const first = box(block, 'loop:refine#11');
    const last = box(block, 'loop:refine#20');
    expect(before.y + before.height).toBeLessThanOrEqual(first.y);
    expect(after.y).toBeGreaterThanOrEqual(last.y + last.height);
    expect(block.height).toBe(after.y + after.height);
  });

  it('keeps a frame without steps, at least as wide as its title', () => {
    const block = layoutLoopBlock({
      id: 'loop:refine',
      frames: [{ id: 'loop:refine#1', steps: [], edges: [] }],
    });
    const frame = box(block, 'loop:refine#1');
    expect(frame.width).toBe(MIN_FRAME_WIDTH);
    expect(frame.height).toBeGreaterThan(FRAME_HEADER_HEIGHT);
  });

  it('lays out 100 rounds quickly', () => {
    const started = performance.now();
    const block = layoutLoopBlock(loop(100, 3), 1200);
    expect(block.positions.size).toBe(1 + 100 + 300);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('placeLoopBlocks', () => {
  it('lays out an expanded loop as one box of the main graph', () => {
    const block = layoutLoopBlock(loop(3));
    const nodes = [
      { id: 'start' },
      { id: 'loop:refine', size: { width: block.width, height: block.height } },
      { id: 'end' },
    ];
    const edges = [
      { source: 'start', target: 'loop:refine' },
      { source: 'loop:refine', target: 'end' },
    ];
    // Narrow: the main graph wraps, but the loop stays in one piece.
    const main = layoutSteps(nodes, edges, 600);
    expect(main.wrapped).toBe(true);
    const layout = placeLoopBlocks(main, new Map([['loop:refine', block]]));
    const origin = main.positions.get('loop:refine')!;
    for (const [id, p] of block.positions) {
      expect(layout.positions.get(id)).toEqual({
        x: origin.x + p.x,
        y: origin.y + p.y,
      });
    }
    // Nothing else overlaps the loop.
    for (const id of ['start', 'end']) {
      const p = layout.positions.get(id)!;
      const inside =
        p.x + NODE_WIDTH > origin.x &&
        p.x < origin.x + block.width &&
        p.y + NODE_HEIGHT > origin.y &&
        p.y < origin.y + block.height;
      expect(inside).toBe(false);
    }
  });
});
