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

import type { PendingActivity } from '../common';
import { GRAPH_PENDING_ACTIVITY_FIELDS } from '../common/stepRules';
import { buildWorkflowGraph, BuildGraphOptions } from './graph';
import { waitingHint } from './graphProgress';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payloads = (...values: unknown[]) => ({
  payloads: values.map(value => ({
    metadata: { encoding: b64('json/plain') },
    data: b64(JSON.stringify(value)),
  })),
});

/** Builds history events in protobuf JSON form, numbered from 1. */
function history() {
  const events: any[] = [];
  const base = Date.parse('2026-01-01T00:00:00Z');
  const api = {
    events,
    add(type: string, attributes: Record<string, unknown> = {}) {
      const eventId = events.length + 1;
      const key = `${type.charAt(0).toLowerCase()}${type.slice(
        1,
      )}EventAttributes`;
      const snake = type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
      events.push({
        eventId: String(eventId),
        eventTime: { seconds: String(base / 1000 + eventId) },
        eventType: `EVENT_TYPE_${snake}`,
        [key]: attributes,
      });
      return eventId;
    },
    start(input: unknown = { id: 1 }) {
      return api.add('WorkflowExecutionStarted', {
        workflowType: { name: 'orderWorkflow' },
        taskQueue: { name: 'orders' },
        input: payloads(input),
      });
    },
    /** One workflow task, scheduled, started and completed. */
    task() {
      const scheduled = api.add('WorkflowTaskScheduled', {});
      api.add('WorkflowTaskStarted', { scheduledEventId: String(scheduled) });
      return api.add('WorkflowTaskCompleted', {
        scheduledEventId: String(scheduled),
      });
    },
    schedule(activityType: string, activityId: string, input?: unknown) {
      return api.add('ActivityTaskScheduled', {
        activityId,
        activityType: { name: activityType },
        input: input === undefined ? undefined : payloads(input),
        retryPolicy: { maximumAttempts: 3 },
      });
    },
    started(scheduledEventId: number, attempt = 1, lastFailure?: unknown) {
      return api.add('ActivityTaskStarted', {
        scheduledEventId: String(scheduledEventId),
        attempt,
        lastFailure,
      });
    },
    completed(scheduledEventId: number, result: unknown) {
      return api.add('ActivityTaskCompleted', {
        scheduledEventId: String(scheduledEventId),
        result: payloads(result),
      });
    },
  };
  return api;
}

const options = (
  overrides: Partial<BuildGraphOptions> = {},
): BuildGraphOptions => ({
  namespace: 'default',
  workflowId: 'wf-1',
  status: 'Completed',
  truncated: false,
  ...overrides,
});

const visibleIds = (graph: ReturnType<typeof buildWorkflowGraph>) =>
  graph.nodes.filter(n => !n.internal).map(n => n.id);
const edgePairs = (graph: ReturnType<typeof buildWorkflowGraph>) =>
  graph.edges.map(e => `${e.source}>${e.target}`);

describe('buildWorkflowGraph', () => {
  it('reads the summary the workflow gave a step', () => {
    const h = history();
    h.start();
    h.task();
    const charge = h.schedule('chargeCard', '1');
    // Temporal user metadata: a json/plain payload on the event itself.
    h.events[charge - 1].userMetadata = {
      summary: payloads('Charge order 1001\nsecond line').payloads[0],
    };
    h.started(charge);
    h.completed(charge, { ok: true });
    const plain = h.schedule('sendEmail', '2');
    h.started(plain);
    h.completed(plain, {});
    const graph = buildWorkflowGraph(h.events, options());
    const byName = (name: string) => graph.nodes.find(n => n.name === name)!;
    expect(byName('chargeCard').summary).toBe('Charge order 1001');
    expect(byName('sendEmail').summary).toBeUndefined();
  });

  it('links sequential activities in event order', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('reserveStock', '1', { sku: 'A' });
    h.started(a);
    h.completed(a, { ok: true });
    h.task();
    const b = h.schedule('chargeCard', '2');
    h.started(b);
    h.completed(b, 'paid');
    h.task();
    h.add('WorkflowExecutionCompleted', { result: payloads('done') });

    const graph = buildWorkflowGraph(h.events, options());
    expect(visibleIds(graph)).toEqual([
      'start',
      `activity-${a}`,
      `activity-${b}`,
      'end',
    ]);
    expect(edgePairs(graph)).toEqual([
      `start>activity-${a}`,
      `activity-${a}>activity-${b}`,
      `activity-${b}>end`,
    ]);
    const reserve = graph.nodes.find(n => n.id === `activity-${a}`)!;
    expect(reserve).toMatchObject({
      kind: 'activity',
      name: 'reserveStock',
      stepId: '1',
      status: 'Completed',
      attempt: 1,
      maximumAttempts: 3,
      input: { encoding: 'json/plain', value: { sku: 'A' } },
      result: { encoding: 'json/plain', value: { ok: true } },
    });
    expect(reserve.events.map(e => e.eventType)).toEqual([
      'ActivityTaskScheduled',
      'ActivityTaskStarted',
      'ActivityTaskCompleted',
    ]);
    expect(graph.nodes.find(n => n.id === 'end')).toMatchObject({
      status: 'Completed',
      result: { value: 'done' },
    });
    expect(graph).toMatchObject({ completedSteps: 2, totalSteps: 2 });
    expect(graph.current).toBeUndefined();
    // Workflow tasks are internal steps.
    expect(
      graph.nodes.filter(n => n.kind === 'workflowTask').every(n => n.internal),
    ).toBe(true);
  });

  it('turns overlapping activities into parallel branches', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('pick', '1');
    const b = h.schedule('pack', '2');
    h.started(a);
    h.started(b);
    h.completed(b, 'packed');
    h.task();
    h.completed(a, 'picked');
    h.task();
    const c = h.schedule('ship', '3');
    h.started(c);
    h.completed(c, 'shipped');
    h.task();
    h.add('WorkflowExecutionCompleted', {});

    const graph = buildWorkflowGraph(h.events, options());
    expect(edgePairs(graph).sort()).toEqual(
      [
        `start>activity-${a}`,
        `start>activity-${b}`,
        `activity-${a}>activity-${c}`,
        `activity-${b}>activity-${c}`,
        `activity-${c}>end`,
      ].sort(),
    );
  });

  it('keeps retries and the failure of an activity', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('chargeCard', '1', { cardLast4: '4242' });
    h.started(a, 3, { message: 'Timeout talking to bank' });
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(a),
      failure: {
        message: 'Card declined',
        applicationFailureInfo: { type: 'CardDeclined', nonRetryable: true },
      },
    });
    h.task();
    h.add('WorkflowExecutionFailed', {
      failure: {
        message: 'Payment failed',
        applicationFailureInfo: {},
        cause: {
          message: 'Activity task failed',
          activityFailureInfo: {
            scheduledEventId: String(a),
            activityType: { name: 'chargeCard' },
          },
        },
      },
    });

    const graph = buildWorkflowGraph(h.events, options({ status: 'Failed' }));
    const node = graph.nodes.find(n => n.id === `activity-${a}`)!;
    expect(node.status).toBe('Failed');
    expect(node.attempt).toBe(3);
    expect(node.attempts).toEqual([
      {
        attempt: 2,
        status: 'Failed',
        failure: { message: 'Timeout talking to bank' },
      },
      expect.objectContaining({
        attempt: 3,
        status: 'Failed',
        failure: expect.objectContaining({ message: 'Card declined' }),
      }),
    ]);
    expect(node.failure).toMatchObject({
      message: 'Card declined',
      type: 'CardDeclined',
    });
    expect(graph.current).toBe('Failed at chargeCard');
    expect(graph.nodes.find(n => n.id === 'end')).toMatchObject({
      status: 'Failed',
      failure: { message: 'Payment failed' },
    });
    expect(graph.completedSteps).toBe(0);
  });

  it('shows a running timer as the current step', () => {
    const h = history();
    h.start();
    h.task();
    const t = h.add('TimerStarted', {
      timerId: '1',
      startToFireTimeout: { seconds: '30' },
    });

    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    const timer = graph.nodes.find(n => n.id === `timer-${t}`)!;
    expect(timer).toMatchObject({
      kind: 'timer',
      name: 'Timer 30s',
      status: 'Waiting',
      details: { duration: '30s' },
    });
    // The time stays a timestamp; the browser shows it in the user's zone.
    expect(timer.waitingFor).toBeUndefined();
    expect(timer.deadline).toEqual({
      time: '2026-01-01T00:00:35.000Z',
      kind: 'fires',
    });
    expect(timer.details).not.toHaveProperty('firesAt');
    expect(graph.nodes.some(n => n.kind === 'waiting')).toBe(false);
    expect(graph.current).toBe('Timer 30s');
    expect(graph.currentDeadline).toEqual(timer.deadline);

    h.add('TimerFired', { timerId: '1', startedEventId: String(t) });
    const fired = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(fired.nodes.find(n => n.id === `timer-${t}`)!.status).toBe(
      'Completed',
    );
    // Nothing open: the run waits for something outside.
    expect(fired.nodes.find(n => n.kind === 'waiting')).toMatchObject({
      waitingFor: 'Waiting for an external event (signal or update)',
    });
    expect(edgePairs(fired)).toContain(`timer-${t}>waiting`);
  });

  it('shows a waiting hint before the timer of a wait with a time limit', () => {
    // condition(() => approved, '24 hours') with ApprovalPending = true.
    const h = history();
    h.start();
    h.task();
    const t = h.add('TimerStarted', {
      timerId: '1',
      startToFireTimeout: { seconds: String(24 * 3600) },
    });

    const graph = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        searchAttributes: { ApprovalPending: true },
      }),
    );
    const timer = graph.nodes.find(n => n.id === `timer-${t}`)!;
    expect(timer).toMatchObject({
      name: 'Timer 24h',
      status: 'Waiting',
      waitingFor: 'Waiting for approval',
      deadline: { time: '2026-01-02T00:00:05.000Z', kind: 'timeout' },
    });
    expect(graph.current).toBe('Waiting for approval');
    expect(graph.currentDeadline).toEqual(timer.deadline);
    expect(graph.nodes.some(n => n.kind === 'waiting')).toBe(false);

    // Without the hint the timer is a plain timer.
    const plain = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        searchAttributes: { ApprovalPending: false },
      }),
    );
    expect(plain.current).toBe('Timer 24h');
    expect(plain.currentDeadline?.kind).toBe('fires');

    // An open activity next to the timer keeps its own text.
    const a = h.schedule('notify', '2');
    const busy = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        searchAttributes: { ApprovalPending: true },
      }),
    );
    expect(busy.nodes.find(n => n.id === `timer-${t}`)!.waitingFor).toBe(
      undefined,
    );
    expect(busy.nodes.find(n => n.id === `activity-${a}`)!.status).toBe(
      'Scheduled',
    );
    expect(busy.currentDeadline).toBeUndefined();

    // A fired timer has no deadline any more.
    h.add('TimerFired', { timerId: '1', startedEventId: String(t) });
    const fired = buildWorkflowGraph(
      h.events,
      options({ searchAttributes: { ApprovalPending: true } }),
    );
    expect(fired.nodes.find(n => n.id === `timer-${t}`)!.deadline).toBe(
      undefined,
    );
  });

  it('groups updates by update ID, including rejected ones', () => {
    const h = history();
    h.start();
    h.task();
    const accepted = h.add('WorkflowExecutionUpdateAccepted', {
      protocolInstanceId: 'u-1',
      acceptedRequest: {
        meta: { updateId: 'u-1', identity: 'cli' },
        input: { name: 'approve', args: payloads({ approver: 'kim' }) },
      },
    });
    h.add('WorkflowExecutionUpdateCompleted', {
      meta: { updateId: 'u-1' },
      acceptedEventId: String(accepted),
      outcome: { success: payloads('approved') },
    });
    const rejected = h.add('WorkflowExecutionUpdateRejected', {
      protocolInstanceId: 'u-2',
      rejectedRequest: {
        meta: { updateId: 'u-2' },
        input: { name: 'approve', args: payloads({}) },
      },
      failure: { message: 'approver is required', applicationFailureInfo: {} },
    });
    h.add('WorkflowExecutionUpdateAccepted', {
      protocolInstanceId: 'u-3',
      acceptedRequest: {
        meta: { updateId: 'u-3' },
        input: { name: 'cancelOrder' },
      },
    });
    h.add('WorkflowExecutionUpdateCompleted', {
      meta: { updateId: 'u-3' },
      outcome: { failure: { message: 'too late' } },
    });

    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    const updates = graph.nodes.filter(n => n.kind === 'update');
    expect(updates.map(u => [u.stepId, u.name, u.status])).toEqual([
      ['u-1', 'approve', 'Completed'],
      ['u-2', 'approve', 'Rejected'],
      ['u-3', 'cancelOrder', 'Failed'],
    ]);
    expect(updates[0]).toMatchObject({
      input: { value: { approver: 'kim' } },
      result: { value: 'approved' },
      details: { identity: 'cli' },
    });
    expect(updates[0].events).toHaveLength(2);
    expect(updates[1].id).toBe(`update-${rejected}`);
    expect(updates[1].failure?.message).toBe('approver is required');
    expect(updates[2].failure?.message).toBe('too late');
  });

  it('links a child workflow to its own run', () => {
    const h = history();
    h.start();
    h.task();
    const initiated = h.add('StartChildWorkflowExecutionInitiated', {
      namespace: 'default',
      workflowId: 'child-1',
      workflowType: { name: 'notifyWorkflow' },
      input: payloads({ to: 'kim' }),
    });
    h.add('ChildWorkflowExecutionStarted', {
      initiatedEventId: String(initiated),
      workflowExecution: { workflowId: 'child-1', runId: 'run-c' },
    });
    const running = buildWorkflowGraph(
      h.events,
      options({ status: 'Running' }),
    );
    expect(
      running.nodes.find(n => n.id === `child-${initiated}`),
    ).toMatchObject({
      kind: 'childWorkflow',
      name: 'notifyWorkflow',
      status: 'Running',
      waitingFor: 'Waiting for child workflow child-1',
      workflow: { namespace: 'default', workflowId: 'child-1', runId: 'run-c' },
    });
    expect(running.current).toBe(
      'notifyWorkflow: Waiting for child workflow child-1',
    );

    h.add('ChildWorkflowExecutionCompleted', {
      initiatedEventId: String(initiated),
      result: payloads('sent'),
    });
    const done = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(done.nodes.find(n => n.id === `child-${initiated}`)).toMatchObject({
      status: 'Completed',
      result: { value: 'sent' },
    });
    expect(done.completedSteps).toBe(1);
  });

  it('ends a continued-as-new run with a link to the next run', () => {
    const h = history();
    h.start();
    h.task();
    h.add('WorkflowExecutionContinuedAsNew', {
      newExecutionRunId: 'run-2',
      input: payloads({ page: 2 }),
    });
    const graph = buildWorkflowGraph(
      h.events,
      options({ status: 'ContinuedAsNew' }),
    );
    expect(graph.nodes.find(n => n.id === 'end')).toMatchObject({
      kind: 'workflowClosed',
      name: 'Continued as new',
      status: 'ContinuedAsNew',
      workflow: { namespace: 'default', workflowId: 'wf-1', runId: 'run-2' },
      input: { value: { page: 2 } },
    });
    expect(graph.current).toBe('Continued as new');
    expect(edgePairs(graph)).toEqual(['start>end']);
    expect(graph.runChain).toEqual({ nextRunId: 'run-2' });
  });

  it('links a run to the run it continued from', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {
      workflowType: { name: 'pollWorkflow' },
      continuedExecutionRunId: 'run-1',
    });
    h.task();
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.runChain).toEqual({ previousRunId: 'run-1' });

    const single = history();
    single.start();
    expect(
      buildWorkflowGraph(single.events, options()).runChain,
    ).toBeUndefined();
  });

  it('marks a truncated history and adds no waiting step', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('step', '1');
    h.started(a);
    h.completed(a, 1);
    const graph = buildWorkflowGraph(
      h.events,
      options({ status: 'Running', truncated: true }),
    );
    expect(graph.truncated).toBe(true);
    expect(graph.nodes.some(n => n.kind === 'waiting')).toBe(false);
    expect(graph.current).toBe('History is long; showing the start');
  });

  it('uses the pending activity for the current attempt', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('waitForUpstream', '7');
    const graph = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        pendingActivities: [
          {
            activityId: '7',
            activityType: 'waitForUpstream',
            state: 'Scheduled',
            attempt: 4,
            maximumAttempts: 10,
            lastFailure: { message: 'not ready' },
          },
        ],
      }),
    );
    expect(graph.nodes.find(n => n.id === `activity-${a}`)).toMatchObject({
      status: 'Retrying',
      attempt: 4,
      maximumAttempts: 10,
      waitingFor: 'Retrying after attempt 3 failed: not ready',
      attempts: [{ attempt: 3, status: 'Failed' }],
    });
    expect(graph.current).toBe(
      'waitForUpstream: Retrying after attempt 3 failed: not ready',
    );
  });

  it('reads only GRAPH_PENDING_ACTIVITY_FIELDS of a pending activity, which the frontend watches', () => {
    const h = history();
    h.start();
    h.task();
    h.schedule('waitForUpstream', '7');
    const pending: PendingActivity = {
      activityId: '7',
      activityType: 'waitForUpstream',
      state: 'Started',
      attempt: 2,
      maximumAttempts: 5,
      scheduledTime: '2026-01-01T00:00:01Z',
      lastStartedTime: '2026-01-01T00:00:02Z',
      lastHeartbeatTime: '2026-01-01T00:00:03Z',
      lastFailure: { message: 'not ready' },
    };
    const graphWith = (activity: PendingActivity) =>
      buildWorkflowGraph(
        h.events,
        options({ status: 'Running', pendingActivities: [activity] }),
      );
    const changed: Record<keyof PendingActivity, Partial<PendingActivity>> = {
      activityId: { activityId: '8' },
      activityType: { activityType: 'other' },
      state: { state: 'Scheduled' },
      attempt: { attempt: 3 },
      maximumAttempts: { maximumAttempts: 6 },
      scheduledTime: { scheduledTime: '2026-01-01T00:00:09Z' },
      lastStartedTime: { lastStartedTime: '2026-01-01T00:00:09Z' },
      lastHeartbeatTime: { lastHeartbeatTime: '2026-01-01T00:00:09Z' },
      lastFailure: { lastFailure: { message: 'still not ready' } },
    };
    const before = graphWith(pending);
    const read = (Object.keys(changed) as Array<keyof PendingActivity>).filter(
      field =>
        JSON.stringify(graphWith({ ...pending, ...changed[field] })) !==
        JSON.stringify(before),
    );
    // The activity type of an activity ID does not change, so the frontend
    // does not watch it; the graph shows it only for a truncated history.
    expect(new Set(read)).toEqual(new Set(GRAPH_PENDING_ACTIVITY_FIELDS));
  });

  it('records signals and uses a waiting hint from search attributes', () => {
    const h = history();
    h.start();
    h.task();
    const s = h.add('WorkflowExecutionSignaled', {
      signalName: 'comment',
      input: payloads('looks good'),
      identity: 'kim@host',
    });
    h.task();
    const graph = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        searchAttributes: { ApprovalPending: true },
      }),
    );
    expect(graph.nodes.find(n => n.id === `signal-${s}`)).toMatchObject({
      kind: 'signal',
      name: 'comment',
      input: { value: 'looks good' },
      details: { identity: 'kim@host' },
    });
    expect(graph.current).toBe('Waiting for approval');
    expect(edgePairs(graph)).toEqual([
      `start>signal-${s}`,
      `signal-${s}>waiting`,
    ]);
  });

  it('shows a failing workflow task', () => {
    const h = history();
    h.start();
    const scheduled = h.add('WorkflowTaskScheduled', {});
    h.add('WorkflowTaskStarted', { scheduledEventId: String(scheduled) });
    h.add('WorkflowTaskFailed', {
      scheduledEventId: String(scheduled),
      cause: 'WORKFLOW_TASK_FAILED_CAUSE_NON_DETERMINISTIC_ERROR',
      failure: { message: 'nondeterminism' },
    });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    const task = graph.nodes.find(n => n.kind === 'workflowTask')!;
    expect(task.internal).toBe(false);
    expect(task.failure?.message).toBe('nondeterminism');
    expect(graph.current).toBe('Workflow task failing: nondeterminism');
  });
});

describe('a workflow task that fails again', () => {
  it('names the latest failure, not the first', () => {
    const h = history();
    h.start();
    const failTask = (message: string) => {
      const scheduled = h.add('WorkflowTaskScheduled', {});
      h.add('WorkflowTaskStarted', { scheduledEventId: String(scheduled) });
      h.add('WorkflowTaskFailed', {
        scheduledEventId: String(scheduled),
        cause: 'WORKFLOW_TASK_FAILED_CAUSE_NON_DETERMINISTIC_ERROR',
        failure: { message },
      });
    };
    failTask('first failure');
    h.task();
    failTask('second failure');
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.current).toBe('Workflow task failing: second failure');
  });
});

describe('the current step', () => {
  /** A failure of activity `scheduledEventId`, as the workflow sees it. */
  const activityFailure = (
    scheduledEventId: number,
    activityType: string,
    cause: unknown = { message: 'boom', applicationFailureInfo: {} },
  ) => ({
    message: 'Activity task failed',
    activityFailureInfo: {
      scheduledEventId: String(scheduledEventId),
      activityType: { name: activityType },
    },
    cause,
  });

  it('uses the pending activities when the history is cut', () => {
    const h = history();
    h.start();
    h.task();
    // The history read stops here; the run went on to other activities.
    const early = h.schedule('prepare', '1');
    h.started(early);
    const graph = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        truncated: true,
        pendingActivities: [
          {
            activityId: '42',
            activityType: 'deploy',
            state: 'Started',
            attempt: 2,
          },
          {
            activityId: '43',
            activityType: 'notify',
            state: 'Scheduled',
            attempt: 3,
            lastFailure: { message: 'mail server down' },
          },
          { activityId: '44', activityType: 'audit', state: 'Scheduled' },
        ],
      }),
    );
    expect(graph.current).toBe(
      'deploy: Running attempt 2; notify: Retrying after attempt 2 failed: mail server down (+1 more)',
    );
    expect(graph.currentDeadline).toBeUndefined();
    // The graph still shows the start only.
    expect(graph.nodes.find(n => n.id === `activity-${early}`)!.status).toBe(
      'Running',
    );
    expect(graph.truncated).toBe(true);

    // The same activity in a history read to its end reads the same.
    const full = history();
    full.start();
    full.task();
    full.schedule('deploy', '42');
    expect(
      buildWorkflowGraph(
        full.events,
        options({
          status: 'Running',
          pendingActivities: [
            {
              activityId: '42',
              activityType: 'deploy',
              state: 'Started',
              attempt: 2,
            },
          ],
        }),
      ).current,
    ).toBe('deploy: Running attempt 2');
  });

  it('does not read the open steps of a cut history', () => {
    const h = history();
    h.start();
    h.task();
    h.add('TimerStarted', {
      timerId: '1',
      startToFireTimeout: { seconds: '30' },
    });
    const graph = buildWorkflowGraph(
      h.events,
      options({ status: 'Running', truncated: true }),
    );
    expect(graph.current).toBe('History is long; showing the start');
    expect(graph.currentDeadline).toBeUndefined();
  });

  it('does not blame an activity failure the workflow caught', () => {
    // try { await validate() } catch { ... }; later the workflow fails.
    const h = history();
    h.start();
    h.task();
    const caught = h.schedule('validate', '1');
    h.started(caught);
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(caught),
      failure: { message: 'invalid', applicationFailureInfo: {} },
    });
    h.task();
    const next = h.schedule('reserve', '2');
    h.started(next);
    h.completed(next, {});
    h.task();
    h.add('WorkflowExecutionFailed', {
      failure: { message: 'Out of stock', applicationFailureInfo: {} },
    });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Failed' }));
    expect(graph.current).toBe('Out of stock');
  });

  it('names the activity in the cause chain of the close event', () => {
    const h = history();
    h.start();
    h.task();
    const failing = h.schedule('charge', '1');
    const caught = h.schedule('notify', '2');
    h.started(failing);
    h.started(caught);
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(failing),
      failure: { message: 'declined', applicationFailureInfo: {} },
    });
    // The caught failure comes later in the history.
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(caught),
      failure: { message: 'mail down', applicationFailureInfo: {} },
    });
    h.task();
    h.add('WorkflowExecutionFailed', {
      failure: activityFailure(failing, 'charge'),
    });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Failed' }));
    expect(graph.current).toBe('Failed at charge');
  });

  it('reads the failure of a cut history from the close event', () => {
    const h = history();
    h.start();
    h.task();
    const early = h.schedule('prepare', '1');
    h.started(early);
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(early),
      failure: { message: 'caught', applicationFailureInfo: {} },
    });
    const closeEvent = {
      eventId: '9000',
      eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED',
      workflowExecutionFailedEventAttributes: {
        failure: activityFailure(8000, 'publish'),
      },
    };
    const failed = buildWorkflowGraph(
      h.events,
      options({ status: 'Failed', truncated: true, closeEvent }),
    );
    expect(failed.current).toBe('Failed at publish');

    // Without the close event, the failure from describe.
    const described = buildWorkflowGraph(
      h.events,
      options({
        status: 'Failed',
        truncated: true,
        failure: { message: 'Out of stock' },
      }),
    );
    expect(described.current).toBe('Out of stock');
  });

  it('uses the close message of terminated and timed out runs', () => {
    const h = history();
    h.start();
    h.task();
    const a = h.schedule('charge', '1');
    h.started(a);
    h.add('ActivityTaskFailed', {
      scheduledEventId: String(a),
      failure: { message: 'declined', applicationFailureInfo: {} },
    });
    h.task();
    const end = h.add('WorkflowExecutionTerminated', { reason: 'stuck' });
    expect(
      buildWorkflowGraph(h.events, options({ status: 'Terminated' })).current,
    ).toBe('Terminated: stuck');

    h.events.pop();
    expect(h.events.length).toBe(end - 1);
    h.add('WorkflowExecutionTimedOut', {});
    expect(
      buildWorkflowGraph(h.events, options({ status: 'TimedOut' })).current,
    ).toBe('Workflow execution timed out');
  });

  it('stops at a child workflow in the cause chain', () => {
    const h = history();
    h.start();
    h.task();
    const child = h.add('StartChildWorkflowExecutionInitiated', {
      workflowId: 'child-1',
      workflowType: { name: 'shipOrder' },
    });
    h.add('ChildWorkflowExecutionFailed', {
      initiatedEventId: String(child),
      failure: { message: 'child failed' },
    });
    h.task();
    h.add('WorkflowExecutionFailed', {
      failure: {
        message: 'Child workflow execution failed',
        childWorkflowExecutionFailureInfo: {
          initiatedEventId: String(child),
          workflowType: { name: 'shipOrder' },
        },
        // Event IDs of the child's own history.
        cause: activityFailure(child, 'unrelated'),
      },
    });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Failed' }));
    expect(graph.current).toBe('Failed at shipOrder');
  });

  it('does not turn an unrelated timer into the wait of a waiting hint', () => {
    // condition(() => approved, '24 hours') next to a sleep('5 minutes').
    const h = history();
    h.start();
    h.task();
    const wait = h.add('TimerStarted', {
      timerId: '1',
      startToFireTimeout: { seconds: String(24 * 3600) },
    });
    const sleep = h.add('TimerStarted', {
      timerId: '2',
      startToFireTimeout: { seconds: '300' },
    });
    const graph = buildWorkflowGraph(
      h.events,
      options({
        status: 'Running',
        searchAttributes: { ApprovalPending: true },
      }),
    );
    for (const id of [`timer-${wait}`, `timer-${sleep}`]) {
      const timer = graph.nodes.find(n => n.id === id)!;
      expect(timer.waitingFor).toBeUndefined();
      expect(timer.deadline?.kind).toBe('fires');
    }
    expect(graph.current).toBe('Timer 24h; Timer 5m');
  });
});

describe('waitingHint', () => {
  it('reads attributes that end with Pending', () => {
    expect(waitingHint({ ApprovalPending: true })).toBe('Waiting for approval');
    expect(waitingHint({ ManagerReviewPending: [true] })).toBe(
      'Waiting for manager review',
    );
    expect(waitingHint({ payment_pending: 'bank' })).toBe(
      'Waiting for payment: bank',
    );
    expect(waitingHint({ ApprovalPending: false })).toBeUndefined();
    expect(waitingHint({ Pending: true })).toBeUndefined();
    expect(waitingHint(undefined)).toBeUndefined();
  });
});
