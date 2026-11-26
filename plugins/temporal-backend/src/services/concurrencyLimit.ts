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

/**
 * At most `max` tasks of one key run at the same time; the others wait in
 * the order they came. The keys are Temporal namespaces: the limit holds for
 * every request of the backend together.
 */
export class KeyedConcurrencyLimit {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly max: number) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await task();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string): Promise<void> {
    const active = this.active.get(key) ?? 0;
    if (active < this.max) {
      this.active.set(key, active + 1);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const queue = this.waiting.get(key) ?? [];
      queue.push(resolve);
      this.waiting.set(key, queue);
    });
  }

  private release(key: string) {
    const queue = this.waiting.get(key);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.waiting.delete(key);
    if (next) {
      // The slot goes to the next task: the count stays the same.
      next();
      return;
    }
    const active = (this.active.get(key) ?? 1) - 1;
    if (active > 0) this.active.set(key, active);
    else this.active.delete(key);
  }
}
