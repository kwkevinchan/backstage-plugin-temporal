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
 * Loop markers for Temporal workflows: rounds of generate, check and revise
 * loops (AI workflows), a `__loop_state` query and continue-as-new helpers.
 * The Backstage Temporal plugin shows the loops from these markers.
 *
 * Runs in the workflow sandbox; `@temporalio/workflow` is a peer dependency.
 *
 * @packageDocumentation
 */

export {
  formatLoopMarker,
  parseActivityLoopMarker,
  parseLoopMarker,
  LOOP_MARKER_MEMO_KEY,
  LOOP_MARKER_PREFIX,
  LOOP_STATE_MEMO_KEY,
  LOOP_STATE_QUERY,
  LOOP_STATE_VERSION,
} from './marker';
export type { LoopMarker } from './marker';
export type {
  LoopRoundState,
  LoopRoundStatus,
  LoopState,
  LoopsState,
  LoopStatus,
} from './state';
export { createLoops, Loops, MAX_QUERY_ROUNDS } from './loops';
export type {
  CreateLoopsOptions,
  LoopContinueAsNewOptions,
  LoopOptions,
  LoopResult,
  LoopRound,
  LoopRoundOutcome,
  LoopRoundResult,
} from './loops';
