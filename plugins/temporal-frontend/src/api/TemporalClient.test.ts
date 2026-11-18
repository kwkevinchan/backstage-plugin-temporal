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

import { mockApis } from '@backstage/test-utils';
import {
  BACKEND_MISSING_MESSAGE,
  OPERATION_NOT_SERVED_MESSAGE,
  TemporalClient,
} from './TemporalClient';

const ref = { namespace: 'default', workflowId: 'wf-1', runId: 'run-1' };

function clientAnswering(response: () => Response) {
  return new TemporalClient({
    discoveryApi: mockApis.discovery(),
    fetchApi: { fetch: async () => response() },
  });
}

const noBody = () => new Response('Not Found', { status: 404 });
const withBody = () =>
  new Response(
    JSON.stringify({
      error: { name: 'NotFoundError', message: 'No such workflow' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );

describe('TemporalClient errors', () => {
  it('names temporal.control.enabled when an operation finds no route', async () => {
    const client = clientAnswering(noBody);
    await expect(client.cancelWorkflow(ref)).rejects.toThrow(
      OPERATION_NOT_SERVED_MESSAGE,
    );
    expect(OPERATION_NOT_SERVED_MESSAGE).toMatch(/temporal\.control\.enabled/);
    await expect(client.startWorkflow({} as any)).rejects.toThrow(
      OPERATION_NOT_SERVED_MESSAGE,
    );
  });

  it('keeps the missing backend message for reads and queries', async () => {
    const client = clientAnswering(noBody);
    await expect(client.getWorkflow(ref)).rejects.toThrow(
      BACKEND_MISSING_MESSAGE,
    );
    await expect(client.queryWorkflow(ref, { name: 'q' })).rejects.toThrow(
      BACKEND_MISSING_MESSAGE,
    );
  });

  it('keeps the error of the backend when the 404 has an error body', async () => {
    const client = clientAnswering(withBody);
    for (const call of [
      () => client.cancelWorkflow(ref),
      () => client.getWorkflow(ref),
    ]) {
      const error = await call().catch(e => e);
      expect(error.name).toBe('ResponseError');
      expect(error.message).not.toBe(OPERATION_NOT_SERVED_MESSAGE);
      expect(error.message).not.toBe(BACKEND_MISSING_MESSAGE);
    }
  });
});

function createClientHarness(responseFactory?: () => Response) {
  const discoveryApi = mockApis.discovery();
  const fetch = jest.fn(
    async () =>
      responseFactory?.() ??
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const client = new TemporalClient({ discoveryApi, fetchApi: { fetch } });
  return { client, discoveryApi, fetch };
}

describe('TemporalClient requests and responses', () => {
  it('tests runWorkflowAction request path, encoding, body defaults, and 404 error', async () => {
    const { client, discoveryApi, fetch } = createClientHarness(
      () => new Response(JSON.stringify({ result: 'queued' }), { status: 200 }),
    );
    const base = await discoveryApi.getBaseUrl('temporal');

    const res = await client.runWorkflowAction(
      { namespace: 'default', workflowId: 'wf/1' },
      'retry.now',
      { force: true },
      { entityRef: 'component:default/orders' },
    );
    expect(res).toEqual({ result: 'queued' });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf%2F1/actions/retry.now?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      },
    );

    await client.runWorkflowAction(ref, 'sync/step');
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/actions/sync%2Fstep`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );

    const missing = createClientHarness(noBody);
    await expect(
      missing.client.runWorkflowAction(ref, 'retry'),
    ).rejects.toThrow(OPERATION_NOT_SERVED_MESSAGE);
  });

  it('serializes list and entity read requests with encoded params and query strings', async () => {
    const entityList = { items: [], truncated: false };
    const { client, discoveryApi, fetch } = createClientHarness(
      () => new Response(JSON.stringify(entityList), { status: 200 }),
    );
    const base = await discoveryApi.getBaseUrl('temporal');

    expect(
      await client.listEntityWorkflows('component:default/orders', {
        status: 'Running',
        allRuns: true,
        searchAttribute: 'CustomAttr',
        pageSize: 25,
        pageToken: 't 1',
      }),
    ).toEqual(entityList);
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/entities/component/default/orders/workflows?status=Running&allRuns=true&searchAttribute=CustomAttr&pageSize=25&pageToken=t+1`,
    );

    await client.listEntityWorkflows('component:default/orders', {
      allRuns: false,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/entities/component/default/orders/workflows`,
    );

    await client.listSchedules();
    expect(fetch).toHaveBeenLastCalledWith(`${base}/schedules`);

    await client.listSchedules({ namespace: 'payments' });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/schedules?namespace=payments`,
    );

    await client.listEntitySchedules('TemporalWorkflow:Team A/Order/Flow');
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/entities/temporalworkflow/team%20a/order%2Fflow/schedules`,
    );

    await client.listWorkflows({
      namespace: 'billing',
      status: 'Failed',
      allRuns: true,
      workflowType: 'invoiceWorkflow',
      workflowIdPrefix: 'inv-',
      searchAttribute: 'CustomerId',
      pageSize: 10,
      pageToken: 'p2',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/workflows?namespace=billing&status=Failed&allRuns=true&workflowType=invoiceWorkflow&workflowId=inv-&searchAttribute=CustomerId&pageSize=10&pageToken=p2`,
    );

    await client.getEntityWorkflowStats('component:default/orders', {
      limit: 15,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/entities/component/default/orders/workflow-stats?limit=15`,
    );
  });

  it('serializes workflow read, history, graph, llm-call, progress, and handlers requests', async () => {
    const { client, discoveryApi, fetch } = createClientHarness();
    const base = await discoveryApi.getBaseUrl('temporal');

    await client.getWorkflow(
      { namespace: 'ns/1', workflowId: 'wf 1', runId: 'run/1' },
      { entityRef: 'component:default/orders' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/ns%2F1/workflows/wf%201/runs/run%2F1?entityRef=component%3Adefault%2Forders`,
    );

    await client.getWorkflowHistory(ref, {
      entityRef: 'component:default/orders',
      pageSize: 50,
      pageToken: 'next',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/history?entityRef=component%3Adefault%2Forders&pageSize=50&pageToken=next`,
    );

    await client.getWorkflowGraph(ref, {
      entityRef: 'component:default/orders',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/graph?entityRef=component%3Adefault%2Forders`,
    );

    await client.getLlmCall(ref, 'activity-5', {
      entityRef: 'component:default/orders',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/llm-calls/5?entityRef=component%3Adefault%2Forders`,
    );

    await client.getLlmCall(ref, 'step/6');
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/llm-calls/step%2F6`,
    );

    await client.getWorkflowProgress(ref, {
      entityRef: 'component:default/orders',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/progress?entityRef=component%3Adefault%2Forders`,
    );

    await client.getWorkflowHandlers(ref, {
      entityRef: 'component:default/orders',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/handlers?entityRef=component%3Adefault%2Forders`,
    );
  });

  it('serializes query, start, signal, update, cancel, terminate, rerun, and schedule operations', async () => {
    const { client, discoveryApi, fetch } = createClientHarness(
      () => new Response(JSON.stringify({ result: 'done' }), { status: 200 }),
    );
    const base = await discoveryApi.getBaseUrl('temporal');

    expect(
      await client.queryWorkflow(
        ref,
        { name: 'state', args: [1] },
        { entityRef: 'component:default/orders' },
      ),
    ).toEqual({ result: 'done' });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/query?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'state', args: [1] }),
      },
    );

    await client.startWorkflow({
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
      args: ['a'],
    });
    expect(fetch).toHaveBeenLastCalledWith(`${base}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        args: ['a'],
      }),
    });

    await client.startWorkflow(
      { workflowType: 'orderWorkflow' },
      { entityRef: 'temporalworkflow:default/order-flow' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/entities/temporalworkflow/default/order-flow/workflows`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowType: 'orderWorkflow' }),
      },
    );

    await client.signalWorkflow(
      ref,
      { name: 'approve', args: ['ok'] },
      { entityRef: 'component:default/orders' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/signal?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'approve', args: ['ok'] }),
      },
    );

    expect(
      await client.updateWorkflow(
        ref,
        { name: 'setPriority', args: ['high'] },
        { entityRef: 'component:default/orders' },
      ),
    ).toEqual({ result: 'done' });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/update?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'setPriority', args: ['high'] }),
      },
    );

    await client.cancelWorkflow(ref, { entityRef: 'component:default/orders' });
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/cancel?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );

    await client.terminateWorkflow(
      ref,
      { reason: 'stuck' },
      { entityRef: 'component:default/orders' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/terminate?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'stuck' }),
      },
    );

    await client.rerunWorkflow(
      ref,
      { workflowId: 'wf-2' },
      { entityRef: 'component:default/orders' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/workflows/wf-1/runs/run-1/rerun?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'wf-2' }),
      },
    );

    await client.runScheduleOperation(
      { namespace: 'default', scheduleId: 'nightly/1' },
      'pause',
      { note: 'maintenance' },
      { entityRef: 'component:default/orders' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      `${base}/namespaces/default/schedules/nightly%2F1/pause?entityRef=component%3Adefault%2Forders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'maintenance' }),
      },
    );

    const missingOp = createClientHarness(noBody);
    await expect(
      missingOp.client.runScheduleOperation(
        { namespace: 'default', scheduleId: 'nightly' },
        'trigger',
      ),
    ).rejects.toThrow(OPERATION_NOT_SERVED_MESSAGE);
  });
});
