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

import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Connection } from '@temporalio/client';
import type { WorkflowRef } from '../common';
import type { TemporalService } from '../node';
import { mapQueryError, mapTemporalError } from './errors';
import { callTemporal, QUERY_CALL, TEMPORAL_DEADLINES } from './temporalCall';

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
  constructor(
    private readonly temporal: TemporalService,
    private readonly logger: LoggerService,
  ) {}

  /** A read call to the workflow service, with the errors of reads. */
  private call<T>(
    temporalCall: string,
    namespace: string,
    timeoutMs: number,
    fn: (service: Connection['workflowService']) => Promise<T>,
  ): Promise<T> {
    return callTemporal(
      this.temporal,
      {
        timeoutMs,
        mapError: mapTemporalError,
        temporalCall,
        namespace,
        logger: this.logger,
      },
      c => fn(c.workflowService),
    );
  }

  async listExecutions(
    namespace: string,
    visibilityQuery: string,
    page: { pageSize: number; nextPageToken?: Uint8Array },
  ): Promise<TemporalPage<any>> {
    const response = await this.call(
      'listWorkflowExecutions',
      namespace,
      TEMPORAL_DEADLINES.list,
      service =>
        service.listWorkflowExecutions({
          namespace,
          query: visibilityQuery,
          pageSize: page.pageSize,
          nextPageToken: page.nextPageToken,
        }),
    );
    return {
      items: (response.executions ?? []).map(toJson),
      nextPageToken: response.nextPageToken ?? undefined,
    };
  }

  async countExecutions(
    namespace: string,
    visibilityQuery: string,
  ): Promise<number> {
    const response = await this.call(
      'countWorkflowExecutions',
      namespace,
      TEMPORAL_DEADLINES.list,
      service =>
        service.countWorkflowExecutions({ namespace, query: visibilityQuery }),
    );
    return Number(response.count ?? 0);
  }

  async describeExecution(ref: WorkflowRef): Promise<any> {
    const response = await this.call(
      'describeWorkflowExecution',
      ref.namespace,
      TEMPORAL_DEADLINES.read,
      service =>
        service.describeWorkflowExecution({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
        }),
    );
    return toJson(response);
  }

  /** The last event of a run's history. */
  async lastEvent(ref: WorkflowRef & { runId: string }): Promise<any> {
    const response = await this.call(
      'getWorkflowExecutionHistoryReverse',
      ref.namespace,
      TEMPORAL_DEADLINES.read,
      service =>
        service.getWorkflowExecutionHistoryReverse({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          maximumPageSize: 1,
        }),
    );
    return toJson(response.history?.events?.[0]);
  }

  /** One page of a run's history, oldest first. */
  async historyPage(
    ref: WorkflowRef & { runId: string },
    page: { pageSize: number; nextPageToken?: Uint8Array },
  ): Promise<TemporalPage<any>> {
    const response = await this.call(
      'getWorkflowExecutionHistory',
      ref.namespace,
      TEMPORAL_DEADLINES.read,
      service =>
        service.getWorkflowExecutionHistory({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          maximumPageSize: page.pageSize,
          nextPageToken: page.nextPageToken,
        }),
    );
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
   * `timeoutMs` (by default, the deadline of a query). Returns the encoded
   * result (protobuf JSON payloads), or `rejected` when the workflow's state
   * rejects queries.
   */
  async query(
    ref: WorkflowRef & { runId: string },
    queryType: string,
    options: { args?: unknown; timeoutMs?: number } = {},
  ): Promise<{ rejected: boolean; result?: any }> {
    const response: any = await callTemporal(
      this.temporal,
      {
        timeoutMs: options.timeoutMs ?? TEMPORAL_DEADLINES.query,
        mapError: mapQueryError,
        temporalCall: QUERY_CALL,
        namespace: ref.namespace,
        logger: this.logger,
      },
      connection =>
        connection.workflowService.queryWorkflow({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          query: { queryType, queryArgs: options.args as any },
        }),
    );
    if (response.queryRejected) return { rejected: true };
    return { rejected: false, result: toJson(response.queryResult) };
  }
}
