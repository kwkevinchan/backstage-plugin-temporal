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
import { ConflictError, InputError, NotFoundError } from '@backstage/errors';
import {
  InvalidTemporalAnnotationError,
  InvalidTemporalWorkflowSpecError,
  isTemporalWorkflowEntity,
  getTemporalWorkflowSource,
  parseTemporalWorkflowSpec,
  TemporalAnnotations,
  WorkflowDetail,
  LOOP_STATE_QUERY,
  WorkflowGraphResponse,
  WorkflowLoopGroup,
  WorkflowLoopRun,
  WorkflowLoopsResponse,
  WorkflowRunChain,
  WorkflowHistoryResponse,
  WorkflowProgressResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowStepsResponse,
  WorkflowSummary,
  ExternalPayload,
  parseLlmMarker,
  WorkflowLlmCallResponse,
  WorkflowHandler,
  WorkflowHandlersResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type { JsonObject, JsonValue } from '@backstage/types';
import { TemporalService } from '@kwkevinchan/backstage-plugin-temporal-node';
import { TemporalWorkflowEnricher } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  decodeJsonPayloads,
  encodeJsonPayloads,
  type TemporalEntityContext,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import {
  ConvertOptions,
  decodePayloads,
  decodePageToken,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  toWorkflowSteps,
  toWorkflowSummary,
} from './convert';
import { buildWorkflowGraph } from './graph';
import { llmRecordOf, normalizeLlmRecord } from './llm';
import { readLoopState } from './loops';
import {
  findReferencePayloads,
  PayloadStore,
} from '../repositories/PayloadStore';
import { TemporalReadRepository } from '../repositories/TemporalReadRepository';
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
/** Most continue-as-new runs read for the loops of a workflow. */
export const MAX_LOOP_RUNS = 20;
/** Time the loop state query may take; a workflow without a worker never answers. */
export const LOOP_QUERY_TIMEOUT_MS = 3000;
/** Query of the Temporal SDKs that lists a workflow's handlers. */
export const METADATA_QUERY = '__temporal_workflow_metadata';
/** Time the metadata query may take. */
export const METADATA_QUERY_TIMEOUT_MS = 5000;

/** Handler definitions of the metadata query, without the SDKs' own (`__`). */
function handlerList(definitions: unknown): WorkflowHandler[] {
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap(d => {
    const name = (d as { name?: unknown })?.name;
    if (typeof name !== 'string' || !name || name.startsWith('__')) return [];
    const description = (d as { description?: unknown })?.description;
    return typeof description === 'string' && description
      ? [{ name, description }]
      : [{ name }];
  });
}

/** How many parents up a child workflow is looked for in an entity. */
export const MAX_PARENT_DEPTH = 3;

/** Closed runs whose progress is kept in memory; closed runs do not change. */
export const PROGRESS_CACHE_SIZE = 1000;

/**
 * Reads the workflow filter of an entity: the spec of a `TemporalWorkflow`
 * entity, the annotations of any other entity.
 */
export function readEntityWorkflowFilter(entity: Entity): TemporalAnnotations {
  try {
    return getTemporalWorkflowSource(entity);
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

/** Largest record of a model call read from S3 (8 MiB). */
export const MAX_LLM_RECORD_BYTES = 8 * 1024 * 1024;

/**
 * Payloads with the results (and failure details) of model calls in a
 * history, for reading their records from S3 without the other payloads.
 */
export function llmResultPayloads(events: unknown[]): unknown[] {
  const calls = new Set<string>();
  const roots: unknown[] = [];
  for (const event of events as any[]) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled && parseLlmMarker(scheduled.activityId)?.kind === 'llm') {
      calls.add(String(event.eventId));
      continue;
    }
    const completed = event.activityTaskCompletedEventAttributes;
    if (completed && calls.has(String(completed.scheduledEventId))) {
      roots.push(completed.result);
    }
    const failed = event.activityTaskFailedEventAttributes;
    if (failed && calls.has(String(failed.scheduledEventId))) {
      roots.push(failed.failure);
    }
  }
  return roots;
}

/** Why a record stored in S3 is not shown. */
function externalReason(external: ExternalPayload): string {
  if (external.state === 'unconfigured') {
    return 'The record is stored in S3, and the backend has no S3 configuration.';
  }
  if (external.state === 'error') {
    return `The record stored in S3 could not be read: ${
      external.error ?? ''
    }`.trim();
  }
  return 'The record stored in S3 is larger than the backend reads.';
}

/** The LLM record in a result or failure (protobuf JSON, resolved). */
function findLlmRecord(root: any): {
  record?: JsonObject;
  external?: ExternalPayload;
  reason?: string;
} {
  const candidates: unknown[] = [];
  if (root?.payloads) candidates.push(decodePayloads(root));
  for (let f = root, depth = 0; f && depth < 5; f = f.cause, depth++) {
    const details = decodePayloads(f.applicationFailureInfo?.details);
    if (Array.isArray(details)) candidates.push(...details);
    else if (details !== undefined) candidates.push(details);
  }
  let external: ExternalPayload | undefined;
  for (const c of candidates) {
    const decoded = c as any;
    if (decoded?.external) external = decoded.external;
    const record = llmRecordOf(decoded?.value);
    if (record) return { record, external };
  }
  if (external && external.state !== 'inline') {
    return { external, reason: externalReason(external) };
  }
  if (candidates.some(c => (c as any)?.undecodable)) {
    return {
      reason:
        'The result is encoded by a payload codec (for example encryption); the backend cannot read it.',
    };
  }
  return { reason: 'The result has no LLM record (`temporal.llm`).' };
}

/**
 * The read use cases of the plugin: lists, details, history, steps, graph,
 * loops, model calls and progress of workflows. Callers check permissions
 * first (see `access/`); this class checks that namespaces are allowed and
 * reads Temporal through {@link TemporalReadRepository}.
 */
export class WorkflowQueries {
  private readonly temporalReads: TemporalReadRepository;

  constructor(
    private readonly temporal: TemporalService,
    private readonly enrichers: TemporalWorkflowEnricher[],
    private readonly logger: LoggerService,
    readonly payloads: PayloadStore = new PayloadStore(),
    temporalReads?: TemporalReadRepository,
  ) {
    this.temporalReads = temporalReads ?? new TemporalReadRepository(temporal);
  }

  /**
   * Validates the entity's annotations (or `TemporalWorkflow` spec) and
   * resolves its namespace. `relatedEntities` are the `TemporalWorkflow`
   * entities it depends on that the caller may see.
   */
  entityContext(
    entity: Entity,
    relatedEntities: Entity[] = [],
  ): TemporalEntityContext {
    const annotations = readEntityWorkflowFilter(entity);
    const namespace =
      annotations.namespace ?? this.temporal.getDefaultNamespace();
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    return {
      entity,
      entityRef: stringifyEntityRef(entity),
      namespace,
      relatedWorkflowEntities: relatedEntities,
    };
  }

  private readonly filters = new WeakMap<
    TemporalEntityContext,
    EntityWorkflowFilter
  >();

  /**
   * The search filter of an entity's workflows: its annotations (or spec),
   * and the related `TemporalWorkflow` entities in the same namespace. The
   * ones in another namespace or with an invalid spec are left out.
   */
  filterOf(context: TemporalEntityContext): EntityWorkflowFilter {
    const cached = this.filters.get(context);
    if (cached) return cached;
    const { entity, entityRef, namespace } = context;
    const related: RelatedWorkflowSource[] = [];
    for (const relatedEntity of context.relatedWorkflowEntities) {
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
    const filter: EntityWorkflowFilter = {
      annotations: readEntityWorkflowFilter(entity),
      entityRef,
      entityRefAttribute: this.temporal.getSearchAttributeNames().entityRef,
      related,
    };
    this.filters.set(context, filter);
    return filter;
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
    const attributes = this.temporal.getSearchAttributeNames();
    return {
      namespace,
      entityRefAttribute: attributes.entityRef,
      initiatorAttribute: attributes.initiator,
      webUiUrl: ref => this.temporal.getWebUiUrl(ref),
    };
  }

  private async enrich<T extends WorkflowSummary>(
    items: T[],
    context: TemporalEntityContext,
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
    context: TemporalEntityContext,
    options: {
      status?: WorkflowStatus;
      /** False lists only the latest run of a workflow that continues as new. */
      allRuns?: boolean;
      pageSize: number;
      pageToken?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<WorkflowListResponse> {
    const query = buildEntityWorkflowQuery(this.filterOf(context), {
      status: options.status,
      allRuns: options.allRuns,
    });
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const response = await this.temporalReads.listExecutions(
      context.namespace,
      query,
      { pageSize: options.pageSize, nextPageToken },
    );
    const convert = this.convertOptions(context.namespace);
    const items = response.items.map(e => {
      const item = toWorkflowSummary(e, convert);
      const workflowEntityRef = matchingWorkflowEntity(
        item,
        this.filterOf(context),
      );
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
    const response = await this.temporalReads.listExecutions(namespace, query, {
      pageSize: options.pageSize,
      nextPageToken,
    });
    const convert = this.convertOptions(namespace);
    return {
      items: response.items.map(e => toWorkflowSummary(e, convert)),
      nextPageToken: encodePageToken(response.nextPageToken),
      namespace,
    };
  }

  /** Counts and mean duration of the entity's most recent runs. */
  async stats(
    context: TemporalEntityContext,
    options: { limit: number },
  ): Promise<WorkflowStatsResponse> {
    const query = buildEntityWorkflowQuery(this.filterOf(context));
    const response = await this.temporalReads.listExecutions(
      context.namespace,
      query,
      { pageSize: options.limit },
    );
    const convert = this.convertOptions(context.namespace);
    const items = response.items
      .slice(0, options.limit)
      .map(e => toWorkflowSummary(e, convert));
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

  /**
   * Describes a run without any entity check. The memo is resolved from External Storage only when
   * this instance has a configured `PayloadStore` (the plugin's does; the
   * access service's does not).
   */
  async describe(ref: WorkflowRef): Promise<WorkflowDetail> {
    this.checkNamespace(ref.namespace);
    const json = await this.temporalReads.describeExecution(ref);
    await this.payloads.resolve(json.workflowExecutionInfo?.memo);
    const detail = toWorkflowDetail(json, this.convertOptions(ref.namespace));
    if (CLOSED_WITH_FAILURE.includes(detail.status)) {
      const closeEvent = await this.temporalReads.lastEvent({
        ...ref,
        runId: detail.runId,
      });
      return toWorkflowDetail(json, {
        ...this.convertOptions(ref.namespace),
        closeEvent,
      });
    }
    return detail;
  }

  /**
   * Checks that a workflow is one of the entity's, or a child workflow (up
   * to MAX_PARENT_DEPTH levels) of one of them: a child is part of its
   * parent's work, so it is opened, and operated, with the parent's entity
   * and its permissions. Throws NotFoundError otherwise.
   */
  async assertBelongs(
    workflow: WorkflowDetail,
    context: TemporalEntityContext,
  ): Promise<void> {
    const filter = this.filterOf(context);
    let current: WorkflowDetail = workflow;
    for (let depth = 0; ; depth += 1) {
      if (
        current.namespace === context.namespace &&
        workflowBelongsToEntity(current, filter)
      ) {
        return;
      }
      // A parent without a run ID could be another workflow with the same
      // ID (another namespace, a later run): the walk stops there.
      if (
        !current.parent?.workflowId ||
        !current.parent.runId ||
        depth >= MAX_PARENT_DEPTH
      ) {
        throw new NotFoundError(
          `Workflow ${workflow.workflowId} does not belong to ${context.entityRef}`,
        );
      }
      // Child workflows run in the namespace of their parent here; the
      // parent's namespace in describe is an ID, not a name. Only what
      // membership needs is read: no memo from S3, no close event.
      const ref = {
        namespace: workflow.namespace,
        workflowId: current.parent.workflowId,
        runId: current.parent.runId,
      };
      this.checkNamespace(ref.namespace);
      current = toWorkflowDetail(
        await this.temporalReads.describeExecution(ref),
        this.convertOptions(ref.namespace),
      );
    }
  }

  async enrichDetail(
    detail: WorkflowDetail,
    context: TemporalEntityContext,
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
    const response = await this.temporalReads.historyPage(ref, {
      pageSize: options.pageSize,
      nextPageToken,
    });
    const events = response.items;
    await this.payloads.resolve(events);
    return {
      events: events.map(toHistoryEvent),
      nextPageToken: encodePageToken(response.nextPageToken),
    };
  }

  /**
   * Reads the history of one run, oldest first, up to `max` events. With
   * `payloads`, payloads in External Storage are resolved for display.
   */
  private async readEvents(
    ref: WorkflowRef & { runId: string },
    max: number,
    options: { payloads?: boolean; llmPayloads?: boolean } = {},
  ): Promise<{ events: unknown[]; truncated: boolean }> {
    this.checkNamespace(ref.namespace);
    const events: unknown[] = [];
    let nextPageToken: Uint8Array | undefined;
    do {
      const response = await this.temporalReads.historyPage(ref, {
        pageSize: Math.min(HISTORY_PAGE_SIZE.max, max),
        nextPageToken,
      });
      events.push(...response.items);
      nextPageToken = response.nextPageToken;
    } while (nextPageToken && events.length < max);
    if (options.payloads) await this.payloads.resolve(events);
    else if (options.llmPayloads) {
      await this.payloads.resolve(llmResultPayloads(events));
    }
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
   * The storage reference with `key` in the history of one run (inputs,
   * results, memo, failure details), or undefined. Downloads are limited to
   * these, so a caller can only read data of runs it may read the history
   * of.
   */
  async findStorageReference(
    ref: WorkflowRef & { runId: string },
    key: string,
  ) {
    const { events } = await this.readEvents(ref, MAX_STEP_EVENTS);
    return findReferencePayloads(events).find(f => f.reference.key === key)
      ?.reference;
  }

  /**
   * Steps and arrows of one run, from its history and the pending
   * activities of `workflow`. Without `includePayloads`, inputs and results
   * are left out.
   */
  async graph(
    workflow: WorkflowDetail,
    options: {
      includePayloads: boolean;
      maxEvents?: number;
      /**
       * False skips reading the records of model calls stored in S3, for
       * lists. Their summaries then say `unreadable`.
       */
      llm?: boolean;
    },
  ): Promise<WorkflowGraphResponse> {
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    const { events, truncated } = await this.readEvents(
      ref,
      options.maxEvents ?? MAX_STEP_EVENTS,
      {
        payloads: options.includePayloads,
        llmPayloads: options.llm !== false,
      },
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
      memo: workflow.memo,
    });
  }

  /**
   * Loops of a workflow across the runs it continued as new: the rounds of
   * each run from its history, and for a running workflow the state from
   * the `__loop_state` query when its worker answers.
   */
  async loops(workflow: WorkflowDetail): Promise<WorkflowLoopsResponse> {
    type Read = { detail: WorkflowDetail; graph: WorkflowGraphResponse };
    const read = async (detail: WorkflowDetail): Promise<Read> => ({
      detail,
      graph: await this.graph(detail, { includePayloads: false }),
    });
    const describeRun = (runId: string) =>
      this.describe({
        namespace: workflow.namespace,
        workflowId: workflow.workflowId,
        runId,
      });
    const current = await read(workflow);
    const runs: Read[] = [current];
    let truncated = current.graph.truncated;
    // Earlier runs, then later ones.
    let previous = current.graph.runChain?.previousRunId;
    while (previous && runs.length < MAX_LOOP_RUNS) {
      const run = await read(await describeRun(previous));
      runs.unshift(run);
      truncated ||= run.graph.truncated;
      previous = run.graph.runChain?.previousRunId;
    }
    let next = current.graph.runChain?.nextRunId;
    while (next && runs.length < MAX_LOOP_RUNS) {
      const run = await read(await describeRun(next));
      runs.push(run);
      truncated ||= run.graph.truncated;
      next = run.graph.runChain?.nextRunId;
    }
    if (previous || next) truncated = true;

    const loops: WorkflowLoopGroup[] = [];
    runs.forEach(({ detail, graph }, i) => {
      for (const group of graph.loops ?? []) {
        let loop = loops.find(l => l.name === group.name);
        if (!loop) {
          loop = { ...group, rounds: [] };
          loops.push(loop);
        }
        const { rounds, ...summary } = group;
        Object.assign(loop, summary);
        for (const round of rounds) {
          loop.rounds = loop.rounds.filter(
            r => r.iteration !== round.iteration,
          );
          loop.rounds.push({ ...round, runId: detail.runId, segment: i + 1 });
        }
        loop.rounds.sort((a, b) => a.iteration - b.iteration);
      }
    });

    let source: WorkflowLoopsResponse['source'] = 'history';
    const last = runs[runs.length - 1];
    if (last.detail.status === 'Running') {
      const state = readLoopState(await this.queryLoopState(last.detail));
      if (state) {
        source = 'query';
        const segment = runs.length;
        for (const entry of state.loops) {
          let loop = loops.find(l => l.name === entry.name);
          if (!loop) {
            loop = {
              name: entry.name,
              status: 'running',
              iteration: 0,
              rounds: [],
            };
            loops.push(loop);
          }
          if (entry.status) loop.status = entry.status;
          if (entry.iteration !== undefined) loop.iteration = entry.iteration;
          if (entry.maxIterations) loop.maxIterations = entry.maxIterations;
          if (entry.decision !== undefined) loop.decision = entry.decision;
          if (entry.score !== undefined) loop.score = entry.score;
          for (const r of entry.rounds ?? []) {
            let round = loop.rounds.find(x => x.iteration === r.iteration);
            if (!round) {
              // Started, but no step scheduled yet.
              round = {
                iteration: r.iteration,
                status: 'Running',
                steps: [],
                startTime: r.startTime,
                runId: last.detail.runId,
                segment,
              };
              loop.rounds.push(round);
            }
            if (r.decision !== undefined) round.decision = r.decision;
            if (r.score !== undefined) round.score = r.score;
            if (r.status === 'running' && round.status === 'Completed') {
              round.status = 'Running';
              delete round.endTime;
            }
            if (r.status === 'failed') round.status = 'Failed';
          }
          loop.rounds.sort((a, b) => a.iteration - b.iteration);
        }
      }
    }

    const runList: WorkflowLoopRun[] = runs.map(({ detail }, i) => {
      const run: WorkflowLoopRun = {
        runId: detail.runId,
        segment: i + 1,
        status: detail.status,
      };
      if (detail.startTime) run.startTime = detail.startTime;
      return run;
    });
    return { loops, runs: runList, source, truncated };
  }

  /**
   * The answer of the `__loop_state` query, or undefined when the workflow
   * has no such query, no worker answers in time or the answer cannot be
   * decoded.
   */
  private async queryLoopState(workflow: WorkflowDetail): Promise<unknown> {
    try {
      const response = await this.temporalReads.query(
        workflow,
        LOOP_STATE_QUERY,
        { timeoutMs: LOOP_QUERY_TIMEOUT_MS },
      );
      if (response.rejected) return undefined;
      const decoded = decodePayloads(response.result);
      const value =
        decoded && typeof decoded === 'object' && 'value' in decoded
          ? (decoded as { value: unknown }).value
          : undefined;
      return value;
    } catch (error) {
      this.logger.debug(`Loop state query failed: ${error}`);
      return undefined;
    }
  }

  /**
   * The full record of one model call (activity ID `llm/...`) of a run,
   * by the event ID of its `ActivityTaskScheduled` event. A record stored
   * in S3 is downloaded and verified, up to {@link MAX_LLM_RECORD_BYTES}.
   */
  async llmCall(
    workflow: WorkflowDetail,
    scheduledEventId: string,
  ): Promise<WorkflowLlmCallResponse> {
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    const { events } = await this.readEvents(ref, MAX_STEP_EVENTS);
    const graph = buildWorkflowGraph(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated: false,
      pendingActivities: workflow.pendingActivities,
      includePayloads: false,
    });
    const nodeId = `activity-${scheduledEventId}`;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node?.llm) {
      throw new NotFoundError(`No model call ${scheduledEventId} in this run`);
    }
    // The result, else the failure details of the last failed attempt.
    let root: unknown;
    let fromFailure = false;
    for (const event of events as any[]) {
      const completed = event.activityTaskCompletedEventAttributes;
      if (
        completed &&
        String(completed.scheduledEventId) === scheduledEventId
      ) {
        root = completed.result;
        fromFailure = false;
      }
      for (const key of [
        'activityTaskFailedEventAttributes',
        'activityTaskTimedOutEventAttributes',
      ]) {
        const closed = event[key];
        if (closed && String(closed.scheduledEventId) === scheduledEventId) {
          root = closed.failure;
          fromFailure = true;
        }
      }
      const started = event.activityTaskStartedEventAttributes;
      if (
        started &&
        String(started.scheduledEventId) === scheduledEventId &&
        started.lastFailure &&
        root === undefined
      ) {
        root = started.lastFailure;
        fromFailure = true;
      }
    }
    const response: WorkflowLlmCallResponse = {
      nodeId,
      activityId: node.stepId ?? '',
      activityType: node.name,
      call: node.llm.call,
      status: node.status,
    };
    if (root === undefined) {
      response.unavailable =
        node.llm.record === 'pending'
          ? 'The model call has not ended yet.'
          : 'The model call has no result.';
      return response;
    }
    await this.payloads.resolve(root, { maxInlineBytes: MAX_LLM_RECORD_BYTES });
    const found = findLlmRecord(root);
    if (found.external) response.external = found.external;
    if (!found.record) {
      response.unavailable = found.reason;
      return response;
    }
    response.raw = found.record;
    response.record = normalizeLlmRecord(found.record);
    if (fromFailure) response.fromFailure = true;
    return response;
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
      const count = (query: string) =>
        this.temporalReads.countExecutions(workflow.namespace, query);
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

  /**
   * Runs a query chosen by the user on one run and decodes its result.
   * Throws ConflictError when the workflow rejects it.
   */
  async query(
    workflow: WorkflowDetail,
    name: string,
    args: JsonValue[] | undefined,
  ): Promise<JsonValue | undefined> {
    const response = await this.temporalReads.query(workflow, name, {
      args: encodeJsonPayloads(args),
    });
    if (response.rejected) {
      throw new ConflictError('The workflow rejected the query');
    }
    return decodeJsonPayloads(response.result);
  }

  /**
   * The signals, updates and queries a workflow defines, from the metadata
   * query of the Temporal SDKs. Closed runs answer too while a worker of
   * their task queue runs (the Query dialog needs the query names). Empty
   * lists when no worker answers in time or the workflow does not answer it.
   */
  async handlers(workflow: WorkflowDetail): Promise<WorkflowHandlersResponse> {
    const empty: WorkflowHandlersResponse = {
      signals: [],
      updates: [],
      queries: [],
    };
    try {
      const response = await this.temporalReads.query(
        workflow,
        METADATA_QUERY,
        { timeoutMs: METADATA_QUERY_TIMEOUT_MS },
      );
      if (response.rejected) return empty;
      const definition = (decodeJsonPayloads(response.result) as any)
        ?.definition;
      return {
        signals: handlerList(definition?.signalDefinitions),
        updates: handlerList(definition?.updateDefinitions),
        queries: handlerList(definition?.queryDefinitions),
      };
    } catch (error) {
      this.logger.debug(`Workflow metadata query failed: ${error}`);
      return empty;
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
      llm: false,
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
