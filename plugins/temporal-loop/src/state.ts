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
 * State of a loop.
 *
 * - `running`: a round runs, or the next one starts.
 * - `done`: a round decided that the result is good enough.
 * - `exhausted`: the last allowed round ended without that decision.
 * - `failed`: a round threw an error.
 *
 * @public
 */
export type LoopStatus = 'running' | 'done' | 'exhausted' | 'failed';

/**
 * State of one round.
 *
 * @public
 */
export type LoopRoundStatus = 'running' | 'completed' | 'failed';

/**
 * One round of a loop, as the query returns it.
 *
 * @public
 */
export interface LoopRoundState {
  iteration: number;
  /** Run of the workflow the round ran in, from 1 (continue-as-new runs). */
  segment: number;
  status: LoopRoundStatus;
  /** Decision of the round, for example `accept` or `revise`. */
  decision?: string;
  /** Score of the round, for example a review grade. */
  score?: number;
  /** ISO 8601 times, from the workflow clock. */
  startTime?: string;
  endTime?: string;
}

/**
 * One loop of a workflow.
 *
 * @public
 */
export interface LoopState {
  name: string;
  /** The current round, or the last one when the loop has ended. 0 before the first round. */
  iteration: number;
  /** Most rounds the loop runs. Left out for a loop without limit. */
  maxIterations?: number;
  status: LoopStatus;
  /** Decision and score of the last round that set one. */
  decision?: string;
  score?: number;
  /**
   * Rounds of the current run, oldest first. Only in the query result;
   * the memo leaves them out to stay small.
   */
  rounds?: LoopRoundState[];
}

/**
 * State of all loops of a workflow: the result of the `__loop_state`
 * query and the value of the `temporal.loops` memo.
 *
 * @public
 */
export interface LoopsState {
  /** Format version, 1. */
  v: number;
  /** Run of the workflow, from 1; continue-as-new adds one. */
  segment: number;
  /** Loops in the order they started. */
  loops: LoopState[];
  /**
   * The round that ended last, in the memo. The history keeps every
   * upsert, so the rounds of ended runs can be read back from it.
   */
  last?: LoopRoundState & { loop: string };
}
