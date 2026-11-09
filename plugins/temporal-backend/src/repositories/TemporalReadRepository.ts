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

import {
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import type { WorkflowRef } from '@kwkevinchan/backstage-plugin-temporal-common';
import type { TemporalService } from '@kwkevinchan/backstage-plugin-temporal-node';

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

/** Rethrows a Temporal (gRPC) error as the Backstage error of its HTTP status. */
export function mapTemporalError(error: unknown): never {
  const code = (error as { code?: unknown })?.code;
  const message = (error as Error)?.message ?? String(error);
  if (code === GRPC_NOT_FOUND) throw new NotFoundError(message);
  if (code === GRPC_INVALID_ARGUMENT) throw new InputError(message);
  if (code === GRPC_UNAVAILABLE) {
    throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
  }
  throw error;
}

/** The protobuf JSON of a Temporal response message. */
function toJson(message: unknown): any {
  const m = message as { toJSON?: () => unknown } | undefined;
  return m && typeof m.toJSON === 'function' ? m.toJSON() : message;
}

/** One page of a Temporal list call, as protobuf JSON. */
export interface TemporalPage<T> {
  items: T[];
  nextPageToken?: Uint8Array;
}

/**
 * The read calls the plugin makes to Temporal's workflow service. Results
 * are protobuf JSON; errors are mapped to Backstage errors. Nothing here
 * checks permissions or namespaces: the services above do.
 */
export class TemporalReadRepository {
  constructor(private readonly temporal: TemporalService) {}

  async listExecutions(
    namespace: string,
    query: string,
    page: { pageSize: number; nextPageToken?: Uint8Array },
  ): Promise<TemporalPage<any>> {
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .listWorkflowExecutions({
        namespace,
        query,
        pageSize: page.pageSize,
        nextPageToken: page.nextPageToken,
      })
      .catch(mapTemporalError);
    return {
      items: (response.executions ?? []).map(toJson),
      nextPageToken: response.nextPageToken ?? undefined,
    };
  }

  async countExecutions(namespace: string, query: string): Promise<number> {
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .countWorkflowExecutions({ namespace, query })
      .catch(mapTemporalError);
    return Number(response.count ?? 0);
  }

  async describeExecution(ref: WorkflowRef): Promise<any> {
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .describeWorkflowExecution({
        namespace: ref.namespace,
        execution: { workflowId: ref.workflowId, runId: ref.runId },
      })
      .catch(mapTemporalError);
    return toJson(response);
  }

  /** The last event of a run's history. */
  async lastEvent(ref: WorkflowRef & { runId: string }): Promise<any> {
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .getWorkflowExecutionHistoryReverse({
        namespace: ref.namespace,
        execution: { workflowId: ref.workflowId, runId: ref.runId },
        maximumPageSize: 1,
      })
      .catch(mapTemporalError);
    return toJson(response.history?.events?.[0]);
  }

  /** One page of a run's history, oldest first. */
  async historyPage(
    ref: WorkflowRef & { runId: string },
    page: { pageSize: number; nextPageToken?: Uint8Array },
  ): Promise<TemporalPage<any>> {
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .getWorkflowExecutionHistory({
        namespace: ref.namespace,
        execution: { workflowId: ref.workflowId, runId: ref.runId },
        maximumPageSize: page.pageSize,
        nextPageToken: page.nextPageToken,
      })
      .catch(mapTemporalError);
    return {
      items: (response.history?.events ?? []).map(toJson),
      nextPageToken:
        response.nextPageToken && response.nextPageToken.length > 0
          ? response.nextPageToken
          : undefined,
    };
  }

  /**
   * Runs a query on a workflow, giving up after `timeoutMs`. Returns the
   * encoded result (protobuf JSON payloads), or `rejected` when the
   * workflow's state rejects queries.
   */
  async query(
    ref: WorkflowRef & { runId: string },
    queryType: string,
    timeoutMs: number,
  ): Promise<{ rejected: boolean; result?: any }> {
    const connection = await this.temporal.getConnection();
    const response: any = await connection.withDeadline(
      Date.now() + timeoutMs,
      () =>
        connection.workflowService.queryWorkflow({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          query: { queryType },
        }),
    );
    if (response.queryRejected) return { rejected: true };
    return { rejected: false, result: toJson(response.queryResult) };
  }
}
