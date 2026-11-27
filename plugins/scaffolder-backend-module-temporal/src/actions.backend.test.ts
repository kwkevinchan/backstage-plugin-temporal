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

import { createServiceFactory } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import temporalBackend from '@kwkevinchan/backstage-plugin-temporal-backend';
import {
  TemporalPluginClient,
  TemporalService,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { AddressInfo } from 'node:net';
import { createTemporalWorkflowWaitAction } from './actions';

const user = mockCredentials.user('user:default/alice');

function isCloseEventFilter(req: any): boolean {
  const t = req?.historyEventFilterType;
  return (
    t === 2 ||
    t === 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT' ||
    t === 'CLOSE_EVENT'
  );
}

describe('temporal:workflow:wait against the backend', () => {
  const backends: Array<{ stop(): Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(backends.map(b => b.stop()));
  });

  it('outputs the result of a long history from the close event only', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const getWorkflowExecutionHistory = jest.fn(async (req: any) => {
      if (isCloseEventFilter(req)) {
        return {
          history: {
            events: [
              {
                eventId: '6001',
                workflowExecutionCompletedEventAttributes: {
                  result: {
                    payloads: [
                      {
                        metadata: { encoding: b64('json/plain') },
                        data: b64(JSON.stringify('deployed')),
                      },
                    ],
                  },
                },
              },
            ],
          },
        };
      }
      // Oldest-first pages have no close event, as when the history is
      // longer than the former steps cap.
      return {
        history: {
          events: [
            { eventId: '1', workflowExecutionStartedEventAttributes: {} },
          ],
        },
        nextPageToken: new Uint8Array([1]),
      };
    });
    const workflowService = {
      describeWorkflowExecution: jest.fn(async () => ({
        workflowExecutionInfo: {
          execution: { workflowId: 'release-1', runId: 'run-1' },
          type: { name: 'release' },
          taskQueue: 'orders',
          status: 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
          startTime: { seconds: '1700000000', nanos: 0 },
          historyLength: '6000',
        },
        pendingActivities: [],
      })),
      getWorkflowExecutionHistory,
      getWorkflowExecutionHistoryReverse: jest.fn(),
      listWorkflowExecutions: jest.fn(),
      countWorkflowExecutions: jest.fn(),
    };
    const temporal: TemporalService = {
      getClient: async () => {
        throw new Error('not used');
      },
      getConnection: async () =>
        ({
          workflowService,
          withDeadline: async (
            _at: number | Date,
            fn: () => Promise<unknown>,
          ) => fn(),
        } as any),
      getDefaultNamespace: () => 'default',
      getAllowedNamespaces: () => ['default'],
      isNamespaceAllowed: ns => ns === 'default',
      getSearchAttributeNames: () => ({}),
      getWebUiUrl: () => undefined,
    };
    const backend = await startTestBackend({
      features: [
        temporalBackend,
        catalogServiceMock.factory({ entities: [] }),
        createServiceFactory({
          service: temporalServiceRef,
          deps: {},
          factory: () => temporal,
        }),
        mockServices.permissions.factory({ result: 'ALLOW' as any }),
        mockServices.rootConfig.factory({ data: { temporal: {} } }),
      ],
    });
    backends.push(backend);
    const { port } = backend.server.address() as AddressInfo;
    const discovery = mockServices.discovery.mock({
      getBaseUrl: async () => `http://localhost:${port}/api/temporal`,
    });
    const auth = mockServices.auth.mock({
      getPluginRequestToken: async () => ({
        token: mockCredentials.user.token('user:default/alice'),
      }),
    });
    const client = new TemporalPluginClient(discovery, auth);
    const ctx = createMockActionContext({
      input: {
        workflowId: 'release-1',
        runId: 'run-1',
        intervalSeconds: 1,
        includeResult: true,
      } as any,
    });
    Object.assign(ctx, {
      getInitiatorCredentials: async () => user,
      checkpoint: async ({ fn }: any) => fn(),
    });
    await createTemporalWorkflowWaitAction({
      client,
      catalog: catalogServiceMock({ entities: [] }),
      appBaseUrl: 'http://backstage/',
      defaultNamespace: 'default',
    }).handler(ctx);
    expect(ctx.output).toHaveBeenCalledWith('status', 'Completed');
    expect(ctx.output).toHaveBeenCalledWith('result', {
      encoding: 'json/plain',
      value: 'deployed',
    });
    expect(getWorkflowExecutionHistory).toHaveBeenCalledTimes(1);
    expect(
      isCloseEventFilter(getWorkflowExecutionHistory.mock.calls[0][0]),
    ).toBe(true);
  });
});
