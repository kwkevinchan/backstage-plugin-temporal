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

import { BackstageCredentials } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import {
  WorkflowListResponse,
  WorkflowProgressResponse,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowDetail,
  TemporalSchedule,
  TemporalScheduleListResponse,
} from '../common';
import { TemporalService } from '../node';
import type { TemporalEntityContext } from '../node/alpha';
import { decodePageToken, encodePageToken, toWorkflowSummary } from './convert';
import { toTemporalSchedule } from './schedules';
import { scheduleClientOf } from './scheduleClient';
import {
  TemporalReadRepository,
  isScheduleNotFound,
  mapTemporalError,
} from '../repositories/TemporalReadRepository';
import {
  buildEntityWorkflowQuery,
  buildNamespaceWorkflowQuery,
  NamespaceWorkflowFilter,
  matchingWorkflowEntity,
  scheduleBelongsToSources,
} from './query';
import { EntityWorkflowSources } from './EntityWorkflowSources';
import { CLOSED_WITH_FAILURE, WorkflowQueries } from './WorkflowQueries';

export const LIST_PAGE_SIZE = { default: 20, max: 100 };
/** Number of most recent runs the statistics are computed from. */
export const STATS_LIMIT = { default: 50, max: 100 };
/** Most history events read for the progress of one run in a list. */
export const MAX_PROGRESS_EVENTS = 1000;

/** Most schedules a list reads. */
export const MAX_SCHEDULES = 500;

/** Schedules described at the same time, for their task queue. */
const SCHEDULE_DESCRIBE_CONCURRENCY = 8;

/** Closed runs whose progress is kept in memory; closed runs do not change. */
export const PROGRESS_CACHE_SIZE = 1000;

/**
 * The list use cases of the plugin: the workflows of an entity and of a
 * namespace, statistics, schedules and the progress of runs in a list.
 * Callers check permissions first (see `access/`).
 */
export class WorkflowListQueries {
  constructor(
    private readonly temporal: TemporalService,
    private readonly temporalReads: TemporalReadRepository,
    private readonly sources: EntityWorkflowSources,
    private readonly queries: WorkflowQueries,
  ) {}

  /**
   * The schedules of a namespace, the first MAX_SCHEDULES of them; with
   * `sources`, only those that belong to one of them
   * (`scheduleBelongsToSources`; a schedule is described when its task queue
   * decides).
   */
  async listSchedules(
    namespace: string,
    filter?: { sources?: { taskQueue?: string; workflowTypes: string[] }[] },
  ): Promise<TemporalScheduleListResponse> {
    this.sources.checkNamespace(namespace);
    const client = scheduleClientOf(
      await this.temporal.getConnection(),
      namespace,
    );
    const sources = filter?.sources;
    const items: TemporalSchedule[] = [];
    /** Schedules that match only on a task queue, which the list lacks. */
    const toCheck: TemporalSchedule[] = [];
    let truncated = false;
    let read = 0;
    try {
      for await (const summary of client.list({ pageSize: 100 })) {
        read += 1;
        if (read > MAX_SCHEDULES) {
          truncated = true;
          break;
        }
        const schedule = toTemporalSchedule(namespace, summary);
        if (!sources) {
          items.push(schedule);
          continue;
        }
        const workflowType = schedule.workflowType ?? '';
        // The list has no task queue: a source without one decides alone.
        if (scheduleBelongsToSources({ workflowType }, sources)) {
          items.push(schedule);
        } else if (sources.some(s => s.workflowTypes.includes(workflowType))) {
          toCheck.push(schedule);
        }
      }
    } catch (error) {
      mapTemporalError(error);
    }
    // The list has no task queue: describe those schedules, a few at a time.
    for (let i = 0; i < toCheck.length; i += SCHEDULE_DESCRIBE_CONCURRENCY) {
      const batch = toCheck.slice(i, i + SCHEDULE_DESCRIBE_CONCURRENCY);
      const queues = await Promise.all(
        batch.map(schedule =>
          client
            .getHandle(schedule.scheduleId)
            .describe()
            .then(d => d.action.taskQueue as string | undefined)
            .catch(error => {
              // Deleted since the list was read: not shown.
              if (isScheduleNotFound(error)) return undefined;
              return mapTemporalError(error);
            }),
        ),
      );
      batch.forEach((schedule, j) => {
        const taskQueue = queues[j];
        if (
          taskQueue &&
          scheduleBelongsToSources(
            { workflowType: schedule.workflowType ?? '', taskQueue },
            sources ?? [],
          )
        ) {
          items.push(schedule);
        }
      });
    }
    items.sort((a, b) => a.scheduleId.localeCompare(b.scheduleId));
    return { items, truncated };
  }

  async listEntityWorkflows(
    context: TemporalEntityContext,
    options: {
      status?: WorkflowStatus;
      /** False lists only the latest run of a workflow that continues as new. */
      allRuns?: boolean;
      /** A Bool search attribute that must be true. */
      searchAttribute?: string;
      pageSize: number;
      pageToken?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<WorkflowListResponse> {
    const query = buildEntityWorkflowQuery(this.sources.filterOf(context), {
      status: options.status,
      allRuns: options.allRuns,
      searchAttribute: options.searchAttribute,
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
    const convert = this.queries.convertOptions(context.namespace);
    const items = response.items.map(e => {
      const item = toWorkflowSummary(e, convert);
      const workflowEntityRef = matchingWorkflowEntity(
        item,
        this.sources.filterOf(context),
      );
      return workflowEntityRef ? { ...item, workflowEntityRef } : item;
    });
    return {
      items: await this.queries.enrich(items, context, options.credentials),
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
    this.sources.checkNamespace(namespace);
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
    const convert = this.queries.convertOptions(namespace);
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
    const query = buildEntityWorkflowQuery(this.sources.filterOf(context));
    const response = await this.temporalReads.listExecutions(
      context.namespace,
      query,
      { pageSize: options.limit },
    );
    const convert = this.queries.convertOptions(context.namespace);
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

  private readonly progressCache = new Map<string, WorkflowProgressResponse>();

  /**
   * Completed steps and the current step of one run, for lists. The
   * progress of closed runs is cached, since their history does not change.
   */
  async progress(workflow: WorkflowDetail): Promise<WorkflowProgressResponse> {
    const key = `${workflow.namespace}/${workflow.workflowId}/${workflow.runId}`;
    const cached = this.progressCache.get(key);
    if (cached) return cached;
    const graph = await this.queries.graph(workflow, {
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
