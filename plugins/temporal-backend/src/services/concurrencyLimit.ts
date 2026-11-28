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
import { TEMPORAL_ERROR_MESSAGES } from '../lib/errorMessages';

export interface KeyedConcurrencyLimitOptions {
  /**
   * Maximum tasks started per second per key (token bucket). When omitted,
   * only the concurrency limit applies.
   */
  maxPerSecond?: number;
}

/**
 * A task that waited in the queue until its deadline. No call to Temporal was
 * made for it. The message is the one of a call that Temporal did not answer
 * in time.
 */
export class QueueDeadlineError extends ServiceUnavailableError {
  constructor() {
    super(TEMPORAL_ERROR_MESSAGES.deadline);
  }
}

interface Waiter {
  grant: () => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
  /** Clock ms of the deadline; Infinity without one. */
  deadlineAt: number;
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
 * `maxPerSecond` tasks start per second per key; the others wait. The one
 * with the earliest `deadlineAt` starts first, and tasks with the same
 * deadline (or none) start in the order they came. Waiting time counts toward
 * `deadlineAt` when provided: a task whose deadline expires while queued is
 * removed and rejected with a {@link QueueDeadlineError} instead of running
 * later. Tasks of one request share a deadline, so the request that came
 * first gets its tasks started first, and a later request does not push them
 * past their deadline.
 *
 * The keys are Temporal namespaces: the limit holds for every request of this
 * backend process together.
 */
export class KeyedConcurrencyLimit {
  private readonly states = new Map<string, KeyState>();
  private readonly maxPerSecond: number | undefined;
  private readonly burst: number;

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
  }

  /** Current reading of the monotonic clock of this limiter, in milliseconds. */
  clock(): number {
    return performance.now();
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
        lastRefillAt: this.clock(),
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
    const currentMs = this.clock();
    this.refill(state, currentMs);
    if (state.tokens >= 1) {
      state.tokens -= 1;
      return true;
    }
    return false;
  }

  private msUntilNextToken(state: KeyState): number {
    if (this.maxPerSecond === undefined) return 0;
    this.refill(state, this.clock());
    if (state.tokens >= 1) return 0;
    return Math.max(
      1,
      Math.ceil(((1 - state.tokens) / this.maxPerSecond) * 1000),
    );
  }

  private acquire(key: string, deadlineAt?: number): Promise<void> {
    const state = this.stateOf(key);
    if (deadlineAt !== undefined && deadlineAt - this.clock() <= 0) {
      this.cleanupIfIdle(key, state);
      return Promise.reject(new QueueDeadlineError());
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
        deadlineAt: deadlineAt ?? Infinity,
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
        const remainingMs = Math.max(0, deadlineAt - this.clock());
        waiter.timer = setTimeout(() => {
          const idx = state.waiting.indexOf(waiter);
          if (idx >= 0) state.waiting.splice(idx, 1);
          waiter.reject(new QueueDeadlineError());
          this.drain(key, state);
        }, remainingMs);
        // A waiting task alone does not keep the process alive.
        waiter.timer.unref?.();
      }
      // Earliest deadline first; after the tasks with the same deadline.
      let at = state.waiting.length;
      while (at > 0 && state.waiting[at - 1].deadlineAt > waiter.deadlineAt) {
        at -= 1;
      }
      state.waiting.splice(at, 0, waiter);
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
          state.rateTimer.unref?.();
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
