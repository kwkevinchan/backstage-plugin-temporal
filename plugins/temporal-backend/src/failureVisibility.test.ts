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

async function start(options: { running?: boolean } = {}) {
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
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
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

describe('failures for a caller with the read permission', () => {
  it('gives the details of a run its whole failure', async () => {
    const server = await start();
    const res = await request(server).get(`${run}?entityRef=${ref}`);
    expect(res.status).toBe(200);
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

  it('gives the last failure of a pending activity its whole failure', async () => {
    const server = await start({ running: true });
    const res = await request(server).get(`${run}?entityRef=${ref}`);
    expect(res.status).toBe(200);
    expect(res.body.pendingActivities[0].lastFailure).toMatchObject({
      message: 'Card declined',
      type: 'CardError',
      stackTrace: expect.stringContaining('stack-of-card-4242'),
      cause: { message: 'cause-of-card-4242' },
    });
  });

  it('gives the graph the whole failures', async () => {
    const server = await start();
    const res = await request(server).get(`${run}/graph?entityRef=${ref}`);
    expect(res.status).toBe(200);
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
    const server = await start();
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
