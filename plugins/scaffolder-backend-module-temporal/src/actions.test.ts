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

import { mockCredentials } from '@backstage/backend-test-utils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import {
  createTemporalWorkflowSignalAction,
  createTemporalWorkflowStartAction,
  createTemporalWorkflowWaitAction,
} from './actions';
import { TemporalPluginClient } from './client';

const user = mockCredentials.user('user:default/alice');

function setup() {
  const client = {
    start: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'release-1',
      runId: 'run-1',
    }),
    describe: jest.fn(),
    steps: jest.fn(),
    send: jest.fn().mockResolvedValue({ result: { approved: true } }),
  };
  const options = {
    client: client as unknown as TemporalPluginClient,
    appBaseUrl: 'http://backstage/',
  };
  return { client, options };
}

function context(input: Record<string, unknown>, extra: object = {}) {
  // The mock context keeps its own credentials, checkpoint and dry run
  // flag; these are set on it afterwards.
  const ctx = createMockActionContext({ input: input as any });
  Object.assign(ctx, {
    getInitiatorCredentials: async () => user,
    checkpoint: async ({ fn }: any) => fn(),
    ...extra,
  });
  return ctx;
}

describe('temporal:workflow:start', () => {
  it('starts the workflow of an entity as the user and outputs it', async () => {
    const { client, options } = setup();
    const ctx = context({
      entityRef: 'temporalworkflow:default/release',
      args: { service: 'orders' },
    });
    await createTemporalWorkflowStartAction(options).handler(ctx);
    expect(client.start).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: 'temporalworkflow:default/release',
        args: [{ service: 'orders' }],
        namespace: undefined,
        // From the task and the step, so a retry cannot start a second one.
        workflowId: `release-${ctx.task.id}-${ctx.step!.id}`,
      }),
      user,
    );
    expect(ctx.output).toHaveBeenCalledWith('workflowId', 'release-1');
    expect(ctx.output).toHaveBeenCalledWith('runId', 'run-1');
    expect(ctx.output).toHaveBeenCalledWith(
      'workflowUrl',
      'http://backstage/temporal/namespaces/default/workflows/release-1/runs/run-1',
    );
  });

  it('needs an entity, or a workflow type and a task queue', async () => {
    const { client, options } = setup();
    await expect(
      createTemporalWorkflowStartAction(options).handler(
        context({ workflowType: 'orderWorkflow' }),
      ),
    ).rejects.toThrow('Give entityRef, or workflowType and taskQueue');
    expect(client.start).not.toHaveBeenCalled();
  });

  it('keeps the started workflow when the task is retried', async () => {
    const { client, options } = setup();
    const saved = { namespace: 'default', workflowId: 'old', runId: 'r0' };
    const ctx = context(
      { workflowType: 'orderWorkflow', taskQueue: 'orders', args: [1, 2] },
      { checkpoint: async () => saved },
    );
    await createTemporalWorkflowStartAction(options).handler(ctx);
    expect(client.start).not.toHaveBeenCalled();
    expect(ctx.output).toHaveBeenCalledWith('workflowId', 'old');
  });

  it('starts nothing in a dry run', async () => {
    const { client, options } = setup();
    const ctx = context(
      { workflowType: 'orderWorkflow', taskQueue: 'orders' },
      { isDryRun: true },
    );
    await createTemporalWorkflowStartAction(options).handler(ctx);
    expect(client.start).not.toHaveBeenCalled();
    expect(ctx.output).toHaveBeenCalledWith('workflowId', 'dry-run');
  });
});

describe('temporal:workflow:wait', () => {
  const running = { status: 'Running', runId: 'run-1', searchAttributes: {} };

  it('waits until the workflow closes and outputs its result', async () => {
    const { client, options } = setup();
    client.describe
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({ ...running, status: 'Completed' });
    client.steps.mockResolvedValue({ result: 'deployed', activities: [] });
    const ctx = context({
      workflowId: 'release-1',
      intervalSeconds: 1,
      includeResult: true,
    });
    await createTemporalWorkflowWaitAction(options).handler(ctx);
    expect(client.describe).toHaveBeenCalledTimes(2);
    expect(client.describe).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'release-1' },
      undefined,
      user,
    );
    expect(ctx.output).toHaveBeenCalledWith('status', 'Completed');
    expect(ctx.output).toHaveBeenCalledWith('result', 'deployed');
  });

  it('stops when a search attribute is true', async () => {
    const { client, options } = setup();
    client.describe.mockResolvedValue({
      ...running,
      searchAttributes: { ApprovalPending: true },
    });
    const ctx = context({
      workflowId: 'release-1',
      untilSearchAttribute: 'ApprovalPending',
    });
    await createTemporalWorkflowWaitAction(options).handler(ctx);
    expect(ctx.output).toHaveBeenCalledWith('status', 'Running');
    expect(client.steps).not.toHaveBeenCalled();
  });

  it('fails when the workflow does not complete', async () => {
    const { client, options } = setup();
    client.describe.mockResolvedValue({ ...running, status: 'Failed' });
    await expect(
      createTemporalWorkflowWaitAction(options).handler(
        context({ workflowId: 'release-1' }),
      ),
    ).rejects.toThrow('closed as Failed');
  });

  it('gives up after the timeout', async () => {
    const { client, options } = setup();
    client.describe.mockResolvedValue(running);
    await expect(
      createTemporalWorkflowWaitAction(options).handler(
        context({
          workflowId: 'release-1',
          timeoutSeconds: 1,
          intervalSeconds: 1,
        }),
      ),
    ).rejects.toThrow('still running after 1 seconds');
  });
});

describe('temporal:workflow:wait across runs', () => {
  it('follows the latest run when the given run continued as new', async () => {
    const { client, options } = setup();
    client.describe
      .mockResolvedValueOnce({ status: 'ContinuedAsNew', runId: 'run-1' })
      .mockResolvedValueOnce({ status: 'Completed', runId: 'run-2' });
    const ctx = context({ workflowId: 'long-1', runId: 'run-1' });
    await createTemporalWorkflowWaitAction(options).handler(ctx);
    expect(client.describe.mock.calls[1][0]).toEqual({
      namespace: 'default',
      workflowId: 'long-1',
    });
    expect(ctx.output).toHaveBeenCalledWith('runId', 'run-2');
  });

  it('looks a last time at the deadline', async () => {
    const { client, options } = setup();
    client.describe
      .mockResolvedValueOnce({ status: 'Running', runId: 'r' })
      .mockResolvedValueOnce({ status: 'Completed', runId: 'r' });
    const ctx = context({
      workflowId: 'w',
      timeoutSeconds: 1,
      intervalSeconds: 5,
    });
    await createTemporalWorkflowWaitAction(options).handler(ctx);
    expect(client.describe).toHaveBeenCalledTimes(2);
  });
});

describe('temporal:workflow:signal', () => {
  it('sends an update and outputs its result', async () => {
    const { client, options } = setup();
    const ctx = context({
      workflowId: 'release-1',
      namespace: 'billing',
      entityRef: 'component:default/orders',
      kind: 'update',
      name: 'approve',
      args: { approved: true },
    });
    await createTemporalWorkflowSignalAction(options).handler(ctx);
    expect(client.send).toHaveBeenCalledWith(
      'update',
      { namespace: 'billing', workflowId: 'release-1' },
      { name: 'approve', args: [{ approved: true }] },
      'component:default/orders',
      user,
    );
    expect(ctx.output).toHaveBeenCalledWith('result', { approved: true });
  });

  it('sends a signal', async () => {
    const { client, options } = setup();
    client.send.mockResolvedValue(undefined);
    const ctx = context({ workflowId: 'ticket-1', name: 'close' });
    await createTemporalWorkflowSignalAction(options).handler(ctx);
    expect(client.send).toHaveBeenCalledWith(
      'signal',
      { namespace: 'default', workflowId: 'ticket-1' },
      { name: 'close', args: [] },
      undefined,
      user,
    );
    expect(ctx.output).not.toHaveBeenCalled();
  });
});
