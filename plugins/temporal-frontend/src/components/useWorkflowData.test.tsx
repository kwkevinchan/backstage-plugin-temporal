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
import type {
  PendingActivity,
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRef,
} from '../common';
import { temporalApiRef } from '../extensions';
import { failedWorkflow, graphResponse, mockTemporalApi } from '../testData';
import {
  AUTO_REFRESH_MS,
  GRAPH_MAX_AGE_MS,
  useWorkflowData,
} from './useWorkflowData';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function activity(id: string, extra: Partial<PendingActivity> = {}) {
  return {
    activityId: id,
    activityType: 'charge',
    state: 'Scheduled',
    attempt: 1,
    ...extra,
  } as PendingActivity;
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

  it('does not start an automatic reload while a manual one is running', async () => {
    const { api, result } = await setup(running);
    const manualGraph = { ...graphResponse } as WorkflowGraphResponse;
    const slow = deferred<WorkflowGraphResponse>();
    api.getWorkflowGraph.mockReturnValueOnce(slow.promise);

    act(() => result.current.reload());
    await settle();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);

    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);

    await act(async () => {
      slow.resolve(manualGraph);
    });
    await settle();
    expect(result.current.graph).toBe(manualGraph);

    // Automatic reloads are not switched off for good.
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(3);
  });

  it('starts automatic reloads again after a load failed', async () => {
    const { api, result } = await setup(running);
    api.getWorkflow.mockRejectedValueOnce(new Error('down'));
    act(() => result.current.reload());
    await settle();
    expect(result.current.error).toBeDefined();
    api.getWorkflow.mockResolvedValue(running);
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(3);
  });

  it('loads the graph again when the one on screen is too old', async () => {
    const { api } = await setup(running);
    for (let i = 0; i < GRAPH_MAX_AGE_MS / AUTO_REFRESH_MS - 1; i++) {
      await tick();
    }
    expect(api.getWorkflow).toHaveBeenCalledTimes(6);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);

    await tick();
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);
  });

  it('does not load the graph when only a heartbeat changed', async () => {
    const pending = activity('charge-1', { state: 'Started' });
    const { api } = await setup({ ...running, pendingActivities: [pending] });
    api.getWorkflow.mockResolvedValue({
      ...running,
      pendingActivities: [
        { ...pending, lastHeartbeatTime: '2026-01-01T00:00:10.000Z' },
      ],
    });
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);
  });

  it('does not load the graph when pending activities came in another order', async () => {
    const a = activity('a');
    const b = activity('b');
    const { api } = await setup({ ...running, pendingActivities: [a, b] });
    api.getWorkflow.mockResolvedValue({
      ...running,
      pendingActivities: [b, a],
    });
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);
  });

  it('loads the graph of the new run when the ref changes', async () => {
    const api = mockTemporalApi();
    const graphs: Record<string, WorkflowGraphResponse> = {
      'run-2': { ...graphResponse },
      'run-3': { ...graphResponse },
    };
    const slowThird = deferred<WorkflowGraphResponse>();
    api.getWorkflow.mockImplementation(async r => ({
      ...running,
      runId: r.runId as string,
    }));
    api.getWorkflowGraph.mockImplementation(r =>
      r.runId === 'run-3'
        ? slowThird.promise
        : Promise.resolve(graphs['run-2']),
    );
    const second = ref;
    const third = { ...ref, runId: 'run-3' };
    const { result, rerender } = renderHook(
      (props: { r: typeof ref }) => useWorkflowData(props.r, undefined, true),
      {
        initialProps: { r: second },
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestApiProvider apis={[[temporalApiRef, api]]}>
            {children}
          </TestApiProvider>
        ),
      },
    );
    await settle();
    expect(result.current.graph).toBe(graphs['run-2']);

    rerender({ r: third });
    await settle();
    expect(api.getWorkflowGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: 'run-3' }),
      expect.anything(),
    );
    expect(result.current.graph).toBeUndefined();

    await act(async () => {
      slowThird.resolve(graphs['run-3']);
    });
    await settle();
    expect(result.current.graph).toBe(graphs['run-3']);
  });

  it('loads once and waits to be shown when it is mounted in a hidden tab', async () => {
    setVisibility('hidden');
    const { api, result } = await setup(running);
    expect(result.current.graph).toBeDefined();
    await tick();
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await settle();
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    await tick();
    expect(api.getWorkflow).toHaveBeenCalledTimes(3);
  });

  describe('when the page moves to another workflow while a load runs', () => {
    type Call<T> = {
      ref: WorkflowRef;
      answered: boolean;
      resolve(value: T): void;
      reject(error: Error): void;
    };

    /**
     * An api whose requests stay open until the test answers them, so the
     * test decides which response arrives first.
     */
    function controlledApi() {
      const api = mockTemporalApi();
      const workflowCalls: Call<WorkflowDetail>[] = [];
      const graphCalls: Call<WorkflowGraphResponse>[] = [];
      const track = <T,>(
        calls: Call<T>[],
        r: WorkflowRef,
        resolve: (value: T) => void,
        reject: (error: Error) => void,
      ) => {
        const call: Call<T> = {
          ref: r,
          answered: false,
          resolve: value => {
            call.answered = true;
            resolve(value);
          },
          reject: error => {
            call.answered = true;
            reject(error);
          },
        };
        calls.push(call);
      };
      api.getWorkflow.mockImplementation(
        r =>
          new Promise((resolve, reject) =>
            track(workflowCalls, r, resolve, reject),
          ),
      );
      api.getWorkflowGraph.mockImplementation(
        r =>
          new Promise((resolve, reject) =>
            track(graphCalls, r, resolve, reject),
          ),
      );
      // The newest request for the run that has not been answered.
      const open = <T,>(calls: Call<T>[], runId: string) =>
        [...calls].reverse().find(c => !c.answered && c.ref.runId === runId);
      const need = <T,>(calls: Call<T>[], runId: string) => {
        const call = open(calls, runId);
        if (!call) throw new Error(`no open request for ${runId}`);
        return call;
      };
      return {
        api,
        workflowCalls,
        graphCalls,
        workflowOf: (runId: string) => need(workflowCalls, runId),
        graphOf: (runId: string) => need(graphCalls, runId),
        /** For requests a load that was superseded may not have sent. */
        graphOfIfAsked: (runId: string) => open(graphCalls, runId),
      };
    }

    function render(
      api: ReturnType<typeof mockTemporalApi>,
      first: WorkflowRef,
    ) {
      return renderHook(
        (props: { r: WorkflowRef }) =>
          useWorkflowData(props.r, undefined, true),
        {
          initialProps: { r: first },
          wrapper: ({ children }: { children: ReactNode }) => (
            <TestApiProvider apis={[[temporalApiRef, api]]}>
              {children}
            </TestApiProvider>
          ),
        },
      );
    }

    async function answer(fn: () => void) {
      await act(async () => {
        fn();
      });
      await settle();
    }

    const detail = (r: WorkflowRef, extra: Partial<WorkflowDetail> = {}) =>
      ({
        ...running,
        workflowId: r.workflowId,
        runId: r.runId as string,
        ...extra,
      } as WorkflowDetail);
    const graphFor = (name: string) =>
      ({ ...graphResponse, name } as unknown as WorkflowGraphResponse);

    // A run of another workflow, and the next run of the same workflow
    // (Continue-As-New): both count as another page.
    const targets: [string, WorkflowRef][] = [
      ['another run of the same workflow', { ...ref, runId: 'run-3' }],
      ['another workflow', { ...ref, workflowId: 'order-9', runId: 'run-9' }],
    ];

    describe.each(targets)('moving to %s', (_name, next) => {
      it('shows the new workflow when the old one arrives after it', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();

        await answer(() =>
          c.workflowOf(next.runId as string).resolve(detail(next)),
        );
        await answer(() =>
          c.graphOf(next.runId as string).resolve(graphFor('next')),
        );
        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        await answer(() => c.graphOfIfAsked('run-2')?.resolve(graphFor('old')));

        expect(result.current.workflow?.runId).toBe(next.runId);
        expect(result.current.workflow?.workflowId).toBe(next.workflowId);
        expect(result.current.graph).toEqual(graphFor('next'));
        expect(result.current.loading).toBe(false);
      });

      it('shows the graph of the new workflow when the old one arrives after it', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        // The old workflow arrived, its graph is still on its way.
        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        rerender({ r: next });
        await settle();

        await answer(() =>
          c.workflowOf(next.runId as string).resolve(detail(next)),
        );
        await answer(() =>
          c.graphOf(next.runId as string).resolve(graphFor('next')),
        );
        await answer(() => c.graphOf('run-2').resolve(graphFor('old')));

        expect(result.current.workflow?.runId).toBe(next.runId);
        expect(result.current.graph).toEqual(graphFor('next'));
        expect(result.current.graphError).toBeUndefined();
      });

      it('does not show the error of the old workflow on the new one', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();

        await answer(() =>
          c.workflowOf(next.runId as string).resolve(detail(next)),
        );
        await answer(() =>
          c.graphOf(next.runId as string).resolve(graphFor('next')),
        );
        await answer(() =>
          c.workflowOf('run-2').reject(new Error('old failed')),
        );

        expect(result.current.error).toBeUndefined();
        expect(result.current.workflow?.runId).toBe(next.runId);
        expect(result.current.graph).toEqual(graphFor('next'));
      });

      it('does not show the graph error of the old workflow on the new one', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        rerender({ r: next });
        await settle();

        await answer(() =>
          c.workflowOf(next.runId as string).resolve(detail(next)),
        );
        await answer(() =>
          c.graphOf(next.runId as string).resolve(graphFor('next')),
        );
        await answer(() =>
          c.graphOf('run-2').reject(new Error('old graph failed')),
        );

        expect(result.current.graphError).toBeUndefined();
        expect(result.current.graph).toEqual(graphFor('next'));
      });

      it('keeps loading until the new workflow arrives, whatever the old one does', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();
        expect(result.current.loading).toBe(true);

        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        expect(result.current.loading).toBe(true);
        expect(result.current.workflow).toBeUndefined();
        await answer(() => c.graphOfIfAsked('run-2')?.resolve(graphFor('old')));
        expect(result.current.loading).toBe(true);
        expect(result.current.workflow).toBeUndefined();
        expect(result.current.graph).toBeUndefined();

        await answer(() =>
          c.workflowOf(next.runId as string).resolve(detail(next)),
        );
        await answer(() =>
          c.graphOf(next.runId as string).resolve(graphFor('next')),
        );
        expect(result.current.loading).toBe(false);
        expect(result.current.workflow?.runId).toBe(next.runId);
      });

      it('keeps loading when the old workflow fails first', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();

        await answer(() =>
          c.workflowOf('run-2').reject(new Error('old failed')),
        );
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBeUndefined();
      });

      it('does not let the graph of the old workflow into the graph cache', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        await answer(() => c.graphOf('run-2').resolve(graphFor('old')));

        // An automatic reload of the old workflow finds a new event and is
        // still waiting for its graph when the page moves on.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
        });
        await answer(() =>
          c.workflowOf('run-2').resolve(detail(ref, { historyLength: 20 })),
        );
        rerender({ r: next });
        await settle();

        const nextRun = next.runId as string;
        await answer(() =>
          c.workflowOf(nextRun).resolve(detail(next, { historyLength: 20 })),
        );
        await answer(() => c.graphOf(nextRun).resolve(graphFor('next')));
        await answer(() => c.graphOf('run-2').resolve(graphFor('old')));
        expect(result.current.graph).toEqual(graphFor('next'));

        // The next automatic reload sees nothing new on the new workflow:
        // it keeps the graph that was loaded for it, and asks for no other.
        const graphRequests = c.graphCalls.length;
        const workflowRequests = c.workflowCalls.length;
        await act(async () => {
          await jest.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
        });
        expect(c.workflowCalls.length).toBe(workflowRequests + 1);
        await answer(() =>
          c.workflowOf(nextRun).resolve(detail(next, { historyLength: 20 })),
        );
        expect(c.graphCalls.length).toBe(graphRequests);
        expect(result.current.graph).toEqual(graphFor('next'));
      });

      it('asks for no graph for an old workflow that arrives after the move', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();
        const nextRun = next.runId as string;

        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        expect(c.graphCalls).toHaveLength(0);
        expect(result.current.loading).toBe(true);

        await answer(() => c.workflowOf(nextRun).resolve(detail(next)));
        await answer(() => c.graphOf(nextRun).resolve(graphFor('next')));
        expect(c.graphCalls.map(g => g.ref.runId)).toEqual([nextRun]);
        expect(result.current.loading).toBe(false);
        expect(result.current.refreshing).toBe(false);
      });

      it('starts automatic reloads of the new workflow while a load of the old one is open', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        rerender({ r: next });
        await settle();
        const nextRun = next.runId as string;
        await answer(() => c.workflowOf(nextRun).resolve(detail(next)));
        await answer(() => c.graphOf(nextRun).resolve(graphFor('next')));
        const requests = c.workflowCalls.length;

        // The load of the old workflow never ends; it must not hold back
        // the automatic reloads of the page that is shown.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
        });
        expect(c.workflowCalls.length).toBe(requests + 1);
        expect(c.workflowCalls[requests].ref.runId).toBe(nextRun);
        expect(result.current.workflow?.runId).toBe(nextRun);
      });

      it('drops a manual reload of the old workflow that arrives after the move', async () => {
        const c = controlledApi();
        const { result, rerender } = render(c.api, ref);
        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        await answer(() => c.graphOf('run-2').resolve(graphFor('old')));

        act(() => result.current.reload());
        await settle();
        rerender({ r: next });
        await settle();
        const nextRun = next.runId as string;
        await answer(() => c.workflowOf(nextRun).resolve(detail(next)));
        await answer(() => c.graphOf(nextRun).resolve(graphFor('next')));

        await answer(() => c.workflowOf('run-2').resolve(detail(ref)));
        await answer(() => c.graphOfIfAsked('run-2')?.resolve(graphFor('old')));
        expect(result.current.workflow?.runId).toBe(nextRun);
        expect(result.current.graph).toEqual(graphFor('next'));
        expect(result.current.refreshing).toBe(false);
      });
    });
  });

  describe('when a newer load of the same workflow overtakes an older one', () => {
    // The Refresh button is not locked by an automatic reload, so a press
    // can come while one is open. Two presses cannot overlap (the button
    // locks) and an automatic reload does not start while another load runs.
    async function startOverlap(autoWorkflow?: WorkflowDetail) {
      const calls: {
        resolve(v: WorkflowDetail): void;
        reject(e: Error): void;
      }[] = [];
      const graphs: {
        resolve(v: WorkflowGraphResponse): void;
        reject(e: Error): void;
      }[] = [];
      const api = mockTemporalApi();
      api.getWorkflow.mockImplementation(
        () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
      );
      api.getWorkflowGraph.mockImplementation(
        () =>
          new Promise((resolve, reject) => graphs.push({ resolve, reject })),
      );
      const hook = renderHook(() => useWorkflowData(ref, undefined, true), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestApiProvider apis={[[temporalApiRef, api]]}>
            {children}
          </TestApiProvider>
        ),
      });
      const resolveAt = async (fn: () => void) => {
        await act(async () => {
          fn();
        });
        await settle();
      };
      const first = { ...running, historyLength: 12 };
      await resolveAt(() => calls[0].resolve(first));
      await resolveAt(() =>
        graphs[0].resolve({ ...graphResponse, name: 'first' } as never),
      );
      // An automatic reload is open when Refresh is pressed.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(AUTO_REFRESH_MS);
      });
      // Its workflow may have arrived, and its graph be on the way.
      if (autoWorkflow) await resolveAt(() => calls[1].resolve(autoWorkflow));
      act(() => hook.result.current.reload());
      await settle();
      expect(calls).toHaveLength(3);
      return { ...hook, api, calls, graphs, resolveAt };
    }

    const refreshed = { ...running, historyLength: 30 };
    const graphOf = (name: string) =>
      ({ ...graphResponse, name } as unknown as WorkflowGraphResponse);

    it('keeps the workflow and graph of Refresh when the older automatic reload arrives after it', async () => {
      const { result, calls, graphs, resolveAt } = await startOverlap();
      await resolveAt(() => calls[2].resolve(refreshed));
      await resolveAt(() => graphs[1].resolve(graphOf('refresh')));
      expect(result.current.workflow?.historyLength).toBe(30);
      expect(result.current.refreshing).toBe(false);

      await resolveAt(() =>
        calls[1].resolve({ ...running, historyLength: 20 }),
      );
      expect(graphs).toHaveLength(2);
      expect(result.current.workflow?.historyLength).toBe(30);
      expect(result.current.graph).toEqual(graphOf('refresh'));
      expect(result.current.refreshing).toBe(false);
    });

    it('keeps the graph of Refresh when the graph of the older automatic reload arrives after it', async () => {
      const { result, calls, graphs, resolveAt } = await startOverlap({
        ...running,
        historyLength: 20,
      });
      // The automatic reload found a new event and asked for a graph.
      expect(graphs).toHaveLength(2);
      await resolveAt(() => calls[2].resolve(refreshed));
      await resolveAt(() => graphs[2].resolve(graphOf('refresh')));

      await resolveAt(() => graphs[1].resolve(graphOf('automatic')));
      expect(result.current.workflow?.historyLength).toBe(30);
      expect(result.current.graph).toEqual(graphOf('refresh'));
    });

    it('does not show the error of the older automatic reload after Refresh succeeded', async () => {
      const { result, calls, graphs, resolveAt } = await startOverlap();
      await resolveAt(() => calls[2].resolve(refreshed));
      await resolveAt(() => graphs[1].resolve(graphOf('refresh')));

      await resolveAt(() => calls[1].reject(new Error('automatic failed')));
      expect(result.current.error).toBeUndefined();
      expect(result.current.workflow?.historyLength).toBe(30);
      expect(result.current.refreshing).toBe(false);
    });

    it('does not show the graph error of the older automatic reload after Refresh succeeded', async () => {
      const { result, calls, graphs, resolveAt } = await startOverlap({
        ...running,
        historyLength: 20,
      });
      expect(graphs).toHaveLength(2);
      await resolveAt(() => calls[2].resolve(refreshed));
      await resolveAt(() => graphs[2].resolve(graphOf('refresh')));

      await resolveAt(() => graphs[1].reject(new Error('graph failed')));
      expect(result.current.graphError).toBeUndefined();
      expect(result.current.graph).toEqual(graphOf('refresh'));
    });

    it('does not send a graph request for the older automatic reload after Refresh arrived', async () => {
      const { calls, graphs, resolveAt } = await startOverlap();
      await resolveAt(() => calls[2].resolve(refreshed));
      await resolveAt(() => graphs[1].resolve(graphOf('refresh')));
      await resolveAt(() =>
        calls[1].resolve({ ...running, historyLength: 20 }),
      );
      expect(graphs).toHaveLength(2);
    });
  });
});
