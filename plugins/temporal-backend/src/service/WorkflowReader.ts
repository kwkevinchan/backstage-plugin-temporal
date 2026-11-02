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
  InvalidTemporalWorkflowSpecError,
  isTemporalWorkflowEntity,
  parseTemporalAnnotations,
  parseTemporalWorkflowSpec,
  TemporalAnnotations,
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRunChain,
  WorkflowHistoryResponse,
  WorkflowProgressResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatsResponse,
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
import { buildWorkflowGraph } from './graph';
import { ExternalPayloads, findClaimCheckPayloads } from './payloads';
import {
  buildEntityWorkflowQuery,
  buildNamespaceWorkflowQuery,
  EntityWorkflowFilter,
  NamespaceWorkflowFilter,
  matchingWorkflowEntity,
  RelatedWorkflowSource,
  workflowBelongsToEntity,
} from './query';

export const LIST_PAGE_SIZE = { default: 20, max: 100 };
/** Number of most recent runs the statistics are computed from. */
export const STATS_LIMIT = { default: 50, max: 100 };
export const HISTORY_PAGE_SIZE = { default: 100, max: 500 };
/** Most history events read to build the steps of one run. */
export const MAX_STEP_EVENTS = 5000;
/** Most history events read for the progress of one run in a list. */
export const MAX_PROGRESS_EVENTS = 1000;
/** Closed runs whose progress is kept in memory; closed runs do not change. */
export const PROGRESS_CACHE_SIZE = 1000;

/**
 * Reads the workflow filter of an entity: the spec of a `TemporalWorkflow`
 * entity, the annotations of any other entity.
 */
export function readEntityWorkflowFilter(entity: Entity): TemporalAnnotations {
  try {
    return isTemporalWorkflowEntity(entity)
      ? parseTemporalWorkflowSpec(entity)
      : parseTemporalAnnotations(entity);
  } catch (error) {
    if (
      error instanceof InvalidTemporalAnnotationError ||
      error instanceof InvalidTemporalWorkflowSpecError
    ) {
      throw new InputError(error.message);
    }
    throw error;
  }
}

const CLOSED_WITH_FAILURE: WorkflowStatus[] = [
  'Failed',
  'TimedOut',
  'Terminated',
];

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

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
    readonly payloads: ExternalPayloads = new ExternalPayloads(),
  ) {}

  /**
   * Validates the entity's annotations (or `TemporalWorkflow` spec) and
   * resolves its namespace. `relatedEntities` are the `TemporalWorkflow`
   * entities it depends on; the ones in another namespace or with an invalid
   * spec are left out.
   */
  entityContext(entity: Entity, relatedEntities: Entity[] = []): EntityContext {
    const annotations = readEntityWorkflowFilter(entity);
    const namespace =
      annotations.namespace ?? this.temporal.getDefaultNamespace();
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    const entityRef = stringifyEntityRef(entity);
    const related: RelatedWorkflowSource[] = [];
    for (const relatedEntity of relatedEntities) {
      const relatedRef = stringifyEntityRef(relatedEntity);
      if (
        !isTemporalWorkflowEntity(relatedEntity) ||
        relatedRef === entityRef
      ) {
        continue;
      }
      let spec;
      try {
        spec = parseTemporalWorkflowSpec(relatedEntity);
      } catch (error) {
        this.logger.warn(`Skipping ${relatedRef}: ${error}`);
        continue;
      }
      const relatedNamespace =
        spec.namespace ?? this.temporal.getDefaultNamespace();
      if (relatedNamespace !== namespace) {
        this.logger.debug(
          `Skipping ${relatedRef}: namespace ${relatedNamespace} differs from ${namespace}`,
        );
        continue;
      }
      related.push({
        entityRef: relatedRef,
        taskQueue: spec.taskQueue,
        workflowTypes: spec.workflowTypes,
      });
    }
    return {
      entity,
      entityRef,
      namespace,
      filter: {
        annotations,
        entityRef,
        entityRefAttribute: this.temporal.getSearchAttributeNames().entityRef,
        related,
      },
    };
  }

  defaultNamespace(): string {
    return this.temporal.getDefaultNamespace();
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
      /** False lists only the latest run of a workflow that continues as new. */
      allRuns?: boolean;
      pageSize: number;
      pageToken?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<WorkflowListResponse> {
    const query = buildEntityWorkflowQuery(context.filter, {
      status: options.status,
      allRuns: options.allRuns,
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
    const items = (response.executions ?? []).map(e => {
      const item = toWorkflowSummary(toJson(e), convert);
      const workflowEntityRef = matchingWorkflowEntity(item, context.filter);
      return workflowEntityRef ? { ...item, workflowEntityRef } : item;
    });
    return {
      items: await this.enrich(items, context, options.credentials),
      nextPageToken: encodePageToken(response.nextPageToken),
      namespace: context.namespace,
    };
  }

  /**
   * Every workflow of a namespace, newest first, with optional filters.
   * Enrichers do not run here: they need an entity.
   */
  async listNamespaceWorkflows(
    namespace: string,
    filter: NamespaceWorkflowFilter,
    options: { pageSize: number; pageToken?: string },
  ): Promise<WorkflowListResponse> {
    this.checkNamespace(namespace);
    const query = buildNamespaceWorkflowQuery(filter);
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .listWorkflowExecutions({
        namespace,
        query,
        pageSize: options.pageSize,
        nextPageToken,
      })
      .catch(mapTemporalError);
    const convert = this.convertOptions(namespace);
    return {
      items: (response.executions ?? []).map(e =>
        toWorkflowSummary(toJson(e), convert),
      ),
      nextPageToken: encodePageToken(response.nextPageToken),
      namespace,
    };
  }

  /** Counts and mean duration of the entity's most recent runs. */
  async stats(
    context: EntityContext,
    options: { limit: number },
  ): Promise<WorkflowStatsResponse> {
    const query = buildEntityWorkflowQuery(context.filter);
    const connection = await this.temporal.getConnection();
    const response = await connection.workflowService
      .listWorkflowExecutions({
        namespace: context.namespace,
        query,
        pageSize: options.limit,
      })
      .catch(mapTemporalError);
    const convert = this.convertOptions(context.namespace);
    const items = (response.executions ?? [])
      .slice(0, options.limit)
      .map(e => toWorkflowSummary(toJson(e), convert));
    const byStatus: Partial<Record<WorkflowStatus, number>> = {};
    let durationSum = 0;
    let durationCount = 0;
    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      if (item.startTime && item.closeTime) {
        const ms = Date.parse(item.closeTime) - Date.parse(item.startTime);
        if (Number.isFinite(ms) && ms >= 0) {
          durationSum += ms;
          durationCount += 1;
        }
      }
    }
    const count = (...statuses: WorkflowStatus[]) =>
      statuses.reduce((sum, st) => sum + (byStatus[st] ?? 0), 0);
    return {
      namespace: context.namespace,
      sampleSize: items.length,
      limit: options.limit,
      byStatus,
      succeeded: count('Completed'),
      failed: count(...CLOSED_WITH_FAILURE),
      running: count('Running'),
      averageDurationMs:
        durationCount > 0 ? Math.round(durationSum / durationCount) : undefined,
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
    await this.payloads.resolve(json.workflowExecutionInfo?.memo);
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
    const events = (response.history?.events ?? []).map(toJson);
    await this.payloads.resolve(events);
    return {
      events: events.map(toHistoryEvent),
      nextPageToken: encodePageToken(response.nextPageToken),
    };
  }

  /**
   * Reads the history of one run, oldest first, up to `max` events. With
   * `payloads`, claim checks are resolved for display.
   */
  private async readEvents(
    ref: WorkflowRef & { runId: string },
    max: number,
    options: { payloads?: boolean } = {},
  ): Promise<{ events: unknown[]; truncated: boolean }> {
    this.checkNamespace(ref.namespace);
    const connection = await this.temporal.getConnection();
    const events: unknown[] = [];
    let nextPageToken: Uint8Array | undefined;
    do {
      const response = await connection.workflowService
        .getWorkflowExecutionHistory({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          maximumPageSize: Math.min(HISTORY_PAGE_SIZE.max, max),
          nextPageToken,
        })
        .catch(mapTemporalError);
      for (const e of response.history?.events ?? []) events.push(toJson(e));
      nextPageToken =
        response.nextPageToken && response.nextPageToken.length > 0
          ? response.nextPageToken
          : undefined;
    } while (nextPageToken && events.length < max);
    if (options.payloads) await this.payloads.resolve(events);
    return { events, truncated: Boolean(nextPageToken) };
  }

  /** Workflow input/result and activity inputs/results of one run. */
  async steps(
    ref: WorkflowRef & { runId: string },
  ): Promise<WorkflowStepsResponse> {
    const { events, truncated } = await this.readEvents(ref, MAX_STEP_EVENTS, {
      payloads: true,
    });
    return toWorkflowSteps(events, truncated);
  }

  /**
   * The claim check with `key` in the history of one run (inputs, results,
   * memo, failure details), or undefined. Downloads are limited to these,
   * so a caller can only read data of runs it may read the history of.
   */
  async findClaimCheck(ref: WorkflowRef & { runId: string }, key: string) {
    const { events } = await this.readEvents(ref, MAX_STEP_EVENTS);
    return findClaimCheckPayloads(events).find(f => f.check.key === key)?.check;
  }

  /**
   * Steps and arrows of one run, from its history and the pending
   * activities of `workflow`. Without `includePayloads`, inputs and results
   * are left out.
   */
  async graph(
    workflow: WorkflowDetail,
    options: { includePayloads: boolean; maxEvents?: number },
  ): Promise<WorkflowGraphResponse> {
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    const { events, truncated } = await this.readEvents(
      ref,
      options.maxEvents ?? MAX_STEP_EVENTS,
      { payloads: options.includePayloads },
    );
    return buildWorkflowGraph(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated,
      pendingActivities: workflow.pendingActivities,
      searchAttributes: workflow.searchAttributes,
      includePayloads: options.includePayloads,
      failure: workflow.failure,
    });
  }

  /**
   * Adds the position of the run among the runs of its workflow ID (runs
   * that started before it, and all runs) to the links of `chain`. When
   * counting fails, the links are returned as they are.
   */
  async runPosition(
    workflow: WorkflowDetail,
    chain: WorkflowRunChain,
  ): Promise<WorkflowRunChain> {
    const start = workflow.startTime ? Date.parse(workflow.startTime) : NaN;
    // Workflow IDs are free text; IDs that need escaping are not counted.
    if (Number.isNaN(start) || /['"\\]/.test(workflow.workflowId)) {
      return chain;
    }
    const byId = `WorkflowId = '${workflow.workflowId}'`;
    // The start time of describe is cut to milliseconds.
    const until = new Date(start + 1).toISOString();
    try {
      const connection = await this.temporal.getConnection();
      const count = async (query: string) => {
        const response = await connection.workflowService
          .countWorkflowExecutions({ namespace: workflow.namespace, query })
          .catch(mapTemporalError);
        return Number(response.count ?? 0);
      };
      const [index, total] = await Promise.all([
        count(`${byId} AND StartTime < '${until}'`),
        count(byId),
      ]);
      return index > 0 && total >= index ? { ...chain, index, total } : chain;
    } catch (error) {
      this.logger.debug(`Could not count the runs of a workflow: ${error}`);
      return chain;
    }
  }

  private readonly progressCache = new Map<string, WorkflowProgressResponse>();

  /**
   * Completed steps and the current step of one run, for lists. The
   * progress of closed runs is cached, since their history does not change.
   */
  async progress(workflow: WorkflowDetail): Promise<WorkflowProgressResponse> {
    const key = `${workflow.namespace}/${workflow.workflowId}/${workflow.runId}`;
    const cached = this.progressCache.get(key);
    if (cached) return cached;
    const graph = await this.graph(workflow, {
      includePayloads: false,
      maxEvents: MAX_PROGRESS_EVENTS,
    });
    const progress: WorkflowProgressResponse = {
      status: graph.status,
      completedSteps: graph.completedSteps,
      totalSteps: graph.totalSteps,
      truncated: graph.truncated,
    };
    if (graph.current) progress.current = graph.current;
    if (graph.currentDeadline) progress.currentDeadline = graph.currentDeadline;
    if (workflow.status !== 'Running') {
      if (this.progressCache.size >= PROGRESS_CACHE_SIZE) {
        const oldest = this.progressCache.keys().next().value;
        if (oldest !== undefined) this.progressCache.delete(oldest);
      }
      this.progressCache.set(key, progress);
    }
    return progress;
  }
}
