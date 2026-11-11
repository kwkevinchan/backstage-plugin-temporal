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
  ConflictError,
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import type { WorkflowRef } from '@kwkevinchan/backstage-plugin-temporal-common';
import type { TemporalService } from '@kwkevinchan/backstage-plugin-temporal-node';

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_UNAUTHENTICATED = 16;
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

/**
 * The gRPC status code and message of a Temporal error. The raw service
 * calls throw the gRPC error itself; the client's higher-level APIs (the
 * schedule client) wrap it in a `ServiceError` with the gRPC error as
 * `cause`.
 */
export function grpcErrorOf(error: unknown): {
  code: unknown;
  message: string;
} {
  const message = (error as Error)?.message ?? String(error);
  const own = (error as { code?: unknown })?.code;
  if (own !== undefined) return { code: own, message };
  const cause = (error as { cause?: { code?: unknown; details?: unknown } })
    ?.cause;
  if (cause?.code === undefined) return { code: undefined, message };
  const details = typeof cause.details === 'string' ? cause.details : '';
  return {
    code: cause.code,
    message: details ? `${message}: ${details}` : message,
  };
}

/** The schedule client's error for a schedule that does not exist. */
export function isScheduleNotFound(error: unknown): boolean {
  return (error as Error)?.name === 'ScheduleNotFoundError';
}

/** Rethrows a Temporal (gRPC) error as the Backstage error of its HTTP status. */
export function mapTemporalError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (code === GRPC_NOT_FOUND || isScheduleNotFound(error)) {
    throw new NotFoundError(message);
  }
  if (code === GRPC_INVALID_ARGUMENT) throw new InputError(message);
  if (code === GRPC_UNAVAILABLE) {
    throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
  }
  if (code === GRPC_PERMISSION_DENIED || code === GRPC_UNAUTHENTICATED) {
    // The backend's own credentials, not the user's: a server-side problem.
    throw new ServiceUnavailableError(
      `Temporal refused the credentials of the backend: ${message}`,
    );
  }
  throw error;
}

/** Like {@link mapTemporalError}, with the errors of a query. */
function mapQueryError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (code === GRPC_FAILED_PRECONDITION) throw new ConflictError(message);
  if (code === GRPC_DEADLINE_EXCEEDED) {
    throw new ServiceUnavailableError(`No worker answered in time: ${message}`);
  }
  return mapTemporalError(error);
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
   * Runs a query on a workflow, with encoded `args`, giving up after
   * `timeoutMs` when given. Returns the encoded result (protobuf JSON
   * payloads), or `rejected` when the workflow's state rejects queries.
   */
  async query(
    ref: WorkflowRef & { runId: string },
    queryType: string,
    options: { args?: unknown; timeoutMs?: number } = {},
  ): Promise<{ rejected: boolean; result?: any }> {
    const connection = await this.temporal.getConnection();
    const call = () =>
      connection.workflowService.queryWorkflow({
        namespace: ref.namespace,
        execution: { workflowId: ref.workflowId, runId: ref.runId },
        query: { queryType, queryArgs: options.args as any },
      });
    const response: any = await (options.timeoutMs
      ? connection.withDeadline(Date.now() + options.timeoutMs, call)
      : call()
    ).catch(mapQueryError);
    if (response.queryRejected) return { rejected: true };
    return { rejected: false, result: toJson(response.queryResult) };
  }
}
