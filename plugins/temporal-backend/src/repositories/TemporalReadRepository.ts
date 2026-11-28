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
import { TEMPORAL_DEADLINES } from '../lib/deadlines';
import { callTemporal, QUERY_CALL } from './temporalCall';

/**
 * `HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT` on
 * `GetWorkflowExecutionHistory`. A running run returns no events.
 */
export const HISTORY_EVENT_FILTER_CLOSE = 2;

/** The protobuf JSON of a Temporal response message. */
function toJson(message: unknown): any {
  const m = message as { toJSON?: () => unknown } | undefined;
  return m && typeof m.toJSON === 'function' ? m.toJSON() : message;
}

/**
 * The value of a group of a grouped count: a payload whose data is the
 * JSON of a string, such as `"Running"`.
 */
function decodeGroupValue(
  payload: { data?: Uint8Array | null } | null | undefined,
): string | undefined {
  if (!payload?.data) return undefined;
  try {
    const value = JSON.parse(Buffer.from(payload.data).toString('utf8'));
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
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

  /**
   * Counts the runs of `visibilityQuery` by status, with
   * `GROUP BY ExecutionStatus` (Temporal 1.22 and later). A server that
   * cannot group answers `INVALID_ARGUMENT`, an `InputError` here.
   */
  async countExecutionsByStatus(
    namespace: string,
    visibilityQuery: string,
  ): Promise<Record<string, number>> {
    const response = await this.call(
      'countWorkflowExecutions',
      namespace,
      TEMPORAL_DEADLINES.list,
      service =>
        service.countWorkflowExecutions({
          namespace,
          query: `${visibilityQuery} GROUP BY ExecutionStatus`,
        }),
    );
    const counts: Record<string, number> = {};
    for (const group of response.groups ?? []) {
      const status = decodeGroupValue(group.groupValues?.[0]);
      if (status === undefined) continue;
      counts[status] = (counts[status] ?? 0) + Number(group.count ?? 0);
    }
    return counts;
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

  /**
   * The close event of a run, when it has closed. A running run has none.
   * One Temporal call, independent of history length.
   */
  async closeEvent(
    ref: WorkflowRef & { runId: string },
  ): Promise<any | undefined> {
    const response = await this.call(
      'getWorkflowExecutionHistory',
      ref.namespace,
      TEMPORAL_DEADLINES.read,
      service =>
        service.getWorkflowExecutionHistory({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          historyEventFilterType: HISTORY_EVENT_FILTER_CLOSE,
          maximumPageSize: 1,
        }),
    );
    const event = response.history?.events?.[0];
    return event === undefined ? undefined : toJson(event);
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
