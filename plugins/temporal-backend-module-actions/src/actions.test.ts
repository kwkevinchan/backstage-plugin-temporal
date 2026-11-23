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
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { ResponseError } from '@backstage/errors';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import {
  CONTROL_DISABLED_MESSAGE,
  type TemporalPluginClient,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { registerTemporalActions } from './actions';

const user = mockCredentials.user('user:default/alice');

const summary = (over: object = {}) => ({
  namespace: 'default',
  workflowId: 'order-1',
  runId: 'run-1',
  workflowType: 'orderWorkflow',
  status: 'Running',
  startTime: '2026-01-01T00:00:00Z',
  initiator: 'user:default/alice',
  ...over,
});

function setup(
  entities: any[] = [],
  clientOverrides: Record<string, jest.Mock> = {},
) {
  const client = {
    listEntityWorkflows: jest.fn(),
    latestRunId: jest.fn().mockResolvedValue('run-1'),
    describe: jest.fn(),
    graph: jest.fn(),
    start: jest.fn(),
    send: jest.fn(),
    ...clientOverrides,
  };
  const registry = actionsRegistryServiceMock();
  registerTemporalActions(registry, {
    client: client as unknown as TemporalPluginClient,
    catalog: catalogServiceMock({ entities }),
    appBaseUrl: 'http://backstage/',
    defaultNamespace: 'default',
  });
  const invoke = (name: string, input: object) =>
    registry.invoke({ id: `test:${name}`, input, credentials: user });
  return { client, registry, invoke };
}

function responseError(status: number, message: string) {
  return ResponseError.fromResponse(
    new Response(
      JSON.stringify({
        error: { name: 'Error', message },
        response: { statusCode: status },
      }),
      { status, headers: { 'content-type': 'application/json' } },
    ),
  );
}

describe('attributes of the actions', () => {
  // A chat decides from these whether to ask the user first.
  it.each([
    [
      'list-workflows',
      { readOnly: true, destructive: false, idempotent: true },
    ],
    ['get-workflow', { readOnly: true, destructive: false, idempotent: true }],
    [
      'start-workflow',
      { readOnly: false, destructive: false, idempotent: false },
    ],
    [
      'signal-workflow',
      { readOnly: false, destructive: false, idempotent: false },
    ],
    [
      'update-workflow',
      { readOnly: false, destructive: false, idempotent: false },
    ],
  ])('%s', async (name, attributes) => {
    const { registry } = setup();
    const { actions } = await registry.list();
    expect(actions.find(a => a.id === `test:${name}`)?.attributes).toEqual(
      attributes,
    );
  });

  it('registers exactly the five actions, with a description and an input schema', async () => {
    const { registry } = setup();
    const { actions } = await registry.list();
    expect(actions.map(a => a.name)).toEqual([
      'list-workflows',
      'get-workflow',
      'start-workflow',
      'signal-workflow',
      'update-workflow',
    ]);
    for (const action of actions) {
      expect(action.description.length).toBeGreaterThan(80);
      const properties = (action.schema.input as any).properties;
      for (const [key, value] of Object.entries<any>(properties)) {
        expect([key, typeof value.description]).toEqual([key, 'string']);
      }
    }
  });
});

describe('list-workflows', () => {
  it('lists the runs of the entity as the user', async () => {
    const { client, invoke } = setup();
    client.listEntityWorkflows.mockResolvedValue({
      namespace: 'default',
      items: [summary(), summary({ workflowId: 'order-2', runId: 'run-2' })],
      nextPageToken: 'next',
    });
    const { output } = await invoke('list-workflows', {
      entityRef: 'component:default/orders',
      status: 'Running',
      limit: 2,
    });
    expect(client.listEntityWorkflows).toHaveBeenCalledWith(
      'component:default/orders',
      { status: 'Running', pageSize: 2 },
      user,
    );
    expect(output).toEqual({
      items: [
        expect.objectContaining({
          workflowId: 'order-1',
          runId: 'run-1',
          namespace: 'default',
          status: 'Running',
          workflowUrl:
            'http://backstage/temporal/namespaces/default/workflows/order-1/runs/run-1',
        }),
        expect.objectContaining({ workflowId: 'order-2' }),
      ],
      hasMore: true,
    });
  });

  it('asks for 10 runs by default and says there are no more', async () => {
    const { client, invoke } = setup();
    client.listEntityWorkflows.mockResolvedValue({
      namespace: 'default',
      items: [summary()],
    });
    const { output } = await invoke('list-workflows', {
      entityRef: 'component:default/orders',
    });
    expect(client.listEntityWorkflows).toHaveBeenCalledWith(
      'component:default/orders',
      { status: undefined, pageSize: 10 },
      user,
    );
    expect((output as any).hasMore).toBe(false);
  });

  it('refuses a missing entityRef, an unknown status and a limit that is too high', async () => {
    const { client, invoke } = setup();
    await expect(invoke('list-workflows', {})).rejects.toThrow(/Invalid input/);
    await expect(
      invoke('list-workflows', { entityRef: 'a:b/c', status: 'Sleeping' }),
    ).rejects.toThrow(/Invalid input/);
    await expect(
      invoke('list-workflows', { entityRef: 'a:b/c', limit: 500 }),
    ).rejects.toThrow(/Invalid input/);
    expect(client.listEntityWorkflows).not.toHaveBeenCalled();
  });

  it('says clearly when the backend refuses the user', async () => {
    const { client, invoke } = setup();
    client.listEntityWorkflows.mockRejectedValue(
      await responseError(403, 'Access denied for temporal.workflow.read'),
    );
    await expect(
      invoke('list-workflows', { entityRef: 'component:default/orders' }),
    ).rejects.toThrow(
      /refused this for the signed-in user: Access denied for temporal\.workflow\.read.*lack the permission/,
    );
  });
});

describe('get-workflow', () => {
  const graph = (over: object = {}) => ({
    status: 'Running',
    nodes: [
      { id: 'a', kind: 'workflowStarted', name: 'start', status: 'Completed' },
      { id: 'b', kind: 'activity', name: 'charge', status: 'Completed' },
      { id: 'c', kind: 'activity', name: 'ship', status: 'Running' },
      { id: 'd', kind: 'timer', name: 'wait-1', status: 'Waiting' },
      { id: 'e', kind: 'activity', name: 'notify', status: 'Failed' },
      { id: 'f', kind: 'workflowTask', name: 'task', status: 'Running' },
    ],
    edges: [],
    completedSteps: 1,
    totalSteps: 4,
    truncated: false,
    payloadsHidden: false,
    current: 'Waiting for ship',
    ...over,
  });

  it('summarizes the run and its steps', async () => {
    const { client, invoke } = setup();
    client.describe.mockResolvedValue({
      ...summary(),
      taskQueue: 'orders',
      pendingActivities: [],
    });
    client.graph.mockResolvedValue(graph());
    const { output } = await invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
    });
    expect(client.describe).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'order-1', runId: 'run-1' },
      undefined,
      user,
    );
    expect(output).toEqual({
      namespace: 'default',
      workflowId: 'order-1',
      runId: 'run-1',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
      status: 'Running',
      startTime: '2026-01-01T00:00:00Z',
      initiator: 'user:default/alice',
      workflowUrl:
        'http://backstage/temporal/namespaces/default/workflows/order-1/runs/run-1',
      steps: {
        completed: 1,
        running: 2,
        failed: 1,
        seen: 4,
        truncated: false,
        currentSteps: ['ship', 'wait-1'],
        current: 'Waiting for ship',
      },
    });
  });

  it('finds the latest run and the namespace of the entity when they are left out', async () => {
    const { client, invoke } = setup([
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: 'orders',
          annotations: {
            'temporal.io/workflow-type': 'orderWorkflow',
            'temporal.io/task-queue': 'orders',
            'temporal.io/namespace': 'team-a',
          },
        },
        spec: {},
      },
    ]);
    client.describe.mockResolvedValue({ ...summary(), pendingActivities: [] });
    client.graph.mockResolvedValue(graph({ nodes: [] }));
    await invoke('get-workflow', {
      workflowId: 'order-1',
      entityRef: 'component:default/orders',
    });
    const base = { namespace: 'team-a', workflowId: 'order-1' };
    expect(client.latestRunId).toHaveBeenCalledWith(
      base,
      'component:default/orders',
      user,
    );
    expect(client.describe).toHaveBeenCalledWith(
      { ...base, runId: 'run-1' },
      'component:default/orders',
      user,
    );
  });

  it('reports the failure with its causes, as the backend gives them', async () => {
    const { client, invoke } = setup();
    client.describe.mockResolvedValue({
      ...summary({ status: 'Failed', closeTime: '2026-01-01T00:01:00Z' }),
      pendingActivities: [],
      failure: {
        message: 'Workflow failed',
        kind: 'ActivityFailure',
        stackTrace: 'at secret.ts:1',
        cause: { message: 'card declined', type: 'PaymentError' },
      },
    });
    client.graph.mockResolvedValue(graph({ nodes: [], status: 'Failed' }));
    const { output } = await invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
    });
    expect((output as any).failure).toEqual({
      message: 'Workflow failed',
      kind: 'ActivityFailure',
      causes: ['card declined'],
    });
  });

  it('has no causes when the backend hides the failure details', async () => {
    const { client, invoke } = setup();
    client.describe.mockResolvedValue({
      ...summary({ status: 'Failed' }),
      pendingActivities: [],
      failureDetailsHidden: true,
      failure: { message: 'Workflow failed', kind: 'ActivityFailure' },
    });
    client.graph.mockResolvedValue(graph({ nodes: [] }));
    const { output } = await invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
    });
    expect((output as any).failure).toEqual({
      message: 'Workflow failed',
      kind: 'ActivityFailure',
    });
  });

  it('says so when no run is found', async () => {
    const { client, invoke } = setup();
    client.latestRunId.mockResolvedValue(undefined);
    await expect(
      invoke('get-workflow', { workflowId: 'missing' }),
    ).rejects.toThrow(
      /No run of workflow missing was found in namespace default/,
    );
  });

  it('refuses an input without workflowId', async () => {
    const { invoke } = setup();
    await expect(invoke('get-workflow', {})).rejects.toThrow(/Invalid input/);
  });

  it('says clearly when the backend refuses the user', async () => {
    const { client, invoke } = setup();
    client.describe.mockRejectedValue(await responseError(403, 'Denied'));
    client.graph.mockResolvedValue(graph());
    await expect(
      invoke('get-workflow', { workflowId: 'order-1', runId: 'run-1' }),
    ).rejects.toThrow(/refused this for the signed-in user: Denied/);
  });
});

describe('start-workflow', () => {
  it('starts the workflow of an entity as the user', async () => {
    const { client, invoke } = setup();
    client.start.mockResolvedValue({
      namespace: 'default',
      workflowId: 'release-1',
      runId: 'run-9',
    });
    const { output } = await invoke('start-workflow', {
      entityRef: 'temporalworkflow:default/release',
      workflowId: 'release-1',
      args: { service: 'orders' },
    });
    expect(client.start).toHaveBeenCalledWith(
      {
        entityRef: 'temporalworkflow:default/release',
        workflowType: undefined,
        taskQueue: undefined,
        namespace: undefined,
        workflowId: 'release-1',
        args: [{ service: 'orders' }],
      },
      user,
    );
    expect(output).toEqual({
      namespace: 'default',
      workflowId: 'release-1',
      runId: 'run-9',
      workflowUrl:
        'http://backstage/temporal/namespaces/default/workflows/release-1/runs/run-9',
    });
  });

  it('starts a workflow type with its task queue and namespace', async () => {
    const { client, invoke } = setup();
    client.start.mockResolvedValue({
      namespace: 'team-a',
      workflowId: 'orderWorkflow-1',
      runId: 'r',
    });
    await invoke('start-workflow', {
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
      namespace: 'team-a',
      args: [1, 2],
    });
    expect(client.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        namespace: 'team-a',
        args: [1, 2],
      }),
      user,
    );
  });

  it('needs an entity, or a workflow type and a task queue', async () => {
    const { client, invoke } = setup();
    await expect(
      invoke('start-workflow', { workflowType: 'orderWorkflow' }),
    ).rejects.toThrow(/Give entityRef, or workflowType and taskQueue/);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('says when the Temporal backend does not serve the operations', async () => {
    const { client, invoke } = setup();
    client.start.mockRejectedValue(new Error(CONTROL_DISABLED_MESSAGE));
    await expect(
      invoke('start-workflow', { entityRef: 'temporalworkflow:default/r' }),
    ).rejects.toThrow(/temporal\.control\.enabled is false/);
  });

  it('says clearly when the backend refuses the user', async () => {
    const { client, invoke } = setup();
    client.start.mockRejectedValue(
      await responseError(403, 'Missing temporal.workflow.start'),
    );
    await expect(
      invoke('start-workflow', { entityRef: 'temporalworkflow:default/r' }),
    ).rejects.toThrow(/refused this.*Missing temporal\.workflow\.start/);
  });
});

describe('signal-workflow', () => {
  const input = { workflowId: 'order-1', runId: 'run-1', name: 'approve' };

  it('sends the signal to the run as the user', async () => {
    const { client, invoke } = setup();
    client.send.mockResolvedValue({});
    const { output } = await invoke('signal-workflow', {
      ...input,
      args: { by: 'alice' },
    });
    expect(client.send).toHaveBeenCalledWith(
      'signal',
      { namespace: 'default', workflowId: 'order-1', runId: 'run-1' },
      { name: 'approve', args: [{ by: 'alice' }] },
      undefined,
      user,
    );
    expect(output).toEqual({ runId: 'run-1' });
  });

  it('looks up the latest run when none is given', async () => {
    const { client, invoke } = setup();
    client.send.mockResolvedValue({});
    const { output } = await invoke('signal-workflow', {
      workflowId: 'order-1',
      name: 'approve',
    });
    expect(output).toEqual({ runId: 'run-1' });
    expect(client.send.mock.calls[0][1].runId).toBe('run-1');
  });

  it('follows a run that continued as new when it chose the run itself', async () => {
    const { client, invoke } = setup();
    client.send
      .mockRejectedValueOnce(
        await ResponseError.fromResponse(
          new Response(
            JSON.stringify({
              error: {
                name: 'ConflictError',
                message: 'continued as new',
                continuedAsNewRunId: 'run-2',
              },
              response: { statusCode: 409 },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
      )
      .mockResolvedValueOnce({});
    const { output } = await invoke('signal-workflow', {
      workflowId: 'order-1',
      name: 'approve',
    });
    expect(output).toEqual({ runId: 'run-2' });
  });

  it('returns the reason when the backend does not allow the signal', async () => {
    const { client, invoke } = setup();
    client.send.mockRejectedValue(
      await responseError(400, 'The signal "shutdown" is not allowed'),
    );
    await expect(
      invoke('signal-workflow', { ...input, name: 'shutdown' }),
    ).rejects.toThrow(/not allowed/);
  });

  it('says when the Temporal backend does not serve the operations', async () => {
    const { client, invoke } = setup();
    client.send.mockRejectedValue(new Error(CONTROL_DISABLED_MESSAGE));
    await expect(invoke('signal-workflow', input)).rejects.toThrow(
      /temporal\.control\.enabled is false/,
    );
  });

  it('says clearly when the backend refuses the user', async () => {
    const { client, invoke } = setup();
    client.send.mockRejectedValue(
      await responseError(403, 'Missing temporal.workflow.signal'),
    );
    await expect(invoke('signal-workflow', input)).rejects.toThrow(
      /refused this.*Missing temporal\.workflow\.signal/,
    );
  });

  it('needs a name', async () => {
    const { invoke } = setup();
    await expect(
      invoke('signal-workflow', { workflowId: 'order-1' }),
    ).rejects.toThrow(/Invalid input/);
  });
});

describe('update-workflow', () => {
  const input = { workflowId: 'order-1', runId: 'run-1', name: 'setPriority' };

  it('sends the update and returns its result', async () => {
    const { client, invoke } = setup();
    client.send.mockResolvedValue({ result: { priority: 'high' } });
    const { output } = await invoke('update-workflow', {
      ...input,
      args: ['high'],
    });
    expect(client.send).toHaveBeenCalledWith(
      'update',
      { namespace: 'default', workflowId: 'order-1', runId: 'run-1' },
      { name: 'setPriority', args: ['high'] },
      undefined,
      user,
    );
    expect(output).toEqual({ runId: 'run-1', result: { priority: 'high' } });
  });

  it('says when the Temporal backend does not serve the operations', async () => {
    const { client, invoke } = setup();
    client.send.mockRejectedValue(new Error(CONTROL_DISABLED_MESSAGE));
    await expect(invoke('update-workflow', input)).rejects.toThrow(
      /temporal\.control\.enabled is false/,
    );
  });

  it('says clearly when the backend refuses the user', async () => {
    const { client, invoke } = setup();
    client.send.mockRejectedValue(
      await responseError(403, 'Missing temporal.workflow.update'),
    );
    await expect(invoke('update-workflow', input)).rejects.toThrow(
      /refused this.*Missing temporal\.workflow\.update/,
    );
  });
});
