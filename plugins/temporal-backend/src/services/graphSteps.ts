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
import type {
  PendingActivity,
  WorkflowFailure,
  WorkflowGraphNode,
  WorkflowNodeStatus,
} from '../common';
import {
  decodePayloads,
  dropUndefined,
  durationToMs,
  eventTypeName,
  summaryOf,
  toDisplayJson,
  toIsoTime,
  toWorkflowFailure,
} from './convert';
import type { LlmStepEntry } from './llm/llm';
import { EventGroupCollector } from './eventGroups';
import { isLocalActivityMarker } from '../common/stepRules';

/*
 * Groups the events of a workflow history into steps. The input is the protobuf JSON form of the events, oldest first.
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
 * Event groups: the markers on the event that starts a step (scheduled,
 * started, initiated, recorded) are the groups of the step (see
 * `eventGroups.ts`).
 */

type Json = any;

/** A step while its run is read. */
export interface Step extends WorkflowGraphNode {
  /** Event ID of the first and of the closing event, for the arrows. */
  first: number;
  last?: number;
}

export interface StepsOptions {
  namespace: string;
  workflowId: string;
  /** Pending activities from describe, for the current attempt. */
  pendingActivities?: PendingActivity[];
}

/** The steps of a run, and what was read with them. */
export interface Steps {
  /** Every step, in the order of the events that start them. */
  nodes: Step[];
  /** The greatest event ID read. */
  lastEventId: number;
  /** The event that closed the run (protobuf JSON), when it was read. */
  closeEvent: Json;
  /** Activities and local activities, for the LLM adapters. */
  llmEntries: LlmStepEntry[];
  eventGroups: EventGroupCollector;
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

/** Status and text of a pending activity from describe. */
export function pendingActivityState(pending: PendingActivity): {
  status: WorkflowNodeStatus;
  waitingFor: string;
} {
  const attempt = pending.attempt ?? 1;
  if (pending.state === 'Started') {
    return { status: 'Running', waitingFor: `Running attempt ${attempt}` };
  }
  if (pending.state === 'Paused' || pending.state === 'PauseRequested') {
    return { status: 'Waiting', waitingFor: 'Activity is paused' };
  }
  if (pending.lastFailure) {
    return {
      status: 'Retrying',
      waitingFor: `Retrying after attempt ${Math.max(1, attempt - 1)} failed: ${
        pending.lastFailure.message
      }`,
    };
  }
  return { status: 'Scheduled', waitingFor: 'Waiting for a worker' };
}

const lastAttempt = (node: Step) => node.attempts?.[node.attempts.length - 1];

/** Reads the events of one run into steps, one event at a time. */
class StepReader {
  readonly nodes: Step[] = [];
  readonly llmEntries: LlmStepEntry[] = [];
  readonly eventGroups = new EventGroupCollector();
  lastEventId = 0;
  closeEvent: Json;
  private readonly llmEntry = new Map<Step, LlmStepEntry>();
  private readonly byKey = new Map<string, Step>();

  constructor(
    private readonly options: StepsOptions,
    private readonly details: boolean,
  ) {}

  read(event: Json): void {
    this.lastEventId = Math.max(this.lastEventId, num(event.eventId));
    const time = toIsoTime(event.eventTime);
    if (
      this.workflowEvent(event) ||
      this.activityEvent(event, time) ||
      this.timerEvent(event, time) ||
      this.signalEvent(event, time) ||
      this.updateEvent(event, time) ||
      this.childWorkflowEvent(event, time) ||
      this.markerEvent(event) ||
      this.workflowTaskEvent(event, time)
    ) {
      return;
    }
    this.otherEvent(event);
  }

  /** The decoded payloads of a step; undefined when details are not read. */
  private payloads(raw: Json): JsonValue | undefined {
    return this.details ? decodePayloads(raw) : undefined;
  }

  private add(
    key: string,
    event: Json,
    init: Omit<WorkflowGraphNode, 'id' | 'events'> & { id?: string },
  ): Step {
    const eventId = String(event.eventId ?? '');
    const node: Step = {
      ...init,
      id: init.id ?? `${init.kind}-${eventId}`,
      events: [],
      first: num(event.eventId),
    };
    if (this.details) {
      const summary = summaryOf(event);
      if (summary) {
        node.summary = summary;
      }
      const groups = this.eventGroups.add(node.id, event);
      if (groups) node.groups = groups;
    }
    this.nodes.push(node);
    this.byKey.set(key, node);
    return node;
  }

  private attach(node: Step | undefined, event: Json) {
    if (!node || !this.details) return;
    node.events.push(
      dropUndefined({
        eventId: String(event.eventId ?? ''),
        eventType: eventTypeName(event.eventType),
        eventTime: toIsoTime(event.eventTime),
      }),
    );
  }

  private close(
    node: Step | undefined,
    event: Json,
    status: WorkflowNodeStatus,
  ) {
    if (!node) return;
    node.status = status;
    node.last = num(event.eventId);
    const time = toIsoTime(event.eventTime);
    if (time) node.endTime = time;
    delete node.waitingFor;
    delete node.deadline;
  }

  private instant(node: Step, event: Json) {
    node.last = node.first;
    const time = toIsoTime(event.eventTime);
    if (time) {
      node.startTime = time;
      node.endTime = time;
    }
  }

  /** The start, the close and the cancel request of the workflow. */
  private workflowEvent(event: Json): boolean {
    let a: Json;
    a = event.workflowExecutionStartedEventAttributes;
    if (a) {
      const node = this.add('start', event, {
        id: 'start',
        kind: 'workflowStarted',
        name: 'Start',
        status: 'Completed',
        input: this.payloads(a.input) ?? null,
        details: dropUndefined({
          workflowType: a.workflowType?.name || undefined,
          taskQueue: a.taskQueue?.name || undefined,
          attempt: a.attempt ? num(a.attempt) : undefined,
          cronSchedule: a.cronSchedule || undefined,
          continuedFromRunId: a.continuedExecutionRunId || undefined,
        }),
      });
      this.instant(node, event);
      this.attach(node, event);
      return true;
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
      this.closeEvent = event;
      const node = this.add('end', event, {
        id: 'end',
        kind: 'workflowClosed',
        name: status === 'ContinuedAsNew' ? 'Continued as new' : 'End',
        status,
      });
      this.instant(node, event);
      this.attach(node, event);
      if (a.result) node.result = this.payloads(a.result) ?? null;
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
          namespace: this.options.namespace,
          workflowId: this.options.workflowId,
          runId: a.newExecutionRunId || undefined,
        });
        node.input = this.payloads(a.input);
      }
      return true;
    }
    a = event.workflowExecutionCancelRequestedEventAttributes;
    if (a) {
      const node = this.add(`cancel-${event.eventId}`, event, {
        kind: 'cancelRequest',
        name: 'Cancel requested',
        status: 'Completed',
        details: dropUndefined({
          cause: a.cause || undefined,
          identity: a.identity || undefined,
        }),
      });
      this.instant(node, event);
      this.attach(node, event);
      return true;
    }
    return false;
  }

  /** Activities, by `scheduledEventId`. */
  private activityEvent(event: Json, time: string | undefined): boolean {
    let a: Json;
    a = event.activityTaskScheduledEventAttributes;
    if (a) {
      const max = num(a.retryPolicy?.maximumAttempts);
      const node = this.add(`activity-${event.eventId}`, event, {
        kind: 'activity',
        name: a.activityType?.name ?? '',
        stepId: a.activityId || undefined,
        status: 'Scheduled',
        startTime: time,
        input: this.payloads(a.input),
        maximumAttempts: max > 0 ? max : undefined,
        details: dropUndefined({
          taskQueue: a.taskQueue?.name || undefined,
        }),
      });
      if (this.details) {
        const entry: LlmStepEntry = {
          node,
          step: dropUndefined({
            activityType: a.activityType?.name ?? '',
            activityId: a.activityId || undefined,
            summary: summaryOf(event),
          }),
          input: a.input,
          failures: [],
        };
        this.llmEntries.push(entry);
        this.llmEntry.set(node, entry);
      }
      this.attach(node, event);
      return true;
    }
    a = event.activityTaskStartedEventAttributes;
    if (a) {
      const node = this.byKey.get(`activity-${a.scheduledEventId}`);
      if (!node) return true;
      this.attach(node, event);
      const attempt = num(a.attempt) || 1;
      node.status = 'Running';
      node.attempt = attempt;
      node.attempts = [];
      if (attempt > 1 && a.lastFailure) {
        this.llmEntry.get(node)?.failures.unshift(a.lastFailure);
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
      return true;
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
      const node = this.byKey.get(`activity-${a.scheduledEventId}`);
      if (!node) return true;
      this.attach(node, event);
      this.close(node, event, status);
      if (a.result) node.result = this.payloads(a.result) ?? null;
      if (a.failure) node.failure = toWorkflowFailure(a.failure);
      const entry = this.llmEntry.get(node);
      if (entry && a.result) entry.result = a.result;
      if (entry && a.failure) entry.failures.unshift(a.failure);
      const current = lastAttempt(node);
      if (current) {
        current.status = status;
        if (node.failure) current.failure = node.failure;
      }
      return true;
    }
    a = event.activityTaskCancelRequestedEventAttributes;
    if (a) {
      this.attach(this.byKey.get(`activity-${a.scheduledEventId}`), event);
      return true;
    }
    return false;
  }

  /** Timers, by `startedEventId`. */
  private timerEvent(event: Json, time: string | undefined): boolean {
    let a: Json;
    a = event.timerStartedEventAttributes;
    if (a) {
      const ms = durationToMs(a.startToFireTimeout);
      const fires =
        time && ms !== undefined
          ? new Date(Date.parse(time) + ms).toISOString()
          : undefined;
      const node = this.add(`timer-${event.eventId}`, event, {
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
      this.attach(node, event);
      return true;
    }
    a = event.timerFiredEventAttributes;
    if (a) {
      const node = this.byKey.get(`timer-${a.startedEventId}`);
      this.attach(node, event);
      this.close(node, event, 'Completed');
      return true;
    }
    a = event.timerCanceledEventAttributes;
    if (a) {
      const node = this.byKey.get(`timer-${a.startedEventId}`);
      this.attach(node, event);
      this.close(node, event, 'Canceled');
      return true;
    }
    return false;
  }

  /** Signals received, and signals sent by `initiatedEventId`. */
  private signalEvent(event: Json, time: string | undefined): boolean {
    let a: Json;
    a = event.workflowExecutionSignaledEventAttributes;
    if (a) {
      const node = this.add(`signal-${event.eventId}`, event, {
        kind: 'signal',
        name: a.signalName ?? 'Signal',
        status: 'Completed',
        input: this.payloads(a.input),
        details: dropUndefined({ identity: a.identity || undefined }),
      });
      this.instant(node, event);
      this.attach(node, event);
      return true;
    }
    a = event.signalExternalWorkflowExecutionInitiatedEventAttributes;
    if (a) {
      const target = a.workflowExecution?.workflowId ?? '';
      const node = this.add(`signalSent-${event.eventId}`, event, {
        kind: 'signalSent',
        name: a.signalName ?? 'Signal',
        status: 'Running',
        startTime: time,
        waitingFor: `Signaling ${target}`,
        input: this.payloads(a.input),
        workflow: dropUndefined({
          namespace: a.namespace || this.options.namespace,
          workflowId: target,
          runId: a.workflowExecution?.runId || undefined,
        }),
      });
      this.attach(node, event);
      return true;
    }
    a = event.externalWorkflowExecutionSignaledEventAttributes;
    if (a) {
      const node = this.byKey.get(`signalSent-${a.initiatedEventId}`);
      this.attach(node, event);
      this.close(node, event, 'Completed');
      return true;
    }
    a = event.signalExternalWorkflowExecutionFailedEventAttributes;
    if (a) {
      const node = this.byKey.get(`signalSent-${a.initiatedEventId}`);
      this.attach(node, event);
      this.close(node, event, 'Failed');
      if (node) node.failure = failureFromCause(a.cause, 'Signal failed');
      return true;
    }
    return false;
  }

  /** Updates, by update ID. */
  private updateEvent(event: Json, time: string | undefined): boolean {
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
      let node = this.byKey.get(`update-${updateId}`);
      if (!node) {
        node = this.add(`update-${updateId}`, event, {
          kind: 'update',
          name: request?.input?.name ?? 'Update',
          stepId: updateId,
          status: 'Scheduled',
          startTime: time,
          input: this.payloads(request?.input?.args),
          details: dropUndefined({
            identity: request?.meta?.identity || undefined,
          }),
        });
      }
      this.attach(node, event);
      if (updateAdmitted) {
        node.waitingFor = 'Update waits to be accepted';
      }
      if (updateAccepted) {
        node.status = 'Running';
        node.waitingFor = 'Update handler running';
      }
      if (updateRejected) {
        this.close(node, event, 'Rejected');
        node.failure = toWorkflowFailure(updateRejected.failure) ?? {
          message: 'Update rejected',
        };
      }
      return true;
    }
    const a: Json = event.workflowExecutionUpdateCompletedEventAttributes;
    if (a) {
      const updateId: string = a.meta?.updateId ?? '';
      const node = this.byKey.get(`update-${updateId}`);
      this.attach(node, event);
      if (!node) return true;
      if (a.outcome?.failure) {
        this.close(node, event, 'Failed');
        node.failure = toWorkflowFailure(a.outcome.failure);
      } else {
        this.close(node, event, 'Completed');
        node.result = this.payloads(a.outcome?.success) ?? null;
      }
      return true;
    }
    return false;
  }

  /** Child workflows, by `initiatedEventId`. */
  private childWorkflowEvent(event: Json, time: string | undefined): boolean {
    let a: Json;
    a = event.startChildWorkflowExecutionInitiatedEventAttributes;
    if (a) {
      const node = this.add(`child-${event.eventId}`, event, {
        id: `child-${event.eventId}`,
        kind: 'childWorkflow',
        name: a.workflowType?.name ?? 'Child workflow',
        stepId: a.workflowId || undefined,
        status: 'Scheduled',
        startTime: time,
        waitingFor: `Starting child workflow ${a.workflowId ?? ''}`.trim(),
        input: this.payloads(a.input),
        workflow: {
          namespace: a.namespace || this.options.namespace,
          workflowId: a.workflowId ?? '',
        },
        details: dropUndefined({
          taskQueue: a.taskQueue?.name || undefined,
        }),
      });
      this.attach(node, event);
      return true;
    }
    a = event.startChildWorkflowExecutionFailedEventAttributes;
    if (a) {
      const node = this.byKey.get(`child-${a.initiatedEventId}`);
      this.attach(node, event);
      this.close(node, event, 'Failed');
      if (node) {
        node.failure = failureFromCause(
          a.cause,
          'Child workflow could not start',
        );
      }
      return true;
    }
    a = event.childWorkflowExecutionStartedEventAttributes;
    if (a) {
      const node = this.byKey.get(`child-${a.initiatedEventId}`);
      if (!node) return true;
      this.attach(node, event);
      node.status = 'Running';
      const runId = a.workflowExecution?.runId;
      if (node.workflow && runId) node.workflow.runId = runId;
      node.waitingFor = `Waiting for child workflow ${
        node.workflow?.workflowId ?? ''
      }`.trim();
      return true;
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
      const node = this.byKey.get(`child-${a.initiatedEventId}`);
      if (!node) return true;
      this.attach(node, event);
      this.close(node, event, status);
      if (a.result) node.result = this.payloads(a.result) ?? null;
      if (a.failure) node.failure = toWorkflowFailure(a.failure);
      if (status === 'TimedOut' && !node.failure) {
        node.failure = { message: 'Child workflow timed out' };
      }
      if (status === 'Terminated' && !node.failure) {
        node.failure = { message: 'Child workflow was terminated' };
      }
      return true;
    }
    return false;
  }

  /** Markers, for example local activities and side effects. */
  private markerEvent(event: Json): boolean {
    const a: Json = event.markerRecordedEventAttributes;
    if (a) {
      const markerName: string = a.markerName ?? 'Marker';
      const isLocalActivity = isLocalActivityMarker(markerName);
      const details: JsonObject = {};
      for (const [k, v] of Object.entries(a.details ?? {})) {
        details[k] = this.payloads(v) ?? null;
      }
      const node = this.add(`marker-${event.eventId}`, event, {
        kind: 'marker',
        name: isLocalActivity ? 'Local activity' : markerName,
        status: a.failure ? 'Failed' : 'Completed',
        failure: toWorkflowFailure(a.failure),
        input: Object.keys(details).length > 0 ? details : undefined,
        details: { markerName },
      });
      this.instant(node, event);
      this.attach(node, event);
      return true;
    }
    return false;
  }

  /** Workflow tasks: internal steps, unless one failed. */
  private workflowTaskEvent(event: Json, time: string | undefined): boolean {
    let a: Json;
    a = event.workflowTaskScheduledEventAttributes;
    if (a) {
      const node = this.add(`wft-${event.eventId}`, event, {
        id: `workflowTask-${event.eventId}`,
        kind: 'workflowTask',
        name: 'Workflow task',
        status: 'Scheduled',
        internal: true,
        startTime: time,
        attempt: a.attempt ? num(a.attempt) : undefined,
      });
      this.attach(node, event);
      return true;
    }
    a = event.workflowTaskStartedEventAttributes;
    if (a) {
      const node = this.byKey.get(`wft-${a.scheduledEventId}`);
      this.attach(node, event);
      if (node) node.status = 'Running';
      return true;
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
      const node = this.byKey.get(`wft-${a.scheduledEventId}`);
      this.attach(node, event);
      this.close(node, event, status);
      if (node && status === 'Failed') {
        // A failing workflow task blocks the run; it is shown in the graph.
        node.internal = false;
        node.name = 'Workflow task failed';
        node.failure =
          toWorkflowFailure(a.failure) ??
          failureFromCause(a.cause, 'Workflow task failed');
      }
      return true;
    }
    return false;
  }

  /** Any other event: an internal step of its own. */
  private otherEvent(event: Json): void {
    const eventType = eventTypeName(event.eventType);
    const attributesKey = Object.keys(event).find(k =>
      k.endsWith('EventAttributes'),
    );
    const node = this.add(`event-${event.eventId}`, event, {
      kind: 'event',
      name: eventType,
      status: 'Completed',
      internal: true,
      details:
        attributesKey && this.details
          ? (toDisplayJson(event[attributesKey]) as JsonObject)
          : undefined,
    });
    this.instant(node, event);
    this.attach(node, event);
  }
}

/**
 * The steps of a run, from its events (protobuf JSON, oldest first) and the
 * pending activities of describe. Without `details`, only what tells where
 * the run is: the kind, name, status, times and failure of each step. With
 * them, also what a step shows: its payloads, summary, events and event
 * groups, and the payloads the LLM adapters read.
 */
export function readSteps(
  events: Json[],
  options: StepsOptions,
  read: { details: boolean },
): Steps {
  const reader = new StepReader(options, read.details);
  for (const event of events) reader.read(event);
  const { nodes } = reader;

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
    const state = pendingActivityState(pending);
    node.status = state.status;
    node.waitingFor = state.waitingFor;
    if (pending.state === 'Started') {
      node.attempts.push(
        dropUndefined({
          attempt,
          status: 'Running' as const,
          startedTime: pending.lastStartedTime,
        }),
      );
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
  return {
    nodes,
    lastEventId: reader.lastEventId,
    closeEvent: reader.closeEvent,
    llmEntries: reader.llmEntries,
    eventGroups: reader.eventGroups,
  };
}
