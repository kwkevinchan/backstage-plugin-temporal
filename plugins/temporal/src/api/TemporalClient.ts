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
import {
  buildEntityWorkflowsPath,
  buildWorkflowPath,
  WorkflowDetail,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatus,
  WorkflowStepsResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type { TemporalApi } from '@kwkevinchan/backstage-plugin-temporal-react';

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

  listEntityWorkflows(
    entityRef: string,
    options?: {
      status?: WorkflowStatus;
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<WorkflowListResponse> {
    return this.get(
      buildEntityWorkflowsPath(parseEntityRef(entityRef)) +
        queryString({
          status: options?.status,
          pageSize: options?.pageSize,
          pageToken: options?.pageToken,
        }),
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
}
