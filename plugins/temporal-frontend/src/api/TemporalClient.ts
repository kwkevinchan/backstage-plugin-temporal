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
import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import {
  buildEntityWorkflowStatsPath,
  buildWorkflowHandlersPath,
  buildWorkflowOperationPath,
  WorkflowHandlersResponse,
  WorkflowMessageResponse,
  buildEntityWorkflowsPath,
  buildLlmCallPath,
  buildWorkflowPath,
  WORKFLOWS_PATH,
  SCHEDULES_PATH,
  buildEntitySchedulesPath,
  TemporalScheduleListResponse,
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowLlmCallResponse,
  WorkflowLoopsResponse,
  WorkflowHistoryResponse,
  WorkflowProgressResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowStepsResponse,
} from '../common';
import type { TemporalApi } from '../extensions';

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Default implementation of `TemporalApi`, calling the backend plugin.
 *
 * @public
 */
export class TemporalClient implements TemporalApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async get<T>(path: string): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('temporal');
    const response = await this.fetchApi.fetch(`${baseUrl}${path}`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as T;
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

  listEntityWorkflows(
    entityRef: string,
    options?: {
      status?: WorkflowStatus;
      allRuns?: boolean;
      searchAttribute?: string;
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<WorkflowListResponse> {
    return this.get(
      buildEntityWorkflowsPath(parseEntityRef(entityRef)) +
        queryString({
          status: options?.status,
          allRuns: options?.allRuns ? 'true' : undefined,
          searchAttribute: options?.searchAttribute,
          pageSize: options?.pageSize,
          pageToken: options?.pageToken,
        }),
    );
  }

  listSchedules(options?: {
    namespace?: string;
  }): Promise<TemporalScheduleListResponse> {
    return this.get(
      SCHEDULES_PATH + queryString({ namespace: options?.namespace }),
    );
  }

  listEntitySchedules(
    entityRef: string,
  ): Promise<TemporalScheduleListResponse> {
    return this.get(buildEntitySchedulesPath(parseEntityRef(entityRef)));
  }

  listWorkflows(options?: {
    namespace?: string;
    status?: WorkflowStatus;
    allRuns?: boolean;
    workflowType?: string;
    workflowIdPrefix?: string;
    searchAttribute?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<WorkflowListResponse> {
    return this.get(
      WORKFLOWS_PATH +
        queryString({
          namespace: options?.namespace,
          status: options?.status,
          allRuns: options?.allRuns ? 'true' : undefined,
          workflowType: options?.workflowType,
          workflowId: options?.workflowIdPrefix,
          searchAttribute: options?.searchAttribute,
          pageSize: options?.pageSize,
          pageToken: options?.pageToken,
        }),
    );
  }

  getEntityWorkflowStats(
    entityRef: string,
    options?: { limit?: number },
  ): Promise<WorkflowStatsResponse> {
    return this.get(
      buildEntityWorkflowStatsPath(parseEntityRef(entityRef)) +
        queryString({ limit: options?.limit }),
    );
  }

  getWorkflow(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowDetail> {
    return this.get(
      buildWorkflowPath(ref) + queryString({ entityRef: options?.entityRef }),
    );
  }

  getWorkflowHistory(
    ref: WorkflowRef,
    options?: { entityRef?: string; pageSize?: number; pageToken?: string },
  ): Promise<WorkflowHistoryResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}/history${queryString({
        entityRef: options?.entityRef,
        pageSize: options?.pageSize,
        pageToken: options?.pageToken,
      })}`,
    );
  }

  getWorkflowSteps(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowStepsResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}/steps${queryString({
        entityRef: options?.entityRef,
      })}`,
    );
  }

  getWorkflowGraph(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowGraphResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}/graph${queryString({
        entityRef: options?.entityRef,
      })}`,
    );
  }

  getWorkflowLoops(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowLoopsResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}/loops${queryString({
        entityRef: options?.entityRef,
      })}`,
    );
  }

  getLlmCall(
    ref: WorkflowRef,
    nodeId: string,
    options?: { entityRef?: string },
  ): Promise<WorkflowLlmCallResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}${buildLlmCallPath(nodeId)}${queryString({
        entityRef: options?.entityRef,
      })}`,
    );
  }

  getWorkflowProgress(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowProgressResponse> {
    return this.get(
      `${buildWorkflowPath(ref)}/progress${queryString({
        entityRef: options?.entityRef,
      })}`,
    );
  }

  async downloadPayload(
    ref: WorkflowRef,
    options: { key: string; entityRef?: string },
  ): Promise<Blob> {
    const baseUrl = await this.discoveryApi.getBaseUrl('temporal');
    const response = await this.fetchApi.fetch(
      `${baseUrl}${buildWorkflowPath(ref)}/payloads/download${queryString({
        entityRef: options.entityRef,
        key: options.key,
      })}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.blob();
  }

  queryWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse> {
    return this.post(
      buildWorkflowOperationPath(ref, 'query') +
        queryString({ entityRef: options?.entityRef }),
      request,
    );
  }

  getWorkflowHandlers(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowHandlersResponse> {
    return this.get(
      buildWorkflowHandlersPath(ref) +
        queryString({ entityRef: options?.entityRef }),
    );
  }
}
