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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import type {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRef,
} from '../common';
import { temporalApiRef } from '../extensions';

/** Milliseconds between automatic reloads of a running workflow. */
export const AUTO_REFRESH_MS = 10_000;

/**
 * Longest time an automatic reload reuses a step graph, because the graph
 * also depends on things its key cannot see, such as a payload that failed
 * to load once.
 */
export const GRAPH_MAX_AGE_MS = 60_000;

export interface WorkflowData {
  workflow?: WorkflowDetail;
  graph?: WorkflowGraphResponse;
  /** Error of the workflow details; the page cannot be shown. */
  error?: Error;
  /** Error of the graph only; the details are still shown. */
  graphError?: Error;
  /** True only for the first load; reloads keep the data on screen. */
  loading: boolean;
  refreshing: boolean;
  /** Loads the workflow and its graph again. */
  reload(): void;
}

/**
 * What the step graph of a run changes with: a new event in its history
 * (the status, search attributes and memo change with one too) and the
 * fields of its pending activities that the graph shows, which change
 * without an event (a heartbeat is not among them).
 * Undefined when the history length is not known.
 */
function graphKey(ref: WorkflowRef, workflow: WorkflowDetail) {
  if (workflow.historyLength === undefined) return undefined;
  return JSON.stringify([
    ref.namespace,
    workflow.workflowId,
    workflow.runId,
    workflow.status,
    workflow.historyLength,
    // Keep in step with the pending activities part of `buildWorkflowGraph`.
    [...workflow.pendingActivities]
      .sort((a, b) => a.activityId.localeCompare(b.activityId))
      .map(a => [
        a.activityId,
        a.attempt,
        a.maximumAttempts,
        a.lastFailure,
        a.state,
        a.lastStartedTime,
      ]),
  ]);
}

/** True while the page is shown: false in a background tab. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * Loads a workflow and its step graph. While the workflow runs,
 * `autoRefresh` is on and the page is shown, the workflow is loaded again
 * every ten seconds, and its graph when it has changed (see `graphKey`) or
 * is a minute old: the backend reads the whole history of the run for a
 * graph. An automatic reload does not start while another load is running.
 * A page that was hidden reloads when it is shown again.
 */
export function useWorkflowData(
  ref: WorkflowRef,
  entityRef: string | undefined,
  autoRefresh: boolean,
): WorkflowData {
  const temporalApi = useApi(temporalApiRef);
  const [state, setState] = useState<Omit<WorkflowData, 'reload'>>({
    loading: true,
    refreshing: false,
  });
  const generation = useRef(0);
  // The graph on screen and what it was loaded for.
  const loaded = useRef<
    { key: string; graph: WorkflowGraphResponse; at: number } | undefined
  >(undefined);
  // Generations of the loads of the current `ref` that have not ended.
  const inFlight = useRef(new Set<number>());

  // `onlyChanges`: the graph on screen is kept when it has not changed.
  const load = useCallback(
    async (onlyChanges: boolean) => {
      if (onlyChanges && inFlight.current.size > 0) return;
      const current = ++generation.current;
      const myLoads = inFlight.current;
      myLoads.add(current);
      setState(s => ({ ...s, refreshing: true }));
      try {
        const workflow = await temporalApi.getWorkflow(ref, { entityRef });
        // Superseded while waiting: the graph would be requested for nothing.
        if (current !== generation.current) return;
        const key = graphKey(ref, workflow);
        let graph: WorkflowGraphResponse | undefined;
        let graphError: Error | undefined;
        let fetchedAt = Date.now();
        const cached = loaded.current;
        if (
          onlyChanges &&
          key !== undefined &&
          cached?.key === key &&
          Date.now() - cached.at < GRAPH_MAX_AGE_MS
        ) {
          graph = cached.graph;
          fetchedAt = cached.at;
        } else {
          try {
            graph = await temporalApi.getWorkflowGraph(
              {
                namespace: workflow.namespace,
                workflowId: workflow.workflowId,
                runId: workflow.runId,
              },
              { entityRef },
            );
            fetchedAt = Date.now();
          } catch (e) {
            graphError = e as Error;
          }
        }
        if (current !== generation.current) return;
        loaded.current =
          graph && key !== undefined
            ? { key, graph, at: fetchedAt }
            : undefined;
        setState({
          workflow,
          graph,
          graphError,
          loading: false,
          refreshing: false,
        });
      } catch (e) {
        if (current !== generation.current) return;
        setState(s => ({
          ...s,
          error: e as Error,
          loading: false,
          refreshing: false,
        }));
      } finally {
        myLoads.delete(current);
      }
    },
    [temporalApi, ref, entityRef],
  );
  const reload = useCallback(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    setState({ loading: true, refreshing: false });
    loaded.current = undefined;
    inFlight.current = new Set();
    load(false);
  }, [load]);

  const running = state.workflow?.status === 'Running';
  const visible = usePageVisible();
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasHidden.current = true;
      return undefined;
    }
    const catchUp = wasHidden.current;
    wasHidden.current = false;
    if (!running || !autoRefresh) return undefined;
    if (catchUp) load(true);
    const timer = window.setInterval(() => {
      load(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [running, autoRefresh, visible, load]);

  return { ...state, reload };
}
