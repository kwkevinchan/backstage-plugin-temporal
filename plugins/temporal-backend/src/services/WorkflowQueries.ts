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
import { ConflictError, InputError, NotFoundError } from '@backstage/errors';
import {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRunChain,
  WorkflowHistoryResponse,
  WorkflowRef,
  WorkflowStatus,
  WorkflowStepsResponse,
  WorkflowSummary,
  parseLlmMarker,
  WorkflowHandler,
  WorkflowHandlersResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type { JsonValue } from '@backstage/types';
import { TemporalService } from '@kwkevinchan/backstage-plugin-temporal-node';
import { TemporalWorkflowEnricher } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  decodeJsonPayloads,
  encodeJsonPayloads,
  type TemporalEntityContext,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import {
  ConvertOptions,
  decodePageToken,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  toWorkflowSteps,
} from './convert';
import { buildWorkflowGraph } from './graph';
import {
  findReferencePayloads,
  PayloadStore,
} from '../repositories/PayloadStore';
import { TemporalReadRepository } from '../repositories/TemporalReadRepository';
import { workflowBelongsToEntity } from './query';
import { EntityWorkflowSources } from './EntityWorkflowSources';

export const HISTORY_PAGE_SIZE = { default: 100, max: 500 };
/** Most history events read to build the steps of one run. */
export const MAX_STEP_EVENTS = 5000;
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

/**
 * A graph without the data of the experimental AI views: loop markers and
 * groups, model call summaries and tool links. The steps stay, as plain
 * activities.
 */
function withoutAiData(graph: WorkflowGraphResponse): WorkflowGraphResponse {
  const { loops: _loops, ...rest } = graph;
  return {
    ...rest,
    nodes: graph.nodes.map(
      ({ loop: _loop, llm: _llm, tool: _tool, ...node }) => node,
    ),
  };
}

export const CLOSED_WITH_FAILURE: WorkflowStatus[] = [
  'Failed',
  'TimedOut',
  'Terminated',
];

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

/**
 * The read use cases of the plugin for one workflow: details, membership of
 * an entity, history, steps, graph, run position, queries and handlers. Callers check permissions first (see
 * `access/`); this class checks that namespaces are allowed and reads
 * Temporal through {@link TemporalReadRepository}.
 */
export class WorkflowQueries {
  /** `temporal.experimental.aiWorkflows`; `AiWorkflowQueries` reads it too. */
  readonly aiWorkflows: boolean;

  constructor(
    private readonly temporal: TemporalService,
    private readonly enrichers: TemporalWorkflowEnricher[],
    private readonly logger: LoggerService,
    private readonly sources: EntityWorkflowSources,
    readonly payloads: PayloadStore = new PayloadStore(),
    private readonly temporalReads: TemporalReadRepository = new TemporalReadRepository(
      temporal,
    ),
    options: {
      /**
       * `temporal.experimental.aiWorkflows`: AI loops and LLM steps. Without
       * it, graphs and steps carry no loop or model call data.
       */
      aiWorkflows?: boolean;
    } = {},
  ) {
    this.aiWorkflows = options.aiWorkflows === true;
  }

  /** The conversion options of a namespace; the list queries use them too. */
  convertOptions(namespace: string): ConvertOptions {
    const attributes = this.temporal.getSearchAttributeNames();
    return {
      namespace,
      entityRefAttribute: attributes.entityRef,
      initiatorAttribute: attributes.initiator,
      webUiUrl: ref => this.temporal.getWebUiUrl(ref),
    };
  }

  /** Runs the enrichers over summaries; the list queries use it too. */
  async enrich<T extends WorkflowSummary>(
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

  /**
   * Describes a run without any entity check. The memo is resolved from External Storage only when
   * this instance has a configured `PayloadStore` (the plugin's does; the
   * access service's does not).
   */
  async describe(ref: WorkflowRef): Promise<WorkflowDetail> {
    this.sources.checkNamespace(ref.namespace);
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
    const filter = this.sources.filterOf(context);
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
      this.sources.checkNamespace(ref.namespace);
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
    this.sources.checkNamespace(ref.namespace);
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
  async readEvents(
    ref: WorkflowRef & { runId: string },
    max: number,
    options: { payloads?: boolean; llmPayloads?: boolean } = {},
  ): Promise<{ events: unknown[]; truncated: boolean }> {
    this.sources.checkNamespace(ref.namespace);
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
    const steps = toWorkflowSteps(events, truncated);
    if (this.aiWorkflows) return steps;
    return {
      ...steps,
      activities: steps.activities.map(
        ({ llm: _llm, tool: _tool, ...activity }) => activity,
      ),
    };
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
        llmPayloads: options.llm !== false && this.aiWorkflows,
      },
    );
    const graph = buildWorkflowGraph(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated,
      pendingActivities: workflow.pendingActivities,
      searchAttributes: workflow.searchAttributes,
      includePayloads: options.includePayloads,
      failure: workflow.failure,
      memo: workflow.memo,
      aiWorkflows: this.aiWorkflows,
    });
    return this.aiWorkflows ? graph : withoutAiData(graph);
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
}
