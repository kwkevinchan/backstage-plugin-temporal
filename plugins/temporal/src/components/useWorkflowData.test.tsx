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

import { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '../extensions';
import { failedWorkflow, mockTemporalApi } from '../testData';
import { AUTO_REFRESH_MS, useWorkflowData } from './useWorkflowData';

const ref = { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' };
const running: WorkflowDetail = {
  ...failedWorkflow,
  status: 'Running',
  historyLength: 12,
};

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Lets the requests of a load, which are resolved promises, settle. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function tick() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
  });
}

describe('useWorkflowData', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    setVisibility('visible');
  });

  async function setup(workflow: WorkflowDetail, autoRefresh = true) {
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue(workflow);
    const hook = renderHook(
      (props: { autoRefresh: boolean }) =>
        useWorkflowData(ref, undefined, props.autoRefresh),
      {
        initialProps: { autoRefresh },
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestApiProvider apis={[[temporalApiRef, api]]}>
            {children}
          </TestApiProvider>
        ),
      },
    );
    await settle();
    expect(hook.result.current.workflow).toBeDefined();
    return { api, ...hook };
  }

  it('reloads a running workflow, and its graph only when it changed', async () => {
    const { api, result } = await setup(running);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);
    const graph = result.current.graph;

    // Nothing new: the workflow is asked for, the graph is kept.
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);
    expect(result.current.graph).toBe(graph);

    // A new event.
    api.getWorkflow.mockResolvedValue({ ...running, historyLength: 15 });
    await tick();
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);

    // A retry of a pending activity adds no event.
    api.getWorkflow.mockResolvedValue({
      ...running,
      historyLength: 15,
      pendingActivities: [{ ...running.pendingActivities[0], attempt: 5 }],
    });
    await tick();
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(3);
  });

  it('loads the graph every time when the history length is unknown', async () => {
    const { api } = await setup({ ...running, historyLength: undefined });
    await tick();
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);
  });

  it('loads the graph again after it failed', async () => {
    const { api, result } = await setup(running);
    api.getWorkflow.mockResolvedValue({ ...running, historyLength: 15 });
    api.getWorkflowGraph.mockRejectedValueOnce(new Error('no graph'));
    await tick();
    expect(result.current.graphError).toBeDefined();
    await tick();
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(3);
    expect(result.current.graphError).toBeUndefined();
  });

  it('reload loads the graph even when nothing changed', async () => {
    const { api, result } = await setup(running);
    act(() => result.current.reload());
    await settle();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);
  });

  it('does not reload a closed workflow, or with auto refresh off', async () => {
    const closed = await setup(failedWorkflow);
    await tick();
    expect(closed.api.getWorkflow).toHaveBeenCalledTimes(1);

    const off = await setup(running, false);
    await tick();
    expect(off.api.getWorkflow).toHaveBeenCalledTimes(1);
  });

  it('stops while the page is hidden and catches up when it is shown', async () => {
    const { api } = await setup(running);
    setVisibility('hidden');
    await tick();
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await settle();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(3);
  });
});
