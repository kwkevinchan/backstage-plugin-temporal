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
  BackstageCredentials,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import {
  InvalidTemporalAnnotationError,
  parseTemporalAnnotations,
  WorkflowDetail,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatus,
  WorkflowStepsResponse,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalService,
  TemporalWorkflowEnricher,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  ConvertOptions,
  decodePageToken,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  toWorkflowSteps,
  toWorkflowSummary,
} from './convert';
import {
  buildEntityWorkflowQuery,
  EntityWorkflowFilter,
  workflowBelongsToEntity,
} from './query';

export const LIST_PAGE_SIZE = { default: 20, max: 100 };
export const HISTORY_PAGE_SIZE = { default: 100, max: 500 };
/** Most history events read to build the steps of one run. */
export const MAX_STEP_EVENTS = 5000;

const CLOSED_WITH_FAILURE: WorkflowStatus[] = [
  'Failed',
  'TimedOut',
  'Terminated',
];

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

function mapTemporalError(error: unknown): never {
  const code = (error as { code?: unknown })?.code;
  const message = (error as Error)?.message ?? String(error);
  if (code === GRPC_NOT_FOUND) throw new NotFoundError(message);
  if (code === GRPC_INVALID_ARGUMENT) throw new InputError(message);
  if (code === GRPC_UNAVAILABLE) {
    throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
  }
  throw error;
}

function toJson(message: unknown): any {
  const m = message as { toJSON?: () => unknown } | undefined;
  return m && typeof m.toJSON === 'function' ? m.toJSON() : message;
}

export interface EntityContext {
  entity: Entity;
  entityRef: string;
  namespace: string;
  filter: EntityWorkflowFilter;
}

/** Reads workflows from Temporal for one entity. */
export class WorkflowReader {
  constructor(
    private readonly temporal: TemporalService,
    private readonly enrichers: TemporalWorkflowEnricher[],
    private readonly logger: LoggerService,
  ) {}

  /** Validates the entity's annotations and resolves its namespace. */
  entityContext(entity: Entity): EntityContext {
    let annotations;
    try {
      annotations = parseTemporalAnnotations(entity);
    } catch (error) {
      if (error instanceof InvalidTemporalAnnotationError) {
        throw new InputError(error.message);
      }
      throw error;
    }
    const namespace =
      annotations.namespace ?? this.temporal.getDefaultNamespace();
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    const entityRef = stringifyEntityRef(entity);
    return {
      entity,
      entityRef,
      namespace,
      filter: {
        annotations,
        entityRef,
        entityRefAttribute: this.temporal.getSearchAttributeNames().entityRef,
      },
    };
  }

  checkNamespace(namespace: string) {
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
  }

  private convertOptions(namespace: string): ConvertOptions {
    return {
      namespace,
      entityRefAttribute: this.temporal.getSearchAttributeNames().entityRef,
      webUiUrl: ref => this.temporal.getWebUiUrl(ref),
    };
  }

  private async enrich<T extends WorkflowSummary>(
    items: T[],
    context: EntityContext,
    credentials: BackstageCredentials,
  ): Promise<T[]> {
    let current = items;
    for (const enricher of this.enrichers) {
      try {
        const enriched = await enricher.enrich(current, {
          entity: context.entity,
          namespace: context.namespace,
          credentials,
        });
        current = current.map((item, i) => ({ ...item, ...enriched[i] }));
      } catch (error) {
        this.logger.warn(`Workflow enricher ${enricher.id} failed: ${error}`);
      }
    }
    return current;
  }

  async listEntityWorkflows(
    context: EntityContext,
    options: {
      status?: WorkflowStatus;
      pageSize: number;
      pageToken?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<WorkflowListResponse> {
    const query = buildEntityWorkflowQuery(context.filter, {
      status: options.status,
    });
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .listWorkflowExecutions({
        namespace: context.namespace,
        query,
        pageSize: options.pageSize,
        nextPageToken,
      })
      .catch(mapTemporalError);
    const convert = this.convertOptions(context.namespace);
    const items = (response.executions ?? []).map(e =>
      toWorkflowSummary(toJson(e), convert),
    );
    return {
      items: await this.enrich(items, context, options.credentials),
      nextPageToken: encodePageToken(response.nextPageToken),
      namespace: context.namespace,
    };
  }

  /** Describes a workflow without any entity check. */
  async describe(ref: WorkflowRef): Promise<WorkflowDetail> {
    this.checkNamespace(ref.namespace);
    const connection = await this.temporal.getConnection();
    const execution = { workflowId: ref.workflowId, runId: ref.runId };
    const describe = await connection.workflowService
      .describeWorkflowExecution({ namespace: ref.namespace, execution })
      .catch(mapTemporalError);
    const json = toJson(describe);
    const detail = toWorkflowDetail(json, this.convertOptions(ref.namespace));
    if (CLOSED_WITH_FAILURE.includes(detail.status)) {
      const reverse = await connection.workflowService
        .getWorkflowExecutionHistoryReverse({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: detail.runId },
          maximumPageSize: 1,
        })
        .catch(mapTemporalError);
      const closeEvent = toJson(reverse.history?.events?.[0]);
      return toWorkflowDetail(json, {
        ...this.convertOptions(ref.namespace),
        closeEvent,
      });
    }
    return detail;
  }

  /** Throws NotFoundError unless the workflow belongs to the entity. */
  assertBelongs(workflow: WorkflowSummary, context: EntityContext) {
    if (
      workflow.namespace !== context.namespace ||
      !workflowBelongsToEntity(workflow, context.filter)
    ) {
      throw new NotFoundError(
        `Workflow ${workflow.workflowId} does not belong to ${context.entityRef}`,
      );
    }
  }

  async enrichDetail(
    detail: WorkflowDetail,
    context: EntityContext,
    credentials: BackstageCredentials,
  ): Promise<WorkflowDetail> {
    const [enriched] = await this.enrich([detail], context, credentials);
    return enriched;
  }

  async history(
    ref: WorkflowRef & { runId: string },
    options: { pageSize: number; pageToken?: string },
  ): Promise<WorkflowHistoryResponse> {
    this.checkNamespace(ref.namespace);
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .getWorkflowExecutionHistory({
        namespace: ref.namespace,
        execution: { workflowId: ref.workflowId, runId: ref.runId },
        maximumPageSize: options.pageSize,
        nextPageToken,
      })
      .catch(mapTemporalError);
    return {
      events: (response.history?.events ?? []).map(e =>
        toHistoryEvent(toJson(e)),
      ),
      nextPageToken: encodePageToken(response.nextPageToken),
    };
  }

  /** Workflow input/result and activity inputs/results of one run. */
  async steps(
    ref: WorkflowRef & { runId: string },
  ): Promise<WorkflowStepsResponse> {
    this.checkNamespace(ref.namespace);
    const connection = await this.temporal.getConnection();
    const events: unknown[] = [];
    let nextPageToken: Uint8Array | undefined;
    do {
      const response = await connection.workflowService
        .getWorkflowExecutionHistory({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          maximumPageSize: HISTORY_PAGE_SIZE.max,
          nextPageToken,
        })
        .catch(mapTemporalError);
      for (const e of response.history?.events ?? []) events.push(toJson(e));
      nextPageToken =
        response.nextPageToken && response.nextPageToken.length > 0
          ? response.nextPageToken
          : undefined;
    } while (nextPageToken && events.length < MAX_STEP_EVENTS);
    return toWorkflowSteps(events, Boolean(nextPageToken));
  }
}
