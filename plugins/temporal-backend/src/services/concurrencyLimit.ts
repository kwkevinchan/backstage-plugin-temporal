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

import { ServiceUnavailableError } from '@backstage/errors';
import { TEMPORAL_ERROR_MESSAGES } from '../repositories/errors';

export interface KeyedConcurrencyLimitOptions {
  /**
   * Maximum tasks started per second per key (token bucket). When omitted,
   * only the concurrency limit applies.
   */
  maxPerSecond?: number;
  /** Monotonic clock returning milliseconds; defaults to `performance.now`. */
  now?: () => number;
}

interface Waiter {
  grant: () => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

interface KeyState {
  active: number;
  waiting: Waiter[];
  /** Current token count for rate limiting (up to `burst`). */
  tokens: number;
  /** Clock ms when `tokens` was last refilled. */
  lastRefillAt: number;
  /** Scheduled timer waiting for the next token to become available. */
  rateTimer?: ReturnType<typeof setTimeout>;
}

/**
 * At most `max` tasks of one key run at the same time, and optionally at most
 * `maxPerSecond` tasks start per second per key; the others wait in the order
 * they came. Waiting time counts toward `deadlineAt` when provided: a task
 * whose deadline expires while queued is removed and rejected with a deadline
 * error instead of running later.
 *
 * The keys are Temporal namespaces: the limit holds for every request of this
 * backend process together.
 */
export class KeyedConcurrencyLimit {
  private readonly states = new Map<string, KeyState>();
  private readonly maxPerSecond: number | undefined;
  private readonly burst: number;
  private readonly now: () => number;

  constructor(
    private readonly max: number,
    options: KeyedConcurrencyLimitOptions = {},
  ) {
    if (
      options.maxPerSecond !== undefined &&
      (!Number.isFinite(options.maxPerSecond) || options.maxPerSecond <= 0)
    ) {
      throw new Error('maxPerSecond must be a positive number');
    }
    this.maxPerSecond = options.maxPerSecond;
    this.burst =
      options.maxPerSecond !== undefined
        ? Math.max(1, Math.min(max, options.maxPerSecond))
        : max;
    this.now = options.now ?? (() => performance.now());
  }

  /** Current reading of this limiter's clock in milliseconds. */
  clock(): number {
    return this.now();
  }

  async run<T>(
    key: string,
    task: () => Promise<T>,
    options?: { deadlineAt?: number },
  ): Promise<T> {
    await this.acquire(key, options?.deadlineAt);
    try {
      return await task();
    } finally {
      this.release(key);
    }
  }

  private stateOf(key: string): KeyState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        active: 0,
        waiting: [],
        tokens: this.burst,
        lastRefillAt: this.now(),
      };
      this.states.set(key, state);
    }
    return state;
  }

  private refill(state: KeyState, currentMs: number): void {
    if (this.maxPerSecond === undefined) return;
    const elapsedMs = currentMs - state.lastRefillAt;
    if (elapsedMs <= 0) return;
    const added = (elapsedMs / 1000) * this.maxPerSecond;
    state.tokens = Math.min(this.burst, state.tokens + added);
    state.lastRefillAt = currentMs;
  }

  private tryConsumeToken(state: KeyState): boolean {
    if (this.maxPerSecond === undefined) return true;
    const currentMs = this.now();
    this.refill(state, currentMs);
    if (state.tokens >= 1) {
      state.tokens -= 1;
      return true;
    }
    return false;
  }

  private msUntilNextToken(state: KeyState): number {
    if (this.maxPerSecond === undefined) return 0;
    this.refill(state, this.now());
    if (state.tokens >= 1) return 0;
    return Math.max(
      1,
      Math.ceil(((1 - state.tokens) / this.maxPerSecond) * 1000),
    );
  }

  private acquire(key: string, deadlineAt?: number): Promise<void> {
    const state = this.stateOf(key);
    if (deadlineAt !== undefined && deadlineAt - this.now() <= 0) {
      this.cleanupIfIdle(key, state);
      return Promise.reject(
        new ServiceUnavailableError(TEMPORAL_ERROR_MESSAGES.deadline),
      );
    }
    if (
      state.waiting.length === 0 &&
      state.active < this.max &&
      this.tryConsumeToken(state)
    ) {
      state.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        grant: () => {
          if (waiter.settled) return;
          waiter.settled = true;
          if (waiter.timer !== undefined) clearTimeout(waiter.timer);
          resolve();
        },
        reject: error => {
          if (waiter.settled) return;
          waiter.settled = true;
          if (waiter.timer !== undefined) clearTimeout(waiter.timer);
          reject(error);
        },
      };
      if (deadlineAt !== undefined) {
        const remainingMs = Math.max(0, deadlineAt - this.now());
        waiter.timer = setTimeout(() => {
          const idx = state.waiting.indexOf(waiter);
          if (idx >= 0) state.waiting.splice(idx, 1);
          waiter.reject(
            new ServiceUnavailableError(TEMPORAL_ERROR_MESSAGES.deadline),
          );
          this.drain(key, state);
        }, remainingMs);
      }
      state.waiting.push(waiter);
      this.drain(key, state);
    });
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    state.active = Math.max(0, state.active - 1);
    this.drain(key, state);
  }

  private drain(key: string, state: KeyState): void {
    while (state.waiting.length > 0 && state.active < this.max) {
      if (!this.tryConsumeToken(state)) {
        if (state.rateTimer === undefined) {
          const waitMs = this.msUntilNextToken(state);
          state.rateTimer = setTimeout(() => {
            state.rateTimer = undefined;
            this.drain(key, state);
          }, waitMs);
        }
        return;
      }
      const next = state.waiting.shift()!;
      if (next.settled) continue;
      state.active += 1;
      next.grant();
    }
    if (state.waiting.length === 0 && state.rateTimer !== undefined) {
      clearTimeout(state.rateTimer);
      state.rateTimer = undefined;
    }
    this.cleanupIfIdle(key, state);
  }

  private cleanupIfIdle(key: string, state: KeyState): void {
    if (
      state.active === 0 &&
      state.waiting.length === 0 &&
      state.rateTimer === undefined &&
      (this.maxPerSecond === undefined || state.tokens >= this.burst)
    ) {
      this.states.delete(key);
    }
  }
}
