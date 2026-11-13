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
import { getTemporalWorkflowSource } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import {
  createTemporalWorkflowSignalAction,
  createTemporalWorkflowStartAction,
  createTemporalWorkflowWaitAction,
} from './actions';
import { TemporalPluginClient } from './client';

const user = mockCredentials.user('user:default/alice');

const entity = (
  kind: string,
  name: string,
  annotations: Record<string, string>,
) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: { name, namespace: 'default', annotations },
  spec: {},
});

/** Entities with a namespace, with none, and a TemporalWorkflow with one. */
const entities = [
  entity('Component', 'billing', {
    'temporal.io/workflow-type': 'billingWorkflow',
    'temporal.io/namespace': 'billing',
  }),
  entity('Component', 'plain', {
    'temporal.io/workflow-type': 'plainWorkflow',
  }),
  {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: { name: 'audit', namespace: 'default' },
    spec: {
      owner: 'group:default/a',
      workflowType: 'auditWorkflow',
      namespace: 'audit',
    },
  },
  entity('Component', 'broken', {
    'temporal.io/workflow-type': 'x',
    'temporal.io/namespace': 'Not A Namespace!',
  }),
];

function setup(defaultNamespace = 'default') {
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
    catalog: catalogServiceMock({ entities: entities as any }),
    appBaseUrl: 'http://backstage/',
    defaultNamespace,
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

describe('temporal:workflow:wait polling interval', () => {
  const running = { status: 'Running', runId: 'r', searchAttributes: {} };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Runs the wait against a workflow that never closes, or that closes at
   * the given call, and returns the seconds at which describe was called.
   */
  async function run(
    input: Record<string, unknown>,
    { closeAtCall, extra }: { closeAtCall?: number; extra?: object } = {},
  ) {
    const { client, options } = setup();
    const times: number[] = [];
    client.describe.mockImplementation(async () => {
      times.push(Date.now() / 1000);
      return closeAtCall !== undefined && times.length >= closeAtCall
        ? { ...running, status: 'Completed' }
        : running;
    });
    const ctx = context({ workflowId: 'w', ...input }, extra);
    const warn = jest.spyOn(ctx.logger, 'warn');
    const result = createTemporalWorkflowWaitAction(options).handler(ctx);
    const settled = result.then(
      () => 'done',
      e => e as Error,
    );
    await jest.advanceTimersByTimeAsync(4000 * 1000);
    return { times, outcome: await settled, client, warn };
  }

  const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

  it('doubles the pause up to 30 seconds by default', async () => {
    const { times, outcome } = await run({ timeoutSeconds: 600 });
    expect(times.slice(0, 8)).toEqual([0, 5, 15, 35, 65, 95, 125, 155]);
    expect(gaps(times).slice(0, 7)).toEqual([5, 10, 20, 30, 30, 30, 30]);
    // Looks at 0, 5, 15, 35, then every 30 seconds to 575, and at 600.
    expect(times).toHaveLength(23);
    expect(times[times.length - 1]).toBe(600);
    expect((outcome as Error).message).toBe(
      'Workflow w is still running after 600 seconds',
    );
  });

  it('looks 123 times in an hour by default', async () => {
    const { times } = await run({ timeoutSeconds: 3600 });
    expect(times).toHaveLength(123);
  });

  it('keeps a fixed interval when maxIntervalSeconds equals intervalSeconds', async () => {
    const { times } = await run({
      timeoutSeconds: 60,
      intervalSeconds: 5,
      maxIntervalSeconds: 5,
    });
    expect(gaps(times)).toEqual(Array(12).fill(5));
  });

  it('keeps an intervalSeconds above the default cap fixed', async () => {
    const { times } = await run({ timeoutSeconds: 300, intervalSeconds: 60 });
    expect(times).toEqual([0, 60, 120, 180, 240, 300]);
  });

  it('does not go below intervalSeconds when maxIntervalSeconds is smaller', async () => {
    const { times } = await run({
      timeoutSeconds: 100,
      intervalSeconds: 20,
      maxIntervalSeconds: 10,
    });
    expect(times).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('uses the given first pause and cap', async () => {
    const { times } = await run({
      timeoutSeconds: 200,
      intervalSeconds: 2,
      maxIntervalSeconds: 10,
    });
    expect(gaps(times).slice(0, 6)).toEqual([2, 4, 8, 10, 10, 10]);
  });

  it('returns at once when the workflow closes, without another pause', async () => {
    const { times, outcome } = await run({}, { closeAtCall: 4 });
    expect(outcome).toBe('done');
    expect(times).toEqual([0, 5, 15, 35]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('looks at once when it starts', async () => {
    const { client, options } = setup();
    client.describe.mockResolvedValue({ ...running, status: 'Completed' });
    await createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'w' }),
    );
    expect(client.describe).toHaveBeenCalledTimes(1);
  });

  it('backs off the same way when waiting for a search attribute', async () => {
    const { client, options } = setup();
    const times: number[] = [];
    client.describe.mockImplementation(async () => {
      times.push(Date.now() / 1000);
      return {
        ...running,
        searchAttributes: { ApprovalPending: times.length >= 5 },
      };
    });
    const ctx = context({
      workflowId: 'w',
      untilSearchAttribute: 'ApprovalPending',
    });
    const done = createTemporalWorkflowWaitAction(options).handler(ctx);
    await jest.advanceTimersByTimeAsync(1000 * 1000);
    await done;
    expect(times).toEqual([0, 5, 15, 35, 65]);
    expect(ctx.output).toHaveBeenCalledWith('status', 'Running');
  });

  it('cuts the last pause at the deadline', async () => {
    const { times } = await run({ timeoutSeconds: 50 });
    expect(times).toEqual([0, 5, 15, 35, 50]);
  });

  it('fails at once when a look throws, without a retry', async () => {
    const { client, options } = setup();
    client.describe.mockRejectedValueOnce(new Error('500'));
    const ctx = context({ workflowId: 'w' });
    const timersBefore = jest.getTimerCount();
    await expect(
      createTemporalWorkflowWaitAction(options).handler(ctx),
    ).rejects.toThrow('500');
    expect(client.describe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(timersBefore);
  });

  it('fails at once when a later look throws, without a retry', async () => {
    const { client, options } = setup();
    client.describe
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error('500'));
    const result = createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'w' }),
    );
    const settled = result.then(
      () => 'done',
      e => e as Error,
    );
    await jest.advanceTimersByTimeAsync(1000 * 1000);
    expect(((await settled) as Error).message).toBe('500');
    expect(client.describe).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('warns once when maxIntervalSeconds is smaller than intervalSeconds', async () => {
    const { warn } = (await run({
      timeoutSeconds: 100,
      intervalSeconds: 20,
      maxIntervalSeconds: 10,
    })) as any;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('maxIntervalSeconds (10)'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('intervalSeconds (20)'),
    );
  });

  it('does not warn without a maxIntervalSeconds or when it is not smaller', async () => {
    const a = (await run({ timeoutSeconds: 100, intervalSeconds: 60 })) as any;
    const b = (await run({
      timeoutSeconds: 100,
      intervalSeconds: 5,
      maxIntervalSeconds: 5,
    })) as any;
    expect(a.warn).not.toHaveBeenCalled();
    expect(b.warn).not.toHaveBeenCalled();
  });

  it('stops at once when the task is cancelled', async () => {
    const { client, options } = setup();
    client.describe.mockResolvedValue(running);
    const controller = new AbortController();
    const result = createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'w' }, { signal: controller.signal }),
    );
    const settled = result.then(
      () => 'done',
      e => e as Error,
    );
    await jest.advanceTimersByTimeAsync(7 * 1000);
    expect(client.describe).toHaveBeenCalledTimes(2);
    controller.abort();
    const outcome = await settled;
    expect((outcome as Error).message).toBe('The task was cancelled');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(100 * 1000);
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

describe('the namespace of wait and signal', () => {
  // The backend plugin's default namespace when none is given, as for
  // start: a workflow started there is found without a namespace.
  it('is the default namespace of the backend plugin', async () => {
    const { client, options } = setup('team-a');
    client.describe.mockResolvedValue({ status: 'Completed', runId: 'run-1' });
    await createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'release-1' }),
    );
    expect(client.describe).toHaveBeenCalledWith(
      { namespace: 'team-a', workflowId: 'release-1' },
      undefined,
      user,
    );
    await createTemporalWorkflowSignalAction(options).handler(
      context({ workflowId: 'release-1', name: 'approve' }),
    );
    expect(client.send).toHaveBeenCalledWith(
      'signal',
      { namespace: 'team-a', workflowId: 'release-1' },
      { name: 'approve', args: [] },
      undefined,
      user,
    );
  });

  it('is the given one', async () => {
    const { client, options } = setup('team-a');
    client.describe.mockResolvedValue({ status: 'Completed', runId: 'run-1' });
    await createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'release-1', namespace: 'billing' }),
    );
    expect(client.describe).toHaveBeenCalledWith(
      { namespace: 'billing', workflowId: 'release-1' },
      undefined,
      user,
    );
  });
});

describe('the namespace of wait and signal for an entity', () => {
  const waitNamespace = async (
    input: Record<string, unknown>,
    d = 'team-a',
  ) => {
    const { client, options } = setup(d);
    client.describe.mockResolvedValue({ status: 'Completed', runId: 'run-1' });
    await createTemporalWorkflowWaitAction(options).handler(
      context({ workflowId: 'release-1', ...input }),
    );
    return client.describe.mock.calls[0][0].namespace;
  };
  const signalNamespace = async (
    input: Record<string, unknown>,
    d = 'team-a',
  ) => {
    const { client, options } = setup(d);
    await createTemporalWorkflowSignalAction(options).handler(
      context({ workflowId: 'release-1', name: 'approve', ...input }),
    );
    return client.send.mock.calls[0][1].namespace;
  };

  it.each([
    [
      'an entity with a namespace',
      'component:default/billing',
      undefined,
      'billing',
    ],
    [
      'a TemporalWorkflow entity with a namespace',
      'temporalworkflow:default/audit',
      undefined,
      'audit',
    ],
    ['an entity without one', 'component:default/plain', undefined, 'team-a'],
    [
      'an explicit namespace over the entity',
      'component:default/billing',
      'other',
      'other',
    ],
  ])('follows %s', async (_name, entityRef, namespace, expected) => {
    const input = { entityRef, namespace };
    expect(await waitNamespace(input)).toBe(expected);
    expect(await signalNamespace(input)).toBe(expected);
  });

  it('is the namespace the backend takes for start of the same entity', async () => {
    // Start sends the entity and lets the backend read its namespace with
    // getTemporalWorkflowSource, which is what wait and signal use.
    for (const e of entities.slice(0, 3)) {
      const ref = `${e.kind.toLowerCase()}:default/${e.metadata.name}`;
      expect(await waitNamespace({ entityRef: ref })).toBe(
        getTemporalWorkflowSource(e as any).namespace ?? 'team-a',
      );
    }
  });

  it('does not fall back to the default when the entity cannot be read', async () => {
    const { client, options } = setup();
    await expect(
      createTemporalWorkflowSignalAction(options).handler(
        context({
          workflowId: 'release-1',
          name: 'approve',
          entityRef: 'component:default/missing',
        }),
      ),
    ).rejects.toThrow(/Cannot read the entity component:default\/missing/);
    expect(client.send).not.toHaveBeenCalled();
    await expect(
      createTemporalWorkflowWaitAction(options).handler(
        context({
          workflowId: 'release-1',
          entityRef: 'component:default/broken',
        }),
      ),
    ).rejects.toThrow();
    expect(client.describe).not.toHaveBeenCalled();
  });

  it('does not read the entity when a namespace is given', async () => {
    const { options } = setup();
    const getEntityByRef = jest.spyOn(options.catalog, 'getEntityByRef');
    await signalNamespace({
      entityRef: 'component:default/missing',
      namespace: 'x',
    });
    expect(getEntityByRef).not.toHaveBeenCalled();
  });
});
