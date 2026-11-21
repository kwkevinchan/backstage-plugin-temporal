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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

const ref = 'component:default/orders';
const run = '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run';

/** Texts that only the history level may see. */
const HIDDEN = [
  'stack-of-card-4242',
  'cause-of-card-4242',
  'root-of-card-4242',
  'details-of-card-4242',
];

const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A failure with a stack trace, details and a cause chain of two. */
function failure(message: string, type: string) {
  return {
    message,
    source: 'TypeScriptSDK',
    stackTrace: `Error: ${message}\n    at charge (stack-of-card-4242.ts:1)`,
    applicationFailureInfo: {
      type,
      nonRetryable: true,
      details: {
        payloads: [
          {
            metadata: { encoding: b64('json/plain') },
            data: b64('"details-of-card-4242"'),
          },
        ],
      },
    },
    cause: {
      message: 'cause-of-card-4242',
      stackTrace: 'Error: cause\n    at stack-of-card-4242.ts:2',
      applicationFailureInfo: { type: 'Gateway' },
      cause: {
        message: 'root-of-card-4242',
        applicationFailureInfo: { type: 'Socket' },
      },
    },
  };
}

const closeEvent = {
  eventId: '8',
  eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED',
  workflowExecutionFailedEventAttributes: {
    failure: failure('Payment failed', 'PaymentError'),
  },
};

/** A run whose activity failed twice and whose workflow then failed. */
const failedRun = [
  {
    eventId: '1',
    eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
    workflowExecutionStartedEventAttributes: {},
  },
  {
    eventId: '5',
    eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
    activityTaskScheduledEventAttributes: {
      activityId: '1',
      activityType: { name: 'charge' },
    },
  },
  {
    eventId: '6',
    eventType: 'EVENT_TYPE_ACTIVITY_TASK_STARTED',
    activityTaskStartedEventAttributes: {
      scheduledEventId: '5',
      attempt: 2,
      lastFailure: failure('Card declined', 'CardError'),
    },
  },
  {
    eventId: '7',
    eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED',
    activityTaskFailedEventAttributes: {
      scheduledEventId: '5',
      failure: failure('Card declined', 'CardError'),
    },
  },
  closeEvent,
];

/** A running run whose activity waits for its next attempt. */
const retryingRun = failedRun.slice(0, 2);

async function start(options: { history: boolean; running?: boolean }) {
  const workflowService = createFakeWorkflowService();
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) =>
      ({
        workflowExecutionInfo: executionInfo({
          workflowId: req.execution.workflowId,
          status: options.running
            ? 'WORKFLOW_EXECUTION_STATUS_RUNNING'
            : 'WORKFLOW_EXECUTION_STATUS_FAILED',
        }),
        pendingActivities: options.running
          ? [
              {
                activityId: '1',
                activityType: { name: 'charge' },
                state: 'PENDING_ACTIVITY_STATE_SCHEDULED',
                attempt: 3,
                lastFailure: failure('Card declined', 'CardError'),
              },
            ]
          : [],
      } as any),
  );
  const close = options.running ? [] : [closeEvent];
  workflowService.getWorkflowExecutionHistoryReverse.mockImplementation(
    async () => ({ history: { events: structuredClone(close) } } as any),
  );
  workflowService.getWorkflowExecutionHistory.mockImplementation(
    async (req: any) => {
      const filter = req?.historyEventFilterType;
      const onlyClose =
        filter === 2 ||
        filter === 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT' ||
        filter === 'CLOSE_EVENT';
      let events = options.running ? retryingRun : failedRun;
      if (onlyClose) events = close;
      return {
        history: { events: structuredClone(events) },
        nextPageToken: new Uint8Array(),
      } as any;
    },
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result:
          !options.history &&
          r.permission.name.startsWith('temporal.workflow.history')
            ? AuthorizeResult.DENY
            : AuthorizeResult.ALLOW,
      })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map((r: any) => ({
        result:
          !options.history &&
          r.permission.name.startsWith('temporal.workflow.history')
            ? AuthorizeResult.DENY
            : AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      mockServices.rootConfig.factory({ data: { temporal: {} } }),
    ],
  });
  return withOpenApiValidation(server);
}

/** Fails when the response has any text of {@link HIDDEN}. */
function expectNoFailureDetails(body: unknown) {
  const text = JSON.stringify(body);
  for (const hidden of HIDDEN) expect(text).not.toContain(hidden);
}

describe('failures by permission level', () => {
  describe('without the history permission', () => {
    it('gives the details of a run only the type and message of its failure', async () => {
      const server = await start({ history: false });
      const res = await request(server).get(`${run}?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.failure).toEqual({
        message: 'Payment failed',
        kind: 'ApplicationFailure',
        type: 'PaymentError',
      });
      expect(res.body.failureDetailsHidden).toBe(true);
      expectNoFailureDetails(res.body);
    });

    it('does the same for the last failure of a pending activity', async () => {
      const server = await start({ history: false, running: true });
      const res = await request(server).get(`${run}?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.pendingActivities[0].lastFailure).toEqual({
        message: 'Card declined',
        kind: 'ApplicationFailure',
        type: 'CardError',
      });
      expectNoFailureDetails(res.body);

      const graph = await request(server).get(`${run}/graph?entityRef=${ref}`);
      expect(graph.status).toBe(200);
      const step = graph.body.nodes.find((n: any) => n.kind === 'activity');
      expect(step.attempts[0].failure).toEqual({
        message: 'Card declined',
        kind: 'ApplicationFailure',
        type: 'CardError',
      });
      expect(step.waitingFor).toBe(
        'Retrying after attempt 2 failed: Card declined',
      );
      expectNoFailureDetails(graph.body);

      const progress = await request(server).get(
        `${run}/progress?entityRef=${ref}`,
      );
      expect(progress.status).toBe(200);
      expect(progress.body.current).toBe(
        'charge: Retrying after attempt 2 failed: Card declined',
      );
      expectNoFailureDetails(progress.body);
    });

    it('gives the graph only the type and message of each failure', async () => {
      const server = await start({ history: false });
      const res = await request(server).get(`${run}/graph?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.payloadsHidden).toBe(true);
      const step = res.body.nodes.find((n: any) => n.kind === 'activity');
      const summary = {
        message: 'Card declined',
        kind: 'ApplicationFailure',
        type: 'CardError',
      };
      expect(step.failure).toEqual(summary);
      expect(step.attempts.map((a: any) => a.failure)).toEqual([
        summary,
        summary,
      ]);
      const end = res.body.nodes.find((n: any) => n.kind === 'workflowClosed');
      expect(end.failure).toEqual({
        message: 'Payment failed',
        kind: 'ApplicationFailure',
        type: 'PaymentError',
      });
      // The close event's failure has no activity in its causes: the summary
      // is its outermost message, which the read level may see.
      expect(res.body.current).toBe('Payment failed');
      expectNoFailureDetails(res.body);
    });

    it('keeps the progress and the lists free of failure details', async () => {
      const server = await start({ history: false });
      const progress = await request(server).get(
        `${run}/progress?entityRef=${ref}`,
      );
      expect(progress.status).toBe(200);
      expect(progress.body.current).toBe('Payment failed');
      expectNoFailureDetails(progress.body);

      for (const path of [
        '/api/temporal/entities/component/default/orders/workflows',
        '/api/temporal/workflows?namespace=default',
        `/api/temporal/namespaces/default/workflows/wf-1?entityRef=${ref}`,
      ]) {
        const res = await request(server).get(path);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeGreaterThan(0);
        expectNoFailureDetails(res.body);
      }
    });

    it('does not give the result route', async () => {
      const server = await start({ history: false });
      const res = await request(server).get(`${run}/result?entityRef=${ref}`);
      expect(res.status).toBe(403);
      expectNoFailureDetails(res.body);
    });
  });

  describe('with the history permission', () => {
    it('gives the details of a run its whole failure', async () => {
      const server = await start({ history: true });
      const res = await request(server).get(`${run}?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.failureDetailsHidden).toBeUndefined();
      expect(res.body.failure).toMatchObject({
        message: 'Payment failed',
        type: 'PaymentError',
        source: 'TypeScriptSDK',
        nonRetryable: true,
        stackTrace: expect.stringContaining('stack-of-card-4242'),
        cause: {
          message: 'cause-of-card-4242',
          cause: { message: 'root-of-card-4242' },
        },
      });
    });

    it('gives the graph the whole failures', async () => {
      const server = await start({ history: true });
      const res = await request(server).get(`${run}/graph?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.payloadsHidden).toBe(false);
      const step = res.body.nodes.find((n: any) => n.kind === 'activity');
      expect(step.failure).toMatchObject({
        stackTrace: expect.stringContaining('stack-of-card-4242'),
        cause: { message: 'cause-of-card-4242' },
      });
      expect(step.attempts[0].failure.cause.cause.message).toBe(
        'root-of-card-4242',
      );
    });

    it('gives the whole failure from the result route', async () => {
      const server = await start({ history: true });
      const res = await request(server).get(`${run}/result?entityRef=${ref}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'Failed',
        failure: {
          message: 'Payment failed',
          kind: 'ApplicationFailure',
          type: 'PaymentError',
          source: 'TypeScriptSDK',
          stackTrace: expect.stringContaining('stack-of-card-4242'),
          nonRetryable: true,
          cause: {
            message: 'cause-of-card-4242',
            kind: 'ApplicationFailure',
            type: 'Gateway',
            stackTrace: expect.stringContaining('stack-of-card-4242'),
            nonRetryable: false,
            cause: {
              message: 'root-of-card-4242',
              kind: 'ApplicationFailure',
              type: 'Socket',
              nonRetryable: false,
            },
          },
        },
      });
    });
  });
});
