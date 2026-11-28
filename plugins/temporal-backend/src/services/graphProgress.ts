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

import type { JsonObject } from '@backstage/types';
import type {
  WorkflowFailure,
  WorkflowGraphNode,
  WorkflowNodeKind,
  WorkflowProgressResponse,
  WorkflowStatus,
} from '../common';
import { failureFromCloseEvent, MAX_CAUSE_DEPTH } from './convert';
import {
  pendingActivityState,
  readSteps,
  Step,
  Steps,
  StepsOptions,
} from './graphSteps';
import {
  CLOSED_WITH_FAILURE,
  FAILED_STATUSES,
  OPEN_STATUSES,
} from '../common/stepRules';

/*
 * Where a run is, from its steps: how many are done, and a text of what it
 * waits for or where it failed. The graph and the progress of a run in a
 * list both read it here, so that they tell the same.
 */

type Json = any;

/** Node kinds that count as steps in the progress. */
export const STEP_KINDS = new Set<WorkflowNodeKind>([
  'activity',
  'timer',
  'childWorkflow',
  'update',
  'signalSent',
]);

export interface ProgressOptions extends StepsOptions {
  /** Status of the run from describe. */
  status: WorkflowStatus;
  /** True when the history was not read to its end. */
  truncated: boolean;
  /** Search attributes from describe, for the waiting hint. */
  searchAttributes?: JsonObject;
  /** Failure of the closed run from describe, when the history is cut. */
  failure?: WorkflowFailure;
  /**
   * The close event of the run (protobuf JSON), when the history is cut
   * before it: the summary reads the failure from it.
   */
  closeEvent?: Json;
}

/**
 * A text for the waiting step, from search attributes like
 * `ApprovalPending: true` ("Waiting for approval"). Any attribute whose
 * name ends with `Pending` and whose value is true or a non-empty string
 * counts.
 */
export function waitingHint(
  searchAttributes: JsonObject | undefined,
): string | undefined {
  for (const [name, raw] of Object.entries(searchAttributes ?? {})) {
    const match = /^(.+?)_?Pending$/i.exec(name);
    if (!match) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== true && !(typeof value === 'string' && value !== '')) {
      continue;
    }
    const words = match[1]
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLocaleLowerCase('en-US');
    if (!words) continue;
    return typeof value === 'string'
      ? `Waiting for ${words}: ${value}`
      : `Waiting for ${words}`;
  }
  return undefined;
}

/** What the failure of a close event says, and the step it points at. */
interface CloseFailure {
  message: string;
  /**
   * The activity (by scheduled event ID) or child workflow (by initiated
   * event ID) whose failure is in the cause chain, nearest to the top.
   */
  step?: { kind: 'activity' | 'childWorkflow'; eventId: string; name: string };
}

/**
 * Reads the failure of a close event (protobuf JSON): its message and the
 * first activity or child workflow in its cause chain. A child workflow
 * ends the walk, since the event IDs below it are of the child's history.
 * Undefined when the event is not a failed, timed out or terminated close.
 */
function closeFailureOf(event: Json): CloseFailure | undefined {
  const failure = failureFromCloseEvent(event);
  if (!failure) return undefined;
  let cause: Json = event.workflowExecutionFailedEventAttributes?.failure;
  for (let depth = 0; cause && depth <= MAX_CAUSE_DEPTH; depth += 1) {
    const activity = cause.activityFailureInfo;
    if (activity) {
      return {
        message: failure.message,
        step: {
          kind: 'activity',
          eventId: String(activity.scheduledEventId ?? ''),
          name: activity.activityType?.name ?? '',
        },
      };
    }
    const child = cause.childWorkflowExecutionFailureInfo;
    if (child) {
      return {
        message: failure.message,
        step: {
          kind: 'childWorkflow',
          eventId: String(child.initiatedEventId ?? ''),
          name: child.workflowType?.name ?? '',
        },
      };
    }
    cause = cause.cause;
  }
  return { message: failure.message };
}

/** Where a run is, and the steps that tell it. */
export interface RunState {
  /** The steps that are shown: every step that is not internal. */
  visible: Step[];
  completedSteps: number;
  totalSteps: number;
  current?: string;
  currentDeadline?: WorkflowGraphNode['deadline'];
}

/**
 * Reads where the run is from its steps. A running run with nothing open
 * gets a `waiting` step, added to `steps.nodes`; a lone open timer of a run
 * with a waiting hint becomes the time limit of that wait.
 */
export function readRunState(steps: Steps, options: ProgressOptions): RunState {
  const { nodes } = steps;
  const visible = nodes.filter(n => !n.internal);
  // A running workflow with nothing open waits for something outside.
  const running = options.status === 'Running';
  const open = visible.filter(
    n => n.last === undefined && OPEN_STATUSES.has(n.status),
  );
  const hint = running ? waitingHint(options.searchAttributes) : undefined;
  // A wait with a time limit, like `condition(fn, '24h')`, leaves only a
  // timer open. With a waiting hint, the timer is the time limit of that
  // wait: the hint is what the run waits for. With more timers open, which
  // one is the wait is unknown, so each stays a plain timer.
  if (hint && open.length === 1 && open[0].kind === 'timer') {
    const timer = open[0];
    timer.waitingFor = hint;
    if (timer.deadline) timer.deadline.kind = 'timeout';
  }
  const latest = visible.reduce<Step | undefined>(
    (found, n) => (!found || n.first > found.first ? n : found),
    undefined,
  );
  const blockedByTask =
    latest?.kind === 'workflowTask' && latest.status === 'Failed';
  if (running && !options.truncated && open.length === 0 && !blockedByTask) {
    const waitingFor =
      hint ?? 'Waiting for an external event (signal or update)';
    const node: Step = {
      id: 'waiting',
      kind: 'waiting',
      name: 'Waiting',
      status: 'Waiting',
      waitingFor,
      events: [],
      first: steps.lastEventId + 0.5,
    };
    nodes.push(node);
    visible.push(node);
  }

  const counted = visible.filter(n => STEP_KINDS.has(n.kind));
  const current = currentStep(visible, options, steps.closeEvent);
  return {
    visible,
    completedSteps: counted.filter(n => n.status === 'Completed').length,
    totalSteps: counted.length,
    current: current.text,
    currentDeadline: current.deadline,
  };
}

/**
 * Completed steps and the current step of a run, from its events (protobuf
 * JSON, oldest first): the numbers and texts of its graph, without the
 * payloads, event groups, model calls and arrows of the graph.
 */
export function buildWorkflowProgress(
  events: Json[],
  options: ProgressOptions,
): WorkflowProgressResponse {
  const state = readRunState(
    readSteps(events, options, { details: false }),
    options,
  );
  const progress: WorkflowProgressResponse = {
    status: options.status,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
    truncated: options.truncated,
  };
  if (state.current) progress.current = state.current;
  if (state.currentDeadline) progress.currentDeadline = state.currentDeadline;
  return progress;
}

/** Text of the open step in `current`: what it waits for, in words. */
function openStepText(node: Step): string {
  if (node.kind === 'waiting') return node.waitingFor ?? 'Waiting';
  if (node.deadline?.kind === 'timeout' && node.waitingFor) {
    return node.waitingFor;
  }
  if (node.kind === 'timer') return node.name;
  return `${node.name}: ${node.waitingFor ?? node.status}`;
}

function currentStep(
  nodes: Step[],
  options: ProgressOptions,
  closeEvent: Json,
): { text?: string; deadline?: WorkflowGraphNode['deadline'] } {
  // A cut history ends early: its open steps may have closed since.
  const open = nodes.filter(
    n =>
      options.status === 'Running' &&
      !options.truncated &&
      ((n.last === undefined && OPEN_STATUSES.has(n.status)) ||
        n.kind === 'waiting'),
  );
  return {
    text: currentText(nodes, options, closeEvent),
    deadline: open.length === 1 ? open[0].deadline : undefined,
  };
}

/** Texts of the first two open steps, and how many more there are. */
function listText(texts: string[]): string {
  const more = texts.length > 2 ? ` (+${texts.length - 2} more)` : '';
  return `${texts.slice(0, 2).join('; ')}${more}`;
}

function currentText(
  nodes: Step[],
  options: ProgressOptions,
  closeEvent: Json,
): string | undefined {
  if (options.status === 'Running') {
    if (options.truncated) {
      // The history read stops at the start; describe has what runs now.
      const pending = options.pendingActivities ?? [];
      if (pending.length === 0) return 'History is long; showing the start';
      return listText(
        pending.map(
          p => `${p.activityType}: ${pendingActivityState(p).waitingFor}`,
        ),
      );
    }
    const open = nodes.filter(
      n =>
        (n.last === undefined && OPEN_STATUSES.has(n.status)) ||
        n.kind === 'waiting',
    );
    const failedTask = [...nodes]
      .reverse()
      .find(n => n.kind === 'workflowTask' && n.status === 'Failed');
    if (failedTask && open.length === 0) {
      return `Workflow task failing: ${
        failedTask.failure?.message ?? ''
      }`.trim();
    }
    if (open.length === 0) return undefined;
    return listText(open.map(openStepText));
  }
  if (options.status === 'ContinuedAsNew') return 'Continued as new';
  if (CLOSED_WITH_FAILURE.includes(options.status)) {
    // The close event's cause chain tells which step the run failed at; a
    // failure caught earlier in the run is not the reason.
    const closeFailure = closeFailureOf(closeEvent ?? options.closeEvent);
    if (closeFailure) {
      const { step } = closeFailure;
      if (step) {
        const id = `${step.kind === 'activity' ? 'activity' : 'child'}-${
          step.eventId
        }`;
        const name = nodes.find(n => n.id === id)?.name || step.name;
        if (name) return `Failed at ${name}`;
      }
      if (closeFailure.message) return closeFailure.message;
    }
    // A cut history has only the start: describe has the failure.
    if (options.truncated && options.failure) return options.failure.message;
    const failed = [...nodes]
      .reverse()
      .find(n => n.kind !== 'workflowClosed' && FAILED_STATUSES.has(n.status));
    if (failed) return `Failed at ${failed.name}`;
    const end = nodes.find(n => n.kind === 'workflowClosed');
    return end?.failure?.message ?? options.failure?.message;
  }
  return undefined;
}
