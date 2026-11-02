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

import type { JsonObject, JsonValue } from '@backstage/types';
import {
  LOOP_MARKER_MEMO_KEY,
  LOOP_STATE_MEMO_KEY,
  parseLoopMarker,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type {
  PendingActivity,
  WorkflowFailure,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowStatus,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  decodePayload,
  decodePayloads,
  dropUndefined,
  durationToMs,
  eventTypeName,
  toDisplayJson,
  toIsoTime,
  toWorkflowFailure,
} from './convert';
import { buildLoopGroups, readLoopMarker } from './loops';

/*
 * Groups the events of a workflow history into steps (nodes) and arrows
 * (edges). The input is the protobuf JSON form of the events, oldest first.
 *
 * Grouping:
 * - activity: Scheduled, Started, Completed, Failed, TimedOut, Canceled and
 *   CancelRequested by `scheduledEventId`;
 * - timer: Started, Fired, Canceled by `startedEventId`;
 * - child workflow: Initiated, Started, Completed, Failed, Canceled,
 *   TimedOut, Terminated and the start failure by `initiatedEventId`;
 * - update: Admitted, Accepted, Completed, Rejected by update ID;
 * - signal sent: Initiated, Signaled, Failed by `initiatedEventId`;
 * - signal received, marker, cancel request: one event each;
 * - workflow task: Scheduled, Started, Completed, Failed, TimedOut by
 *   `scheduledEventId`, internal (hidden by default) unless it failed;
 * - start and close of the workflow; anything else is an internal event.
 *
 * Arrows: a step B follows a step A when B started after A ended (by event
 * ID). Only the closest such steps are linked (transitive reduction), so
 * steps whose time ranges overlap, for example activities scheduled in the
 * same workflow task, become parallel branches. Steps that are still open
 * have no outgoing arrows.
 */

type Json = any;

/** The value of one memo field of a history event, when it is JSON. */
function memoValue(memo: Json, key: string): unknown {
  const payload = memo?.fields?.[key];
  if (!payload) return undefined;
  const decoded = decodePayload(payload);
  return 'value' in decoded ? decoded.value : undefined;
}

/** Most arrows of one graph; beyond that the graph is too dense to read. */
export const MAX_GRAPH_EDGES = 5000;

/** Node kinds that count as steps in the progress. */
const STEP_KINDS = new Set<WorkflowNodeKind>([
  'activity',
  'timer',
  'childWorkflow',
  'update',
  'signalSent',
]);

const OPEN_STATUSES = new Set<WorkflowNodeStatus>([
  'Scheduled',
  'Running',
  'Retrying',
  'Waiting',
]);

const FAILED_STATUSES = new Set<WorkflowNodeStatus>([
  'Failed',
  'TimedOut',
  'Terminated',
  'Rejected',
]);

export interface BuildGraphOptions {
  namespace: string;
  workflowId: string;
  /** Status of the run from describe. */
  status: WorkflowStatus;
  /** True when the history was not read to its end. */
  truncated: boolean;
  /** Pending activities from describe, for the current attempt. */
  pendingActivities?: PendingActivity[];
  /** Search attributes from describe, for the waiting hint. */
  searchAttributes?: JsonObject;
  /** False leaves out inputs, results and marker details. */
  includePayloads: boolean;
  /** Failure of the closed run from describe, when the history is cut. */
  failure?: WorkflowFailure;
  /** Memo from describe, for the loop state. */
  memo?: JsonObject;
}

export interface Building extends WorkflowGraphNode {
  /** Event ID of the first and of the closing event, for the arrows. */
  first: number;
  last?: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number(s.toFixed(1))}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? ` ${Math.round(s % 60)}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

function failureFromCause(cause: unknown, fallback: string): WorkflowFailure {
  const text = typeof cause === 'string' ? cause.replace(/_/g, ' ') : '';
  return { message: text ? `${fallback}: ${text}` : fallback };
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

export function buildWorkflowGraph(
  events: Json[],
  options: BuildGraphOptions,
): WorkflowGraphResponse {
  const nodes: Building[] = [];
  const byKey = new Map<string, Building>();
  const payload = (value: JsonValue | undefined) =>
    options.includePayloads ? value : undefined;

  const add = (
    key: string,
    event: Json,
    init: Omit<WorkflowGraphNode, 'id' | 'events'> & { id?: string },
  ): Building => {
    const eventId = String(event.eventId ?? '');
    const node: Building = {
      ...init,
      id: init.id ?? `${init.kind}-${eventId}`,
      events: [],
      first: num(event.eventId),
    };
    nodes.push(node);
    byKey.set(key, node);
    return node;
  };
  const attach = (node: Building | undefined, event: Json) => {
    if (!node) return;
    node.events.push(
      dropUndefined({
        eventId: String(event.eventId ?? ''),
        eventType: eventTypeName(event.eventType),
        eventTime: toIsoTime(event.eventTime),
      }),
    );
  };
  const close = (
    node: Building | undefined,
    event: Json,
    status: WorkflowNodeStatus,
  ) => {
    if (!node) return;
    node.status = status;
    node.last = num(event.eventId);
    const time = toIsoTime(event.eventTime);
    if (time) node.endTime = time;
    delete node.waitingFor;
    delete node.deadline;
  };
  const instant = (node: Building, event: Json) => {
    node.last = node.first;
    const time = toIsoTime(event.eventTime);
    if (time) {
      node.startTime = time;
      node.endTime = time;
    }
  };
  const lastAttempt = (node: Building) =>
    node.attempts?.[node.attempts.length - 1];

  // Loop states from the memo: the one carried into the run, then each
  // upsert after a round.
  let carriedLoopState: unknown;
  const loopStates: unknown[] = [];
  let lastEventId = 0;
  for (const event of events) {
    lastEventId = Math.max(lastEventId, num(event.eventId));
    const time = toIsoTime(event.eventTime);
    let a: Json;

    // Workflow start and close.
    a = event.workflowExecutionStartedEventAttributes;
    if (a) {
      carriedLoopState = memoValue(a.memo, LOOP_STATE_MEMO_KEY);
      const node = add('start', event, {
        id: 'start',
        kind: 'workflowStarted',
        name: 'Start',
        status: 'Completed',
        input: payload(decodePayloads(a.input) ?? null),
        details: dropUndefined({
          workflowType: a.workflowType?.name || undefined,
          taskQueue: a.taskQueue?.name || undefined,
          attempt: a.attempt ? num(a.attempt) : undefined,
          cronSchedule: a.cronSchedule || undefined,
          continuedFromRunId: a.continuedExecutionRunId || undefined,
        }),
      });
      instant(node, event);
      attach(node, event);
      continue;
    }
    const closeAttrs: [string, WorkflowNodeStatus][] = [
      ['workflowExecutionCompletedEventAttributes', 'Completed'],
      ['workflowExecutionFailedEventAttributes', 'Failed'],
      ['workflowExecutionTimedOutEventAttributes', 'TimedOut'],
      ['workflowExecutionCanceledEventAttributes', 'Canceled'],
      ['workflowExecutionTerminatedEventAttributes', 'Terminated'],
      ['workflowExecutionContinuedAsNewEventAttributes', 'ContinuedAsNew'],
    ];
    const closing = closeAttrs.find(([key]) => event[key]);
    if (closing) {
      const [key, status] = closing;
      a = event[key];
      const node = add('end', event, {
        id: 'end',
        kind: 'workflowClosed',
        name: status === 'ContinuedAsNew' ? 'Continued as new' : 'End',
        status,
      });
      instant(node, event);
      attach(node, event);
      if (a.result) node.result = payload(decodePayloads(a.result) ?? null);
      if (a.failure) node.failure = toWorkflowFailure(a.failure);
      if (status === 'TimedOut') {
        node.failure = { message: 'Workflow execution timed out' };
      }
      if (status === 'Terminated') {
        node.failure = {
          message: a.reason ? `Terminated: ${a.reason}` : 'Terminated',
          kind: 'TerminatedFailure',
        };
        if (a.identity) node.details = { identity: a.identity };
      }
      if (status === 'ContinuedAsNew') {
        node.workflow = dropUndefined({
          namespace: options.namespace,
          workflowId: options.workflowId,
          runId: a.newExecutionRunId || undefined,
        });
        node.input = payload(decodePayloads(a.input));
      }
      continue;
    }
    a = event.workflowExecutionCancelRequestedEventAttributes;
    if (a) {
      const node = add(`cancel-${event.eventId}`, event, {
        kind: 'cancelRequest',
        name: 'Cancel requested',
        status: 'Completed',
        details: dropUndefined({
          cause: a.cause || undefined,
          identity: a.identity || undefined,
        }),
      });
      instant(node, event);
      attach(node, event);
      continue;
    }

    // Activities.
    a = event.activityTaskScheduledEventAttributes;
    if (a) {
      const max = num(a.retryPolicy?.maximumAttempts);
      const node = add(`activity-${event.eventId}`, event, {
        kind: 'activity',
        name: a.activityType?.name ?? '',
        stepId: a.activityId || undefined,
        status: 'Scheduled',
        startTime: time,
        input: payload(decodePayloads(a.input)),
        maximumAttempts: max > 0 ? max : undefined,
        loop: parseLoopMarker(a.activityId),
        details: dropUndefined({
          taskQueue: a.taskQueue?.name || undefined,
        }),
      });
      attach(node, event);
      continue;
    }
    a = event.activityTaskStartedEventAttributes;
    if (a) {
      const node = byKey.get(`activity-${a.scheduledEventId}`);
      if (!node) continue;
      attach(node, event);
      const attempt = num(a.attempt) || 1;
      node.status = 'Running';
      node.attempt = attempt;
      node.attempts = [];
      if (attempt > 1 && a.lastFailure) {
        node.attempts.push({
          attempt: attempt - 1,
          status: 'Failed',
          failure: toWorkflowFailure(a.lastFailure),
        });
      }
      node.attempts.push(
        dropUndefined({
          attempt,
          status: 'Running' as const,
          startedTime: time,
        }),
      );
      continue;
    }
    const activityClose: [string, WorkflowNodeStatus][] = [
      ['activityTaskCompletedEventAttributes', 'Completed'],
      ['activityTaskFailedEventAttributes', 'Failed'],
      ['activityTaskTimedOutEventAttributes', 'TimedOut'],
      ['activityTaskCanceledEventAttributes', 'Canceled'],
    ];
    const activityClosing = activityClose.find(([key]) => event[key]);
    if (activityClosing) {
      const [key, status] = activityClosing;
      a = event[key];
      const node = byKey.get(`activity-${a.scheduledEventId}`);
      if (!node) continue;
      attach(node, event);
      close(node, event, status);
      if (a.result) node.result = payload(decodePayloads(a.result) ?? null);
      if (a.failure) node.failure = toWorkflowFailure(a.failure);
      const current = lastAttempt(node);
      if (current) {
        current.status = status;
        if (node.failure) current.failure = node.failure;
      }
      continue;
    }
    a = event.activityTaskCancelRequestedEventAttributes;
    if (a) {
      attach(byKey.get(`activity-${a.scheduledEventId}`), event);
      continue;
    }

    // Timers.
    a = event.timerStartedEventAttributes;
    if (a) {
      const ms = durationToMs(a.startToFireTimeout);
      const fires =
        time && ms !== undefined
          ? new Date(Date.parse(time) + ms).toISOString()
          : undefined;
      const node = add(`timer-${event.eventId}`, event, {
        kind: 'timer',
        name: ms !== undefined ? `Timer ${formatMs(ms)}` : 'Timer',
        stepId: a.timerId || undefined,
        status: 'Waiting',
        startTime: time,
        // The time is formatted in the browser, in the user's time zone.
        deadline: fires ? { time: fires, kind: 'fires' } : undefined,
        details: dropUndefined({
          duration: ms !== undefined ? formatMs(ms) : undefined,
        }),
      });
      attach(node, event);
      continue;
    }
    a = event.timerFiredEventAttributes;
    if (a) {
      const node = byKey.get(`timer-${a.startedEventId}`);
      attach(node, event);
      close(node, event, 'Completed');
      continue;
    }
    a = event.timerCanceledEventAttributes;
    if (a) {
      const node = byKey.get(`timer-${a.startedEventId}`);
      attach(node, event);
      close(node, event, 'Canceled');
      continue;
    }

    // Signals.
    a = event.workflowExecutionSignaledEventAttributes;
    if (a) {
      const node = add(`signal-${event.eventId}`, event, {
        kind: 'signal',
        name: a.signalName ?? 'Signal',
        status: 'Completed',
        input: payload(decodePayloads(a.input)),
        details: dropUndefined({ identity: a.identity || undefined }),
      });
      instant(node, event);
      attach(node, event);
      continue;
    }
    a = event.signalExternalWorkflowExecutionInitiatedEventAttributes;
    if (a) {
      const target = a.workflowExecution?.workflowId ?? '';
      const node = add(`signalSent-${event.eventId}`, event, {
        kind: 'signalSent',
        name: a.signalName ?? 'Signal',
        status: 'Running',
        startTime: time,
        waitingFor: `Signaling ${target}`,
        input: payload(decodePayloads(a.input)),
        workflow: dropUndefined({
          namespace: a.namespace || options.namespace,
          workflowId: target,
          runId: a.workflowExecution?.runId || undefined,
        }),
      });
      attach(node, event);
      continue;
    }
    a = event.externalWorkflowExecutionSignaledEventAttributes;
    if (a) {
      const node = byKey.get(`signalSent-${a.initiatedEventId}`);
      attach(node, event);
      close(node, event, 'Completed');
      continue;
    }
    a = event.signalExternalWorkflowExecutionFailedEventAttributes;
    if (a) {
      const node = byKey.get(`signalSent-${a.initiatedEventId}`);
      attach(node, event);
      close(node, event, 'Failed');
      if (node) node.failure = failureFromCause(a.cause, 'Signal failed');
      continue;
    }

    // Updates, grouped by update ID.
    const updateAdmitted = event.workflowExecutionUpdateAdmittedEventAttributes;
    const updateAccepted = event.workflowExecutionUpdateAcceptedEventAttributes;
    const updateRejected = event.workflowExecutionUpdateRejectedEventAttributes;
    if (updateAdmitted || updateAccepted || updateRejected) {
      const request =
        updateAdmitted?.request ??
        updateAccepted?.acceptedRequest ??
        updateRejected?.rejectedRequest;
      const updateId: string =
        request?.meta?.updateId ||
        updateAccepted?.protocolInstanceId ||
        updateRejected?.protocolInstanceId ||
        String(event.eventId);
      let node = byKey.get(`update-${updateId}`);
      if (!node) {
        node = add(`update-${updateId}`, event, {
          kind: 'update',
          name: request?.input?.name ?? 'Update',
          stepId: updateId,
          status: 'Scheduled',
          startTime: time,
          input: payload(decodePayloads(request?.input?.args)),
          details: dropUndefined({
            identity: request?.meta?.identity || undefined,
          }),
        });
      }
      attach(node, event);
      if (updateAdmitted) {
        node.waitingFor = 'Update waits to be accepted';
      }
      if (updateAccepted) {
        node.status = 'Running';
        node.waitingFor = 'Update handler running';
      }
      if (updateRejected) {
        close(node, event, 'Rejected');
        node.failure = toWorkflowFailure(updateRejected.failure) ?? {
          message: 'Update rejected',
        };
      }
      continue;
    }
    a = event.workflowExecutionUpdateCompletedEventAttributes;
    if (a) {
      const updateId: string = a.meta?.updateId ?? '';
      const node = byKey.get(`update-${updateId}`);
      attach(node, event);
      if (!node) continue;
      if (a.outcome?.failure) {
        close(node, event, 'Failed');
        node.failure = toWorkflowFailure(a.outcome.failure);
      } else {
        close(node, event, 'Completed');
        node.result = payload(decodePayloads(a.outcome?.success) ?? null);
      }
      continue;
    }

    // Child workflows.
    a = event.startChildWorkflowExecutionInitiatedEventAttributes;
    if (a) {
      const node = add(`child-${event.eventId}`, event, {
        id: `child-${event.eventId}`,
        kind: 'childWorkflow',
        name: a.workflowType?.name ?? 'Child workflow',
        stepId: a.workflowId || undefined,
        status: 'Scheduled',
        startTime: time,
        waitingFor: `Starting child workflow ${a.workflowId ?? ''}`.trim(),
        input: payload(decodePayloads(a.input)),
        workflow: {
          namespace: a.namespace || options.namespace,
          workflowId: a.workflowId ?? '',
        },
        details: dropUndefined({
          taskQueue: a.taskQueue?.name || undefined,
        }),
        loop:
          readLoopMarker(memoValue(a.memo, LOOP_MARKER_MEMO_KEY)) ??
          parseLoopMarker(a.workflowId),
      });
      attach(node, event);
      continue;
    }
    a = event.startChildWorkflowExecutionFailedEventAttributes;
    if (a) {
      const node = byKey.get(`child-${a.initiatedEventId}`);
      attach(node, event);
      close(node, event, 'Failed');
      if (node) {
        node.failure = failureFromCause(
          a.cause,
          'Child workflow could not start',
        );
      }
      continue;
    }
    a = event.childWorkflowExecutionStartedEventAttributes;
    if (a) {
      const node = byKey.get(`child-${a.initiatedEventId}`);
      if (!node) continue;
      attach(node, event);
      node.status = 'Running';
      const runId = a.workflowExecution?.runId;
      if (node.workflow && runId) node.workflow.runId = runId;
      node.waitingFor = `Waiting for child workflow ${
        node.workflow?.workflowId ?? ''
      }`.trim();
      continue;
    }
    const childClose: [string, WorkflowNodeStatus][] = [
      ['childWorkflowExecutionCompletedEventAttributes', 'Completed'],
      ['childWorkflowExecutionFailedEventAttributes', 'Failed'],
      ['childWorkflowExecutionCanceledEventAttributes', 'Canceled'],
      ['childWorkflowExecutionTimedOutEventAttributes', 'TimedOut'],
      ['childWorkflowExecutionTerminatedEventAttributes', 'Terminated'],
    ];
    const childClosing = childClose.find(([key]) => event[key]);
    if (childClosing) {
      const [key, status] = childClosing;
      a = event[key];
      const node = byKey.get(`child-${a.initiatedEventId}`);
      if (!node) continue;
      attach(node, event);
      close(node, event, status);
      if (a.result) node.result = payload(decodePayloads(a.result) ?? null);
      if (a.failure) node.failure = toWorkflowFailure(a.failure);
      if (status === 'TimedOut' && !node.failure) {
        node.failure = { message: 'Child workflow timed out' };
      }
      if (status === 'Terminated' && !node.failure) {
        node.failure = { message: 'Child workflow was terminated' };
      }
      continue;
    }

    // Markers, for example local activities and side effects.
    a = event.markerRecordedEventAttributes;
    if (a) {
      const markerName: string = a.markerName ?? 'Marker';
      const isLocalActivity = /local_?activity/i.test(markerName);
      const details: JsonObject = {};
      for (const [k, v] of Object.entries(a.details ?? {})) {
        details[k] = decodePayloads(v) ?? null;
      }
      const node = add(`marker-${event.eventId}`, event, {
        kind: 'marker',
        name: isLocalActivity ? 'Local activity' : markerName,
        status: a.failure ? 'Failed' : 'Completed',
        failure: toWorkflowFailure(a.failure),
        input: Object.keys(details).length > 0 ? payload(details) : undefined,
        details: { markerName },
      });
      instant(node, event);
      attach(node, event);
      continue;
    }

    // Workflow tasks: internal steps.
    a = event.workflowTaskScheduledEventAttributes;
    if (a) {
      const node = add(`wft-${event.eventId}`, event, {
        id: `workflowTask-${event.eventId}`,
        kind: 'workflowTask',
        name: 'Workflow task',
        status: 'Scheduled',
        internal: true,
        startTime: time,
        attempt: a.attempt ? num(a.attempt) : undefined,
      });
      attach(node, event);
      continue;
    }
    a = event.workflowTaskStartedEventAttributes;
    if (a) {
      const node = byKey.get(`wft-${a.scheduledEventId}`);
      attach(node, event);
      if (node) node.status = 'Running';
      continue;
    }
    const taskClose: [string, WorkflowNodeStatus][] = [
      ['workflowTaskCompletedEventAttributes', 'Completed'],
      ['workflowTaskFailedEventAttributes', 'Failed'],
      ['workflowTaskTimedOutEventAttributes', 'TimedOut'],
    ];
    const taskClosing = taskClose.find(([key]) => event[key]);
    if (taskClosing) {
      const [key, status] = taskClosing;
      a = event[key];
      const node = byKey.get(`wft-${a.scheduledEventId}`);
      attach(node, event);
      close(node, event, status);
      if (node && status === 'Failed') {
        // A failing workflow task blocks the run; it is shown in the graph.
        node.internal = false;
        node.name = 'Workflow task failed';
        node.failure =
          toWorkflowFailure(a.failure) ??
          failureFromCause(a.cause, 'Workflow task failed');
      }
      continue;
    }

    // Memo upserts with the loop state stay internal events.
    a = event.workflowPropertiesModifiedEventAttributes;
    if (a) {
      const state = memoValue(a.upsertedMemo, LOOP_STATE_MEMO_KEY);
      if (state !== undefined) loopStates.push(state);
    }

    // Anything else.
    const eventType = eventTypeName(event.eventType);
    const attributesKey = Object.keys(event).find(k =>
      k.endsWith('EventAttributes'),
    );
    const node = add(`event-${event.eventId}`, event, {
      kind: 'event',
      name: eventType,
      status: 'Completed',
      internal: true,
      details:
        attributesKey && options.includePayloads
          ? (toDisplayJson(event[attributesKey]) as JsonObject)
          : undefined,
    });
    instant(node, event);
    attach(node, event);
  }

  // Current attempt of pending activities, from describe.
  for (const pending of options.pendingActivities ?? []) {
    const node = nodes.find(
      n =>
        n.kind === 'activity' &&
        n.stepId === pending.activityId &&
        n.last === undefined,
    );
    if (!node) continue;
    const attempt = pending.attempt ?? 1;
    node.attempt = attempt;
    if (pending.maximumAttempts) node.maximumAttempts = pending.maximumAttempts;
    node.attempts = [];
    if (pending.lastFailure) {
      node.attempts.push({
        attempt: Math.max(1, attempt - 1),
        status: 'Failed',
        failure: pending.lastFailure,
      });
    }
    if (pending.state === 'Started') {
      node.status = 'Running';
      node.waitingFor = `Running attempt ${attempt}`;
      node.attempts.push(
        dropUndefined({
          attempt,
          status: 'Running' as const,
          startedTime: pending.lastStartedTime,
        }),
      );
    } else if (
      pending.state === 'Paused' ||
      pending.state === 'PauseRequested'
    ) {
      node.status = 'Waiting';
      node.waitingFor = 'Activity is paused';
    } else if (pending.lastFailure) {
      node.status = 'Retrying';
      node.waitingFor = `Retrying after attempt ${Math.max(
        1,
        attempt - 1,
      )} failed: ${pending.lastFailure.message}`;
    } else {
      node.status = 'Scheduled';
      node.waitingFor = 'Waiting for a worker';
    }
  }
  for (const node of nodes) {
    if (
      node.kind === 'activity' &&
      node.last === undefined &&
      !node.waitingFor
    ) {
      node.waitingFor =
        node.status === 'Running' ? 'Running' : 'Waiting for a worker';
    }
  }

  const visible = nodes.filter(n => !n.internal);
  // A running workflow with nothing open waits for something outside.
  const running = options.status === 'Running';
  const open = visible.filter(
    n => n.last === undefined && OPEN_STATUSES.has(n.status),
  );
  const hint = running ? waitingHint(options.searchAttributes) : undefined;
  // A wait with a time limit, like `condition(fn, '24h')`, leaves only a
  // timer open. With a waiting hint, the timer is the time limit of that
  // wait: the hint is what the run waits for.
  if (hint && open.length > 0 && open.every(n => n.kind === 'timer')) {
    for (const timer of open) {
      timer.waitingFor = hint;
      if (timer.deadline) timer.deadline.kind = 'timeout';
    }
  }
  const latest = visible.reduce<Building | undefined>(
    (found, n) => (!found || n.first > found.first ? n : found),
    undefined,
  );
  const blockedByTask =
    latest?.kind === 'workflowTask' && latest.status === 'Failed';
  if (running && !options.truncated && open.length === 0 && !blockedByTask) {
    const waitingFor =
      hint ?? 'Waiting for an external event (signal or update)';
    const node: Building = {
      id: 'waiting',
      kind: 'waiting',
      name: 'Waiting',
      status: 'Waiting',
      waitingFor,
      events: [],
      first: lastEventId + 0.5,
    };
    nodes.push(node);
    visible.push(node);
  }

  const edges = buildEdges(visible);

  const steps = visible.filter(n => STEP_KINDS.has(n.kind));
  const startNode = nodes.find(n => n.kind === 'workflowStarted');
  const endNode = nodes.find(n => n.kind === 'workflowClosed');
  const previousRunId = startNode?.details?.continuedFromRunId;
  const nextRunId =
    endNode?.status === 'ContinuedAsNew' ? endNode.workflow?.runId : undefined;
  const current = currentStep(visible, options);
  const loops = buildLoopGroups(nodes, {
    status: options.status,
    upserts: loopStates,
    carried: carriedLoopState,
    current: options.memo?.[LOOP_STATE_MEMO_KEY],
  });
  const response: WorkflowGraphResponse = {
    status: options.status,
    nodes: nodes.map(({ first: _f, last: _l, ...node }) => dropUndefined(node)),
    edges,
    current: current.text,
    currentDeadline: current.deadline,
    completedSteps: steps.filter(n => n.status === 'Completed').length,
    totalSteps: steps.length,
    truncated: options.truncated,
    payloadsHidden: !options.includePayloads,
    runChain:
      typeof previousRunId === 'string' || nextRunId
        ? dropUndefined({
            previousRunId:
              typeof previousRunId === 'string' ? previousRunId : undefined,
            nextRunId,
          })
        : undefined,
    loops,
  };
  return dropUndefined(response);
}

/**
 * Arrows of the interval order of the steps, reduced to the closest
 * predecessors: A → B when A ended before B started and no step C started
 * after A ended and ended before B started.
 */
function buildEdges(nodes: Building[]): WorkflowGraphEdge[] {
  const ordered = [...nodes].sort((x, y) => x.first - y.first);
  const edges: WorkflowGraphEdge[] = [];
  for (const target of ordered) {
    // Latest start among the steps that ended before this one started.
    let latestStart = -Infinity;
    for (const other of ordered) {
      if (other.last !== undefined && other.last < target.first) {
        latestStart = Math.max(latestStart, other.first);
      }
    }
    for (const source of ordered) {
      if (
        source !== target &&
        source.last !== undefined &&
        source.last < target.first &&
        source.last >= latestStart
      ) {
        if (edges.length >= MAX_GRAPH_EDGES) return edges;
        edges.push({
          id: `${source.id}->${target.id}`,
          source: source.id,
          target: target.id,
        });
      }
    }
  }
  return edges;
}

/** Text of the open step in `current`: what it waits for, in words. */
function openStepText(node: Building): string {
  if (node.kind === 'waiting') return node.waitingFor ?? 'Waiting';
  if (node.deadline?.kind === 'timeout' && node.waitingFor) {
    return node.waitingFor;
  }
  if (node.kind === 'timer') return node.name;
  return `${node.name}: ${node.waitingFor ?? node.status}`;
}

function currentStep(
  nodes: Building[],
  options: BuildGraphOptions,
): { text?: string; deadline?: WorkflowGraphNode['deadline'] } {
  const open = nodes.filter(
    n =>
      options.status === 'Running' &&
      ((n.last === undefined && OPEN_STATUSES.has(n.status)) ||
        n.kind === 'waiting'),
  );
  return {
    text: currentText(nodes, options),
    deadline: open.length === 1 ? open[0].deadline : undefined,
  };
}

function currentText(
  nodes: Building[],
  options: BuildGraphOptions,
): string | undefined {
  if (options.status === 'Running') {
    const open = nodes.filter(
      n =>
        (n.last === undefined && OPEN_STATUSES.has(n.status)) ||
        n.kind === 'waiting',
    );
    const failedTask = nodes.find(
      n => n.kind === 'workflowTask' && n.status === 'Failed',
    );
    if (failedTask && open.length === 0) {
      return `Workflow task failing: ${
        failedTask.failure?.message ?? ''
      }`.trim();
    }
    if (open.length === 0) {
      return options.truncated
        ? 'History is long; showing the start'
        : undefined;
    }
    const texts = open.slice(0, 2).map(openStepText);
    const more = open.length > 2 ? ` (+${open.length - 2} more)` : '';
    return `${texts.join('; ')}${more}`;
  }
  if (options.status === 'ContinuedAsNew') return 'Continued as new';
  if (['Failed', 'TimedOut', 'Terminated'].includes(options.status)) {
    const failed = [...nodes]
      .reverse()
      .find(n => n.kind !== 'workflowClosed' && FAILED_STATUSES.has(n.status));
    if (failed) return `Failed at ${failed.name}`;
    const end = nodes.find(n => n.kind === 'workflowClosed');
    return end?.failure?.message ?? options.failure?.message;
  }
  return undefined;
}
