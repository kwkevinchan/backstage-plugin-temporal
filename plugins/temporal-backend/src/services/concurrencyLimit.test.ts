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
});
