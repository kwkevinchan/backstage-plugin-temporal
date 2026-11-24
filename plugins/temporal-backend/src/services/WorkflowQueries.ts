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
  WorkflowRunRef,
  WorkflowStatus,
  WorkflowResultResponse,
  WorkflowSummary,
  WorkflowMessageDefinition,
  WorkflowMessageDefinitionsResponse,
} from '../common';
import type { JsonValue } from '@backstage/types';
import { TemporalService } from '../node';
import type {
  TemporalEntityContext,
  TemporalWorkflowEnricher,
} from '../node/alpha';
import { decodeJsonPayloads, encodeJsonPayloads } from './payloads';
import {
  ConvertOptions,
  decodePageToken,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  resultFromCloseEvent,
} from './convert';
import { buildWorkflowGraph, MAX_GRAPH_EDGES } from './graph';
import { builtInOnlyLlmAdapters, LlmAdapters } from './llm/LlmAdapters';
import { TemporalReadRepository } from '../repositories/TemporalReadRepository';
import { matchedWorkflowEntity, workflowIdCondition } from './visibilityQuery';
import { EntityWorkflowSources } from './EntityWorkflowSources';

export const HISTORY_PAGE_SIZE = { default: 100, max: 500 };
/** Most history events read to build the steps of one run. */
export const MAX_STEP_EVENTS = 5000;
/** Query of the Temporal SDKs that lists a workflow's message definitions. */
export const METADATA_QUERY = '__temporal_workflow_metadata';
/** Time the metadata query may take. */
export const METADATA_QUERY_TIMEOUT_MS = 5000;

/** Message definitions of the metadata query, without the SDKs' own (`__`). */
function messageDefinitionList(
  definitions: unknown,
): WorkflowMessageDefinition[] {
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

export const CLOSED_WITH_FAILURE: WorkflowStatus[] = [
  'Failed',
  'TimedOut',
  'Terminated',
];

/**
 * Close events read during `describe()`, keyed by the returned `WorkflowDetail`.
 * Module-scoped so a detail described by `temporalAccessServiceRef`'s
 * `WorkflowQueries` instance can be reused by the plugin's own instance when
 * building a truncated graph, without adding internal fields to `WorkflowDetail`.
 */
const describedCloseEvents = new WeakMap<WorkflowDetail, unknown>();

/**
 * The read use cases of the plugin for one workflow: details, membership of
 * an entity, history, steps, graph, run position, queries and message definitions. Callers check permissions first (see
 * `access/`); this class checks that namespaces are allowed and reads
 * Temporal through {@link TemporalReadRepository}.
 */
export class WorkflowQueries {
  /** The LLM adapters; `AiWorkflowQueries` reads them too. */
  readonly llmAdapters: LlmAdapters;

  constructor(
    private readonly temporal: TemporalService,
    private readonly enrichers: TemporalWorkflowEnricher[],
    private readonly logger: LoggerService,
    private readonly sources: EntityWorkflowSources,
    private readonly temporalReads: TemporalReadRepository = new TemporalReadRepository(
      temporal,
      logger,
    ),
    options: {
      /** The LLM adapters that read model calls; the built-in ones by default. */
      llmAdapters?: LlmAdapters;
    } = {},
  ) {
    this.llmAdapters = options.llmAdapters ?? builtInOnlyLlmAdapters();
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
        this.logger
          .child({
            enricherId: enricher.id,
            namespace: context.namespace,
            entityRef: context.entityRef,
          })
          .warn(
            'A workflow enricher failed, so its fields are left out',
            error as Error,
          );
      }
    }
    return current;
  }

  /**
   * Describes a run without any entity check. Without `runId`, the latest
   * run (for the resources of the permission framework).
   */
  async describe(ref: WorkflowRef): Promise<WorkflowDetail> {
    this.sources.checkNamespace(ref.namespace);
    const json = await this.temporalReads.describeExecution(ref);
    const detail = toWorkflowDetail(json, this.convertOptions(ref.namespace));
    // The close event tells the failure, or the run this one continued as.
    if (
      CLOSED_WITH_FAILURE.includes(detail.status) ||
      detail.status === 'ContinuedAsNew'
    ) {
      const closeEvent = await this.temporalReads.lastEvent({
        ...ref,
        runId: detail.runId,
      });
      const described = toWorkflowDetail(json, {
        ...this.convertOptions(ref.namespace),
        closeEvent,
      });
      if (closeEvent !== undefined) {
        describedCloseEvents.set(described, closeEvent);
      }
      return described;
    }
    return detail;
  }

  /**
   * Checks that a workflow is one of the entity's, or a child workflow (up
   * to MAX_PARENT_DEPTH levels) of one of them: a child is part of its
   * parent's work, so it is opened, and operated, with the parent's entity
   * and its permissions. Returns the entity reference that matched
   * (`context.entityRef` or the related `TemporalWorkflow` entity matched
   * directly or by the ancestor). Throws NotFoundError otherwise.
   */
  async assertBelongs(
    workflow: WorkflowDetail,
    context: TemporalEntityContext,
  ): Promise<string> {
    const filter = this.sources.filterOf(context);
    let current: WorkflowDetail = workflow;
    for (let depth = 0; ; depth += 1) {
      if (current.namespace === context.namespace) {
        const matched = matchedWorkflowEntity(current, filter);
        if (matched) return matched;
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
      // membership needs is read: no close event.
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
    ref: WorkflowRunRef,
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
    return {
      events: response.items.map(toHistoryEvent),
      nextPageToken: encodePageToken(response.nextPageToken),
    };
  }

  /**
   * Reads the history of one run, oldest first, up to `max` events.
   */
  async readEvents(
    ref: WorkflowRunRef,
    max: number,
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
    return { events, truncated: Boolean(nextPageToken) };
  }

  /**
   * The result or failure of a run, from its close event. A running run
   * returns only `status`.
   */
  async result(workflow: WorkflowDetail): Promise<WorkflowResultResponse> {
    this.sources.checkNamespace(workflow.namespace);
    const event = await this.temporalReads.closeEvent({
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    });
    const { result, failure } = resultFromCloseEvent(event);
    return {
      status: workflow.status,
      ...(result !== undefined ? { result } : {}),
      ...(failure !== undefined ? { failure } : {}),
    };
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
    );
    // A cut history misses the close event, whose failure tells the step
    // the run failed at.
    let closeEvent: unknown;
    if (truncated && CLOSED_WITH_FAILURE.includes(workflow.status)) {
      closeEvent = describedCloseEvents.has(workflow)
        ? describedCloseEvents.get(workflow)
        : await this.closeEventOrUndefined(ref);
    }
    const graph = buildWorkflowGraph(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated,
      pendingActivities: workflow.pendingActivities,
      searchAttributes: workflow.searchAttributes,
      includePayloads: options.includePayloads,
      failure: workflow.failure,
      closeEvent,
      llmAdapters: this.llmAdapters,
      onEdgesCapped: () =>
        this.logger
          .child({
            namespace: workflow.namespace,
            workflowId: workflow.workflowId,
            runId: workflow.runId,
            maxEdges: MAX_GRAPH_EDGES,
          })
          .debug('The graph has more edges than are drawn'),
    });
    return graph;
  }

  /** The close event of a run; undefined when reading it fails. */
  private async closeEventOrUndefined(ref: WorkflowRunRef): Promise<unknown> {
    try {
      return await this.temporalReads.closeEvent(ref);
    } catch (error) {
      this.logger
        .child({
          namespace: ref.namespace,
          workflowId: ref.workflowId,
          runId: ref.runId,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .debug('The close event of a run could not be read');
      return undefined;
    }
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
    if (Number.isNaN(start)) return chain;
    let byId: string;
    try {
      byId = workflowIdCondition(workflow.workflowId);
    } catch {
      // A workflow ID that a visibility query cannot match is not counted.
      return chain;
    }
    // The start time of describe is cut to milliseconds.
    const until = new Date(start + 1).toISOString();
    try {
      const count = (visibilityQuery: string) =>
        this.temporalReads.countExecutions(workflow.namespace, visibilityQuery);
      const [index, total] = await Promise.all([
        count(`${byId} AND StartTime < '${until}'`),
        count(byId),
      ]);
      return index > 0 && total >= index ? { ...chain, index, total } : chain;
    } catch (error) {
      this.logger
        .child({
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .debug('Could not count the runs of a workflow');
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
  async messageDefinitions(
    workflow: WorkflowDetail,
  ): Promise<WorkflowMessageDefinitionsResponse> {
    const empty: WorkflowMessageDefinitionsResponse = {
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
        signals: messageDefinitionList(definition?.signalDefinitions),
        updates: messageDefinitionList(definition?.updateDefinitions),
        queries: messageDefinitionList(definition?.queryDefinitions),
      };
    } catch (error) {
      this.logger
        .child({
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          runId: workflow.runId,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .debug('The metadata query of a workflow failed');
      return empty;
    }
  }
}
