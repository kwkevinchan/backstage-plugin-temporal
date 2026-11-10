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

import { parseEntityRef } from '@backstage/catalog-model';
import { useMemo } from 'react';
import {
  createApiRef,
  DiscoveryApi,
  discoveryApiRef,
  FetchApi,
  fetchApiRef,
  useApiHolder,
} from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import {
  buildEntityWorkflowsPath,
  buildWorkflowActionPath,
  buildWorkflowOperationPath,
  WORKFLOWS_PATH,
  WorkflowMessageResponse,
  WorkflowRef,
  WorkflowStartRequest,
  WorkflowStartResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * Client of the routes of the Temporal backend control module
 * (`@kwkevinchan/backstage-plugin-temporal-backend-module-control`): the
 * operations that change workflows. `entityRef` is the entity the workflow
 * is shown for; the backend checks the permission on it.
 *
 * @public
 */
export interface TemporalControlApi {
  /**
   * Starts a workflow. With `entityRef`, a workflow of that entity (its
   * workflow type and task queue are the defaults); without it, from the
   * Workflows page (`workflowType` and `taskQueue` are required). Needs
   * `temporal.workflow.start`.
   */
  startWorkflow(
    request: WorkflowStartRequest,
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse>;

  /**
   * Sends a signal to a running workflow. Needs `temporal.workflow.signal`.
   */
  signalWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Sends an update to a running workflow and waits for its result. Needs
   * `temporal.workflow.update`. A rejected update throws with the
   * workflow's message.
   */
  updateWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;

  /** Asks a running workflow to cancel. Needs `temporal.workflow.cancel`. */
  cancelWorkflow(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Terminates a running workflow at once. Needs
   * `temporal.workflow.terminate`.
   */
  terminateWorkflow(
    ref: WorkflowRef,
    request: { reason?: string },
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Starts a run again with the same input under a new workflow ID. Needs
   * `temporal.workflow.rerun`.
   */
  rerunWorkflow(
    ref: WorkflowRef,
    request?: { workflowId?: string },
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse>;

  /**
   * Runs a custom action that a backend module added with
   * `temporalControlExtensionPoint.addControlAction()`.
   */
  runWorkflowAction(
    ref: WorkflowRef,
    actionId: string,
    body?: JsonValue,
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;
}

/**
 * API reference of {@link TemporalControlApi}. The module provides the
 * default implementation, {@link TemporalControlClient}.
 *
 * @public
 */
export const temporalControlApiRef = createApiRef<TemporalControlApi>({
  id: 'plugin.temporal.control',
});

function entityQuery(options?: { entityRef?: string }): string {
  return options?.entityRef
    ? `?${new URLSearchParams({ entityRef: options.entityRef })}`
    : '';
}

/**
 * Default implementation of {@link TemporalControlApi}, calling the
 * Temporal backend plugin.
 *
 * @public
 */
export class TemporalControlClient implements TemporalControlApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('temporal');
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as T;
  }

  startWorkflow(
    request: WorkflowStartRequest,
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse> {
    return this.post(
      options?.entityRef
        ? buildEntityWorkflowsPath(parseEntityRef(options.entityRef))
        : WORKFLOWS_PATH,
      request,
    );
  }

  async signalWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<void> {
    await this.post(
      buildWorkflowOperationPath(ref, 'signal') + entityQuery(options),
      request,
    );
  }

  updateWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse> {
    return this.post(
      buildWorkflowOperationPath(ref, 'update') + entityQuery(options),
      request,
    );
  }

  async cancelWorkflow(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<void> {
    await this.post(
      buildWorkflowOperationPath(ref, 'cancel') + entityQuery(options),
    );
  }

  async terminateWorkflow(
    ref: WorkflowRef,
    request: { reason?: string },
    options?: { entityRef?: string },
  ): Promise<void> {
    await this.post(
      buildWorkflowOperationPath(ref, 'terminate') + entityQuery(options),
      request,
    );
  }

  rerunWorkflow(
    ref: WorkflowRef,
    request?: { workflowId?: string },
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse> {
    return this.post(
      buildWorkflowOperationPath(ref, 'rerun') + entityQuery(options),
      request,
    );
  }

  runWorkflowAction(
    ref: WorkflowRef,
    actionId: string,
    body?: JsonValue,
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse> {
    return this.post(
      buildWorkflowActionPath(ref, actionId) + entityQuery(options),
      body,
    );
  }
}

/**
 * The registered {@link TemporalControlApi}, or a {@link TemporalControlClient}
 * when the app has none: a legacy app that did not add
 * `temporalControlApiFactory` to its APIs still gets working buttons instead
 * of a details page that fails.
 */
export function useTemporalControlApi(): TemporalControlApi {
  const apis = useApiHolder();
  return useMemo(() => {
    const registered = apis.get(temporalControlApiRef);
    if (registered) return registered;
    const discoveryApi = apis.get(discoveryApiRef);
    const fetchApi = apis.get(fetchApiRef);
    if (!discoveryApi || !fetchApi) {
      throw new Error(
        'The Temporal control module needs the discovery and fetch APIs',
      );
    }
    return new TemporalControlClient({ discoveryApi, fetchApi });
  }, [apis]);
}
