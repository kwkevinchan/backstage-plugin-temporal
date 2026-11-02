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

/** Seconds between automatic reloads of a running workflow. */
export const AUTO_REFRESH_MS = 5000;

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
  reload(): void;
}

/**
 * Loads a workflow and its step graph. While the workflow runs and
 * `autoRefresh` is on, both are reloaded every five seconds.
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

  const load = useCallback(async () => {
    const current = ++generation.current;
    setState(s => ({ ...s, refreshing: true }));
    try {
      const workflow = await temporalApi.getWorkflow(ref, { entityRef });
      let graph: WorkflowGraphResponse | undefined;
      let graphError: Error | undefined;
      try {
        graph = await temporalApi.getWorkflowGraph(
          {
            namespace: workflow.namespace,
            workflowId: workflow.workflowId,
            runId: workflow.runId,
          },
          { entityRef },
        );
      } catch (e) {
        graphError = e as Error;
      }
      if (current !== generation.current) return;
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
    }
  }, [temporalApi, ref, entityRef]);

  useEffect(() => {
    setState({ loading: true, refreshing: false });
    load();
  }, [load]);

  const running = state.workflow?.status === 'Running';
  useEffect(() => {
    if (!running || !autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      load();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [running, autoRefresh, load]);

  return { ...state, reload: load };
}
