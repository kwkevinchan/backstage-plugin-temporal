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

// Copy of plugins/temporal-backend/src/common/loops.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { WorkflowNodeKind, WorkflowNodeStatus } from './graph';
import type { WorkflowLlmUsage } from './llm';
import type { WorkflowStatus } from './types';

/*
 * Loop markers: activities and child workflows of the rounds of a loop
 * (generate, check, revise) carry the loop name, the round and the step.
 * `@kwkevinchan/temporal-workflow-kit/loop` writes them in TypeScript workflows; other
 * SDKs follow the format in its README.
 */

/** Name of the query that returns the loop state of a running workflow. @alpha */
export const LOOP_STATE_QUERY = '__loop_state';
/** Memo key with the loop state, upserted after each round. @alpha */
export const LOOP_STATE_MEMO_KEY = 'temporal.loops';
/** Memo key of a child workflow started in a round, with its marker. @alpha */
export const LOOP_MARKER_MEMO_KEY = 'temporal.loop';

/**
 * Which loop, round and step a step belongs to.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopMarker {
  loop: string;
  /** Round, from 1, counted across continue-as-new runs. */
  iteration: number;
  step: string;
  /** Second and later calls of the same step in a round. */
  occurrence?: number;
}

/**
 * State of a loop: a round runs (`running`), a round decided the result is
 * good enough (`done`), the last allowed round ended (`exhausted`), a
 * round failed or the run stopped (`failed`), or the run continued as new
 * while the loop ran, so the loop goes on in the next run (`continued`).
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export type WorkflowLoopStatus =
  | 'running'
  | 'done'
  | 'exhausted'
  | 'failed'
  | 'continued';

/**
 * One step of a round.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopStep {
  /** ID of the step in the graph of its run. */
  nodeId: string;
  name: string;
  kind: WorkflowNodeKind;
  status: WorkflowNodeStatus;
  startTime?: string;
  endTime?: string;
  /** `llm` for a model call, `tool` for a tool call of one. */
  llm?: 'llm' | 'tool';
  /** Token counts of a model call. */
  usage?: WorkflowLlmUsage;
}

/**
 * One round of a loop.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopRound {
  iteration: number;
  /** Running while a step is open, Failed when a step failed, else Completed. */
  status: WorkflowNodeStatus;
  /**
   * Steps of the round, oldest first: the marked ones and the unmarked steps
   * (timers, signals) that started during the round.
   */
  steps: WorkflowLoopStep[];
  startTime?: string;
  endTime?: string;
  /** Decision and score the workflow recorded for the round. */
  decision?: string;
  score?: number;
  /** Run the round ran in. */
  runId?: string;
  /** Position of that run among the continue-as-new runs, from 1. */
  segment?: number;
  /** Tokens of the model calls of the round; left out without any. */
  usage?: WorkflowLlmUsage;
  /** Model calls in the round. */
  llmCalls?: number;
}

/**
 * One loop of a workflow and its rounds.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopGroup {
  name: string;
  status: WorkflowLoopStatus;
  /** Current or last round. */
  iteration: number;
  maxIterations?: number;
  /** Decision and score of the last round that recorded one. */
  decision?: string;
  score?: number;
  rounds: WorkflowLoopRound[];
}

/**
 * One run of a workflow that continues as new, in the loop summary.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopRun {
  runId: string;
  /** Position among the runs read, from 1. */
  segment: number;
  status: WorkflowStatus;
  startTime?: string;
}

/**
 * Loops of a workflow across the runs it continued as new.
 *
 * Experimental (`temporal.experimental.aiWorkflows`); moves to a separate
 * package later.
 *
 * @alpha
 */
export interface WorkflowLoopsResponse {
  loops: WorkflowLoopGroup[];
  /** Runs read, oldest first. */
  runs: WorkflowLoopRun[];
  /** `query`: the state came from the running workflow; `history`: from the histories. */
  source: 'query' | 'history';
  /** True when not every run or not every event was read. */
  truncated: boolean;
}
