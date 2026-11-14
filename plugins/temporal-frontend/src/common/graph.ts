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

// Copy of plugins/temporal-backend/src/common/graph.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { JsonObject, JsonValue } from '@backstage/types';
import type { WorkflowLlmSummary, WorkflowToolLink } from './llm';
import type { WorkflowLoopGroup, WorkflowLoopMarker } from './loops';
import type { WorkflowFailure, WorkflowStatus } from './types';

/**
 * Kind of a step in the workflow graph.
 *
 * - `workflowStarted`, `workflowClosed`: start and end of the run
 *   (`workflowClosed` covers completed, failed, timed out, canceled,
 *   terminated and continued as new).
 * - `activity`: one activity from scheduling to its result, with retries.
 * - `timer`, `signal` (received), `signalSent`, `update`, `childWorkflow`,
 *   `marker` (for example local activities), `cancelRequest`.
 * - `waiting`: what a running workflow waits for, derived and not an event.
 * - `workflowTask`: one workflow task, an internal step hidden by default.
 * - `event`: any other event, hidden by default.
 *
 * @public
 */
export type WorkflowNodeKind =
  | 'workflowStarted'
  | 'workflowClosed'
  | 'activity'
  | 'timer'
  | 'signal'
  | 'signalSent'
  | 'update'
  | 'childWorkflow'
  | 'marker'
  | 'cancelRequest'
  | 'waiting'
  | 'workflowTask'
  | 'event';

/**
 * Status of one step in the workflow graph.
 *
 * @public
 */
export type WorkflowNodeStatus =
  | 'Scheduled'
  | 'Running'
  | 'Retrying'
  | 'Waiting'
  | 'Completed'
  | 'Failed'
  | 'TimedOut'
  | 'Canceled'
  | 'Terminated'
  | 'Rejected'
  | 'ContinuedAsNew';

/**
 * One history event that belongs to a step.
 *
 * @public
 */
export interface WorkflowNodeEvent {
  eventId: string;
  eventType: string;
  eventTime?: string;
}

/**
 * One attempt of an activity. Temporal records only the last attempt and
 * the failure of the attempt before it in the history; attempts in between
 * are not listed.
 *
 * @public
 */
export interface WorkflowNodeAttempt {
  attempt: number;
  status: WorkflowNodeStatus;
  startedTime?: string;
  failure?: WorkflowFailure;
}

/**
 * When an open timer fires.
 *
 * @public
 */
export interface WorkflowDeadline {
  /** ISO 8601 timestamp. */
  time: string;
  /** `fires`: a plain timer; `timeout`: the time limit of a wait. */
  kind: 'fires' | 'timeout';
}

/**
 * The run's place among the runs of a workflow ID that continues as new.
 *
 * @public
 */
export interface WorkflowRunChain {
  /** The run this one continued from. */
  previousRunId?: string;
  /** The run this one continued as. */
  nextRunId?: string;
  /** Position of the run among the runs of the workflow ID, from 1. */
  index?: number;
  /** Runs of the workflow ID. */
  total?: number;
}

/**
 * One step of a workflow run: the events of one activity, timer, signal,
 * update or child workflow grouped together.
 *
 * @public
 */
export interface WorkflowGraphNode {
  /** Stable within the run, for example `activity-5` (scheduled event ID). */
  id: string;
  kind: WorkflowNodeKind;
  /** Activity type, timer ID, signal or update name, child workflow type. */
  name: string;
  /**
   * One-line summary the workflow gave the step (Temporal user metadata,
   * for example the `summary` activity option). Shown as the step's title,
   * with `name` below it.
   */
  summary?: string;
  status: WorkflowNodeStatus;
  /** Internal steps (workflow tasks, other events) are hidden by default. */
  internal?: boolean;
  /** What a running or waiting step waits for, in words. */
  waitingFor?: string;
  /**
   * When an open timer fires. With `kind` `timeout`, the timer is the time
   * limit of a wait (for example `condition(fn, '24h')`) and `waitingFor`
   * says what the run waits for.
   */
  deadline?: WorkflowDeadline;
  startTime?: string;
  endTime?: string;
  /** Activity ID, timer ID or update ID. */
  stepId?: string;
  /** Last or current attempt of an activity. */
  attempt?: number;
  maximumAttempts?: number;
  attempts?: WorkflowNodeAttempt[];
  /** Decoded input; left out when the caller may not read payloads. */
  input?: JsonValue;
  /** Decoded result; left out when the caller may not read payloads. */
  result?: JsonValue;
  failure?: WorkflowFailure;
  /** The child workflow, or the next run of a continued-as-new workflow. */
  workflow?: { namespace: string; workflowId: string; runId?: string };
  /** Other details, for example the timer duration or a signal's sender. */
  details?: JsonObject;
  /**
   * Loop, round and step of an activity or child workflow with a loop
   * marker. Experimental (`temporal.experimental.aiWorkflows`).
   */
  loop?: WorkflowLoopMarker;
  /**
   * A model call, recognized by an LLM adapter: model, tokens and tool
   * calls. Experimental: the shape changes before the first stable release.
   */
  llm?: WorkflowLlmSummary;
  /**
   * A tool call of a model call. Experimental: the shape changes before
   * the first stable release.
   */
  tool?: WorkflowToolLink;
  /** The events of the step, oldest first. */
  events: WorkflowNodeEvent[];
}

/**
 * An arrow between two steps: `target` started after `source` ended.
 *
 * @public
 */
export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * Steps and arrows of one workflow run, built from its history. The graph,
 * the steps table and the grouped event view use the same response.
 *
 * @public
 */
export interface WorkflowGraphResponse {
  status: WorkflowStatus;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  /** Short text of where the run is now: what it waits for or where it failed. */
  current?: string;
  /** Deadline of the step in `current`, shown in the user's time zone. */
  currentDeadline?: WorkflowDeadline;
  /** Steps that are done (completed activities, timers, children, updates). */
  completedSteps: number;
  /** Activities, timers, children and updates in the graph. */
  totalSteps: number;
  /** True when the history was longer than the backend reads. */
  truncated: boolean;
  /** True when inputs and results were left out for lack of permission. */
  payloadsHidden: boolean;
  /** The run's place among the runs of a workflow that continues as new. */
  runChain?: WorkflowRunChain;
  /**
   * Loops of the run, from loop markers; left out when there are none.
   * Experimental (`temporal.experimental.aiWorkflows`).
   */
  loops?: WorkflowLoopGroup[];
}

/**
 * Progress of one run, for workflow lists.
 *
 * @public
 */
export interface WorkflowProgressResponse {
  status: WorkflowStatus;
  completedSteps: number;
  totalSteps: number;
  current?: string;
  currentDeadline?: WorkflowDeadline;
  truncated: boolean;
}
