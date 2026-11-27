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

import { KeyedConcurrencyLimit } from './concurrencyLimit';

/** A task that runs until `finish` is called. */
function pending() {
  let finish!: () => void;
  const done = new Promise<void>(resolve => {
    finish = resolve;
  });
  return { task: () => done, finish };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('KeyedConcurrencyLimit', () => {
  it('runs at most max tasks of a key, the others in order', async () => {
    const limit = new KeyedConcurrencyLimit(2);
    const started: number[] = [];
    const tasks = [0, 1, 2, 3].map(() => pending());
    const runs = tasks.map((t, i) =>
      limit.run('default', () => {
        started.push(i);
        return t.task();
      }),
    );
    await flush();
    expect(started).toEqual([0, 1]);
    tasks[1].finish();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    tasks[0].finish();
    tasks[2].finish();
    tasks[3].finish();
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('counts each key on its own', async () => {
    const limit = new KeyedConcurrencyLimit(1);
    const started: string[] = [];
    const a = pending();
    const b = pending();
    const runs = [
      limit.run('a', () => {
        started.push('a');
        return a.task();
      }),
      limit.run('b', () => {
        started.push('b');
        return b.task();
      }),
    ];
    await flush();
    expect(started).toEqual(['a', 'b']);
    a.finish();
    b.finish();
    await Promise.all(runs);
  });

  it('frees the slot of a task that fails', async () => {
    const limit = new KeyedConcurrencyLimit(1);
    await expect(
      limit.run('a', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(limit.run('a', async () => 'next')).resolves.toBe('next');
  });

  describe('rate limit and queue deadline (fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-27T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('paces starts at maxPerSecond per key', async () => {
      // Concurrency 4, rate 2/s => initial burst of 2, then 1 every 500 ms.
      const limit = new KeyedConcurrencyLimit(4, { maxPerSecond: 2 });
      const started: number[] = [];
      const runs = [0, 1, 2, 3].map(i =>
        limit.run('default', async () => {
          started.push(i);
          return i;
        }),
      );

      await Promise.resolve();
      expect(started).toEqual([0, 1]);

      await jest.advanceTimersByTimeAsync(499);
      expect(started).toEqual([0, 1]);

      await jest.advanceTimersByTimeAsync(1);
      expect(started).toEqual([0, 1, 2]);

      await jest.advanceTimersByTimeAsync(500);
      expect(started).toEqual([0, 1, 2, 3]);
      await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3]);
    });

    it('counts waiting time against deadlineAt and drops expired waiters', async () => {
      const limit = new KeyedConcurrencyLimit(1, { maxPerSecond: 1 });
      const first = pending();
      const ran: string[] = [];

      const r1 = limit.run('default', async () => {
        ran.push('first');
        await first.task();
      });
      const r2 = limit
        .run(
          'default',
          async () => {
            ran.push('expired');
          },
          { deadlineAt: limit.clock() + 200 },
        )
        .catch(err => err);
      const r3 = limit.run('default', async () => {
        ran.push('third');
        return 'ok';
      });

      await Promise.resolve();
      expect(ran).toEqual(['first']);

      // Advance past r2's deadline while r1 is still holding the slot.
      await jest.advanceTimersByTimeAsync(200);
      const err = await r2;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Temporal did not answer in time');

      // Release r1 and advance for token refill: r3 runs, expired r2 never runs.
      first.finish();
      await jest.advanceTimersByTimeAsync(1000);
      await r1;
      await expect(r3).resolves.toBe('ok');
      expect(ran).toEqual(['first', 'third']);
    });

    it('rejects immediately when deadlineAt has already passed', async () => {
      const limit = new KeyedConcurrencyLimit(4, { maxPerSecond: 5 });
      const fn = jest.fn();
      await expect(
        limit.run('default', fn, { deadlineAt: limit.clock() }),
      ).rejects.toThrow('Temporal did not answer in time');
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
