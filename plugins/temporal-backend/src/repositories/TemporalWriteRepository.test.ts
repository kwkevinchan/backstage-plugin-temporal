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

import { recordingLogger } from '../__testUtils__/recordingLogger';
import { grpcError } from '../__testUtils__/schedules';
import { decodeJsonPayloads } from '../lib/payloads';
import {
  TemporalWriteRepository,
  WorkflowChainRef,
} from './TemporalWriteRepository';

const GRPC_NOT_FOUND = 5;
const GRPC_ALREADY_EXISTS = 6;

/** A repository over a fake workflow service, and the deadlines it asked for. */
function setup(workflowService: Record<string, jest.Mock>) {
  const deadlines: number[] = [];
  const connection = {
    workflowService,
    withDeadline: async (at: number, fn: () => Promise<unknown>) => {
      deadlines.push(at - Date.now());
      return fn();
    },
  };
  const temporal = { getConnection: async () => connection } as any;
  return {
    writes: new TemporalWriteRepository(temporal, recordingLogger()),
    deadlines,
  };
}

const chain: WorkflowChainRef = {
  namespace: 'default',
  workflowId: 'wf-1',
  firstExecutionRunId: 'first-run',
};
const oneRun: WorkflowChainRef = {
  namespace: 'default',
  workflowId: 'wf-1',
  runId: 'run-1',
};

describe('TemporalWriteRepository', () => {
  it('addresses a chain by its first run, never by the workflow ID alone', async () => {
    const terminateWorkflowExecution = jest.fn(async (_request: any) => ({}));
    const { writes } = setup({ terminateWorkflowExecution });
    await writes.terminate(chain, 'stop', 'backstage:user:default/me');
    await writes.terminate(oneRun, 'stop', 'backstage:user:default/me');
    expect(terminateWorkflowExecution.mock.calls.map(c => c[0])).toEqual([
      {
        namespace: 'default',
        workflowExecution: { workflowId: 'wf-1' },
        firstExecutionRunId: 'first-run',
        reason: 'stop',
        identity: 'backstage:user:default/me',
      },
      {
        namespace: 'default',
        workflowExecution: { workflowId: 'wf-1', runId: 'run-1' },
        reason: 'stop',
        identity: 'backstage:user:default/me',
      },
    ]);
  });

  it('refuses a target without a chain ID and without a run ID', async () => {
    const requestCancelWorkflowExecution = jest.fn();
    const { writes } = setup({ requestCancelWorkflowExecution });
    await expect(
      writes.cancel(
        { namespace: 'default', workflowId: 'wf-1' } as WorkflowChainRef,
        'backstage',
      ),
    ).rejects.toMatchObject({
      name: 'InputError',
      message: 'firstExecutionRunId or runId is required',
    });
    expect(requestCancelWorkflowExecution).not.toHaveBeenCalled();
  });

  it('answers a conflict when the chain ended or the workflow ID belongs to another chain, and not found for one run', async () => {
    const { writes } = setup({
      requestCancelWorkflowExecution: jest.fn(async () => {
        throw grpcError(GRPC_NOT_FOUND, 'workflow execution already completed');
      }),
      terminateWorkflowExecution: jest.fn(async () => {
        throw grpcError(GRPC_NOT_FOUND, 'workflow not found');
      }),
    });
    await expect(writes.cancel(chain, 'backstage')).rejects.toMatchObject({
      name: 'ConflictError',
      message: 'Workflow wf-1 has already ended',
    });
    await expect(
      writes.terminate(chain, 'stop', 'backstage'),
    ).rejects.toMatchObject({
      name: 'ConflictError',
      message: 'Workflow wf-1 now belongs to a different execution chain',
    });
    await expect(
      writes.terminate(oneRun, 'stop', 'backstage'),
    ).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'Not found in Temporal',
    });
  });

  it('sends an update that waits for its completion, and tells the run to poll', async () => {
    const updateWorkflowExecution = jest
      .fn()
      .mockResolvedValueOnce({
        updateRef: {
          workflowExecution: { workflowId: 'wf-1', runId: 'accepted-run' },
        },
      })
      .mockResolvedValueOnce({ outcome: { success: { payloads: [] } } });
    const pollWorkflowExecutionUpdate = jest.fn(async (_request: any) => ({
      outcome: { failure: { message: 'no' } },
    }));
    const { writes, deadlines } = setup({
      updateWorkflowExecution,
      pollWorkflowExecutionUpdate,
    });
    const update = {
      updateId: 'u-1',
      name: 'setLimit',
      args: [5],
      identity: 'backstage',
    };

    const sent = await writes.sendUpdate(chain, update);
    expect(sent).toEqual({
      outcome: undefined,
      execution: { workflowId: 'wf-1', runId: 'accepted-run' },
    });
    const request = updateWorkflowExecution.mock.calls[0][0];
    expect(request).toMatchObject({
      namespace: 'default',
      workflowExecution: { workflowId: 'wf-1' },
      firstExecutionRunId: 'first-run',
      waitPolicy: { lifecycleStage: 3 },
      request: {
        meta: { updateId: 'u-1', identity: 'backstage' },
        input: { name: 'setLimit' },
      },
    });
    expect(decodeJsonPayloads(request.request.input.args)).toEqual(5);

    // Without the run that accepted it, the target of the update is polled.
    await expect(writes.sendUpdate(chain, update)).resolves.toEqual({
      outcome: { success: { payloads: [] } },
      execution: { workflowId: 'wf-1' },
    });

    await expect(
      writes.pollUpdate(chain, sent.execution, 'u-1', 'backstage'),
    ).resolves.toEqual({ outcome: { failure: { message: 'no' } } });
    expect(pollWorkflowExecutionUpdate.mock.calls[0][0]).toEqual({
      namespace: 'default',
      updateRef: {
        workflowExecution: { workflowId: 'wf-1', runId: 'accepted-run' },
        updateId: 'u-1',
      },
      identity: 'backstage',
      waitPolicy: { lifecycleStage: 3 },
    });
    // The deadline of an update, for the send and for each poll.
    expect(deadlines.map(ms => Math.round(ms / 1000))).toEqual([30, 30, 30]);
  });

  it('starts a workflow with the protobuf value of its reuse policy and Keyword search attributes', async () => {
    const startWorkflowExecution = jest.fn(async (_request: any) => ({
      runId: 'new-run',
    }));
    const { writes } = setup({ startWorkflowExecution });
    await expect(
      writes.start({
        namespace: 'default',
        workflowId: 'order-1',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        args: [{ order: 1 }],
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        searchAttributes: { BackstageEntityRef: 'component:default/orders' },
        identity: 'backstage',
      }),
    ).resolves.toBe('new-run');
    const request = startWorkflowExecution.mock.calls[0][0];
    expect(request).toMatchObject({
      namespace: 'default',
      workflowId: 'order-1',
      workflowType: { name: 'orderWorkflow' },
      taskQueue: { name: 'orders' },
      identity: 'backstage',
      workflowIdReusePolicy: 3,
    });
    expect(request.requestId).toEqual(expect.any(String));
    expect(decodeJsonPayloads(request.input)).toEqual({ order: 1 });
    const attribute = request.searchAttributes.indexedFields.BackstageEntityRef;
    expect(Buffer.from(attribute.metadata.type).toString()).toBe('Keyword');
    expect(decodeJsonPayloads({ payloads: [attribute] })).toEqual(
      'component:default/orders',
    );
  });

  it('answers a conflict for a workflow ID that is taken', async () => {
    const { writes } = setup({
      startWorkflowExecution: jest.fn(async () => {
        throw grpcError(GRPC_ALREADY_EXISTS);
      }),
    });
    await expect(
      writes.start({
        namespace: 'default',
        workflowId: 'order-1',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        searchAttributes: {},
        identity: 'backstage',
      }),
    ).rejects.toMatchObject({
      name: 'ConflictError',
      message: 'The resource already exists in Temporal',
    });
  });

  it('starts a workflow like another run: its start event as it is, without the search attributes of Temporal', async () => {
    const encrypted = {
      payloads: [
        {
          metadata: { encoding: Buffer.from('binary/encrypted') },
          data: Buffer.from([1, 2, 3]),
        },
      ],
    };
    const started = {
      workflowType: { name: 'orderWorkflow' },
      taskQueue: { name: 'orders' },
      input: encrypted,
      header: { fields: {} },
      memo: { fields: {} },
      workflowRunTimeout: { seconds: 60 },
      retryPolicy: { maximumAttempts: 2 },
      searchAttributes: {
        indexedFields: {
          TemporalScheduledById: { data: Buffer.from('"s"') },
          CustomerId: { data: Buffer.from('"c-1"') },
        },
      },
    };
    const getWorkflowExecutionHistory = jest.fn(async (_request: any) => ({
      history: {
        events: [{ workflowExecutionStartedEventAttributes: started }],
      },
    }));
    const startWorkflowExecution = jest.fn(async (_request: any) => ({
      runId: 'new-run',
    }));
    const { writes } = setup({
      getWorkflowExecutionHistory,
      startWorkflowExecution,
    });

    const read = await writes.startEvent({
      namespace: 'default',
      workflowId: 'wf-1',
      runId: 'run-1',
    });
    expect(read).toBe(started);
    expect(getWorkflowExecutionHistory).toHaveBeenCalledWith({
      namespace: 'default',
      execution: { workflowId: 'wf-1', runId: 'run-1' },
      maximumPageSize: 1,
    });

    await expect(
      writes.startLike(read!, {
        namespace: 'default',
        workflowId: 'wf-1-rerun-x',
        workflowType: 'fallbackType',
        taskQueue: 'fallbackQueue',
        searchAttributes: { Initiator: 'user:default/me' },
        identity: 'backstage',
      }),
    ).resolves.toBe('new-run');
    const request = startWorkflowExecution.mock.calls[0][0];
    expect(request).toMatchObject({
      namespace: 'default',
      workflowId: 'wf-1-rerun-x',
      workflowType: { name: 'orderWorkflow' },
      taskQueue: { name: 'orders' },
      identity: 'backstage',
    });
    expect(request.input).toBe(encrypted);
    expect(request.header).toBe(started.header);
    expect(request.memo).toBe(started.memo);
    expect(request.workflowRunTimeout).toBe(started.workflowRunTimeout);
    expect(request.retryPolicy).toBe(started.retryPolicy);
    expect(Object.keys(request.searchAttributes.indexedFields)).toEqual([
      'CustomerId',
      'Initiator',
    ]);
  });

  it('gives no start event for a history without one', async () => {
    const { writes } = setup({
      getWorkflowExecutionHistory: jest.fn(async () => ({ history: {} })),
    });
    await expect(
      writes.startEvent({
        namespace: 'default',
        workflowId: 'wf-1',
        runId: 'run-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('runs a custom action with the client of the namespace, under the deadline of an action', async () => {
    const client = { workflow: {} };
    const deadlines: number[] = [];
    const getClient = jest.fn(async () => client);
    const writes = new TemporalWriteRepository(
      {
        getClient,
        getConnection: async () => ({
          withDeadline: async (at: number, fn: () => Promise<unknown>) => {
            deadlines.push(at - Date.now());
            return fn();
          },
        }),
      } as any,
      recordingLogger(),
    );
    await expect(
      writes.withClient('default', async c =>
        c === (client as any) ? 'ok' : 'no',
      ),
    ).resolves.toBe('ok');
    expect(getClient).toHaveBeenCalledWith({ namespace: 'default' });
    expect(deadlines.map(ms => Math.round(ms / 1000))).toEqual([60]);

    getClient.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(
      writes.withClient('default', async () => 'ok'),
    ).rejects.toMatchObject({
      name: 'ServiceUnavailableError',
      message: 'Temporal is not reachable',
    });
  });
});
