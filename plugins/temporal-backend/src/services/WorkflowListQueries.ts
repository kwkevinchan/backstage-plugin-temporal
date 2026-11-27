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
import { InputError } from '@backstage/errors';
import {
  WorkflowListResponse,
  WorkflowProgressResponse,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowTypeOverview,
  WorkflowTypeOverviewRun,
  TemporalSchedule,
  TemporalScheduleListResponse,
} from '../common';
import { TemporalService } from '../node';
import type { TemporalEntityContext } from '../node/alpha';
import { decodePageToken, encodePageToken, toWorkflowSummary } from './convert';
import { toTemporalSchedule } from './schedules';
import { scheduleClientOf } from '../repositories/scheduleClient';
import { TemporalReadRepository } from '../repositories/TemporalReadRepository';
import {
  isDeadlineError,
  isRateLimitedError,
  TEMPORAL_ERROR_MESSAGES,
  isScheduleNotFound,
  mapTemporalError,
} from '../repositories/errors';
import { callTemporal, TEMPORAL_DEADLINES } from '../repositories/temporalCall';
import {
  buildEntityVisibilityQuery,
  buildNamespaceVisibilityQuery,
  NamespaceWorkflowFilter,
  matchingWorkflowEntity,
  quote,
  scheduleBelongsToSources,
} from './visibilityQuery';
import { KeyedConcurrencyLimit } from './concurrencyLimit';
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

/** Days that the completed and failed counts of the overview cover. */
export const OVERVIEW_WINDOW_DAYS = 7;
/** Most recent runs the latest run and the mean duration of the overview come from. */
export const OVERVIEW_SAMPLE_SIZE = 50;
/** How long the numbers of one entity are kept, in milliseconds. */
export const OVERVIEW_CACHE_TTL_MS = 60_000;
/** Entities whose numbers are kept in memory. */
export const OVERVIEW_CACHE_SIZE = 1000;
/** Visibility calls of the overview in flight at once, in each namespace. */
export const OVERVIEW_CONCURRENCY = 4;

const FAILURE_CONDITION = `ExecutionStatus IN (${CLOSED_WITH_FAILURE.map(
  quote,
).join(', ')})`;

/** Mean duration of the closed runs of `items`, in milliseconds. */
function averageDurationMs(items: WorkflowSummary[]): number | undefined {
  let sum = 0;
  let count = 0;
  for (const item of items) {
    if (item.startTime && item.closeTime) {
      const ms = Date.parse(item.closeTime) - Date.parse(item.startTime);
      if (Number.isFinite(ms) && ms >= 0) {
        sum += ms;
        count += 1;
      }
    }
  }
  return count > 0 ? Math.round(sum / count) : undefined;
}

/** The messages of `failedOverview`: fixed text, whatever the error says. */
export const OVERVIEW_ERROR_MESSAGES = {
  rateLimited: TEMPORAL_ERROR_MESSAGES.rateLimited,
  deadline: TEMPORAL_ERROR_MESSAGES.deadline,
  other: 'The numbers could not be read',
} as const;

/**
 * The overview item of an entity whose numbers cannot be read: its counts
 * are 0, and `error` says why in one of three fixed messages (rate limited,
 * no answer in time, any other cause). The caller logs the error itself.
 */
export function failedOverview(
  entityRef: string,
  error: unknown,
  now = Date.now(),
): WorkflowTypeOverview {
  return {
    entityRef,
    running: 0,
    completed: 0,
    failed: 0,
    windowDays: OVERVIEW_WINDOW_DAYS,
    sampleSize: 0,
    updatedAt: new Date(now).toISOString(),
    error: isRateLimitedError(error)
      ? { message: OVERVIEW_ERROR_MESSAGES.rateLimited, rateLimited: true }
      : {
          message: isDeadlineError(error)
            ? OVERVIEW_ERROR_MESSAGES.deadline
            : OVERVIEW_ERROR_MESSAGES.other,
        },
  };
}

function overviewRun(item: WorkflowSummary): WorkflowTypeOverviewRun {
  const run: WorkflowTypeOverviewRun = {
    namespace: item.namespace,
    workflowId: item.workflowId,
    runId: item.runId,
    status: item.status,
  };
  if (item.startTime) run.startTime = item.startTime;
  if (item.closeTime) run.closeTime = item.closeTime;
  return run;
}

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
    private readonly logger: LoggerService,
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
    const sources = filter?.sources;
    const items: TemporalSchedule[] = [];
    /** Schedules that match only on a task queue, which the list lacks. */
    const toCheck: TemporalSchedule[] = [];
    let truncated = false;
    let read = 0;
    // One deadline for the whole list: its pages are read as it is iterated.
    await callTemporal(
      this.temporal,
      {
        timeoutMs: TEMPORAL_DEADLINES.list,
        mapError: mapTemporalError,
        temporalCall: 'schedule.list',
        namespace,
        logger: this.logger,
      },
      async connection => {
        const client = scheduleClientOf(connection, namespace);
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
          } else if (
            sources.some(s => s.workflowTypes.includes(workflowType))
          ) {
            toCheck.push(schedule);
          }
        }
      },
    );
    // The list has no task queue: describe those schedules, a few at a time.
    for (let i = 0; i < toCheck.length; i += SCHEDULE_DESCRIBE_CONCURRENCY) {
      const batch = toCheck.slice(i, i + SCHEDULE_DESCRIBE_CONCURRENCY);
      const queues = await Promise.all(
        batch.map(schedule =>
          callTemporal(
            this.temporal,
            {
              timeoutMs: TEMPORAL_DEADLINES.read,
              mapError: mapTemporalError,
              temporalCall: 'schedule.describe',
              namespace,
              logger: this.logger,
            },
            connection =>
              scheduleClientOf(connection, namespace)
                .getHandle(schedule.scheduleId)
                .describe()
                .then(d => d.action.taskQueue as string | undefined)
                .catch(error => {
                  // Deleted since the list was read: not shown.
                  if (isScheduleNotFound(error)) return undefined;
                  throw error;
                }),
          ),
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
      /** Only the runs of this workflow ID. */
      workflowId?: string;
      pageSize: number;
      pageToken?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<WorkflowListResponse> {
    const visibilityQuery = buildEntityVisibilityQuery(
      this.sources.filterOf(context),
      {
        status: options.status,
        allRuns: options.allRuns,
        searchAttribute: options.searchAttribute,
        workflowId: options.workflowId,
      },
    );
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const response = await this.temporalReads.listExecutions(
      context.namespace,
      visibilityQuery,
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
      relatedWorkflows: context.relatedWorkflows,
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
    const visibilityQuery = buildNamespaceVisibilityQuery(filter);
    let nextPageToken: Uint8Array | undefined;
    try {
      nextPageToken = decodePageToken(options.pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const response = await this.temporalReads.listExecutions(
      namespace,
      visibilityQuery,
      {
        pageSize: options.pageSize,
        nextPageToken,
      },
    );
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
    const visibilityQuery = buildEntityVisibilityQuery(
      this.sources.filterOf(context),
      { allRuns: false },
    );
    const response = await this.temporalReads.listExecutions(
      context.namespace,
      visibilityQuery,
      { pageSize: options.limit },
    );
    const convert = this.queries.convertOptions(context.namespace);
    const items = response.items
      .slice(0, options.limit)
      .map(e => toWorkflowSummary(e, convert));
    const byStatus: Partial<Record<WorkflowStatus, number>> = {};
    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
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
      averageDurationMs: averageDurationMs(items),
      relatedWorkflows: context.relatedWorkflows,
    };
  }

  private readonly overviewLimit = new KeyedConcurrencyLimit(
    OVERVIEW_CONCURRENCY,
  );

  private readonly overviewCache = new Map<
    string,
    { expiresAt: number; overview: WorkflowTypeOverview }
  >();

  /**
   * The numbers of a `TemporalWorkflow` entity for the overview of the
   * Temporal page, from at most three visibility calls: a count grouped by
   * status, a list of the most recent runs, and, when the failures of the
   * window are not among them, a list of the last failure. A server that
   * cannot group refuses the grouped count, and three counts follow: at
   * most six calls. The numbers are kept for
   * {@link OVERVIEW_CACHE_TTL_MS} by namespace and visibility query. A call
   * that fails gives an item with `error`; nothing is retried.
   */
  async overview(
    context: TemporalEntityContext,
  ): Promise<WorkflowTypeOverview> {
    const now = Date.now();
    try {
      const entityQuery = buildEntityVisibilityQuery(
        this.sources.filterOf(context),
      );
      const key = `${context.namespace}\n${entityQuery}`;
      const cached = this.overviewCache.get(key);
      if (cached && cached.expiresAt > now) {
        return { ...cached.overview, entityRef: context.entityRef };
      }
      if (cached) this.overviewCache.delete(key);
      const overview = await this.readOverview(context, entityQuery, now);
      if (this.overviewCache.size >= OVERVIEW_CACHE_SIZE) {
        const oldest = this.overviewCache.keys().next().value;
        if (oldest !== undefined) this.overviewCache.delete(oldest);
      }
      this.overviewCache.set(key, {
        expiresAt: now + OVERVIEW_CACHE_TTL_MS,
        overview,
      });
      return overview;
    } catch (error) {
      // A failed call to Temporal is logged by `callTemporal`; a limit hit by
      // many entities would otherwise write two lines for each of them.
      this.logger
        .child({ entityRef: context.entityRef })
        .debug('Could not read the numbers of an entity', error as Error);
      return failedOverview(context.entityRef, error, now);
    }
  }

  private async readOverview(
    context: TemporalEntityContext,
    entityQuery: string,
    now: number,
  ): Promise<WorkflowTypeOverview> {
    const { namespace } = context;
    const limited = <T>(call: () => Promise<T>) =>
      this.overviewLimit.run(namespace, call);
    const since = new Date(
      now - OVERVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const closedSince = `CloseTime > ${quote(since)}`;
    const sampleQuery = buildEntityVisibilityQuery(
      this.sources.filterOf(context),
      { allRuns: false },
    );
    const [counts, sample] = await Promise.all([
      this.countOverview(namespace, entityQuery, closedSince, limited),
      limited(() =>
        this.temporalReads.listExecutions(namespace, sampleQuery, {
          pageSize: OVERVIEW_SAMPLE_SIZE,
        }),
      ),
    ]);
    const convert = this.queries.convertOptions(namespace);
    const items = sample.items
      .slice(0, OVERVIEW_SAMPLE_SIZE)
      .map(e => toWorkflowSummary(e, convert));
    const sinceMs = Date.parse(since);
    let lastFailure = items
      .filter(
        item =>
          CLOSED_WITH_FAILURE.includes(item.status) &&
          item.closeTime !== undefined &&
          Date.parse(item.closeTime) > sinceMs,
      )
      .sort((a, b) => Date.parse(b.closeTime!) - Date.parse(a.closeTime!))[0];
    if (!lastFailure && counts.failed > 0) {
      const failures = await limited(() =>
        this.temporalReads.listExecutions(
          namespace,
          `(${entityQuery}) AND ${FAILURE_CONDITION} AND ${closedSince}`,
          { pageSize: 1 },
        ),
      );
      const [first] = failures.items;
      if (first) lastFailure = toWorkflowSummary(first, convert);
    }
    const overview: WorkflowTypeOverview = {
      entityRef: context.entityRef,
      ...counts,
      windowDays: OVERVIEW_WINDOW_DAYS,
      sampleSize: items.length,
      updatedAt: new Date(now).toISOString(),
    };
    if (items[0]) overview.latestRun = overviewRun(items[0]);
    const average = averageDurationMs(items);
    if (average !== undefined) overview.averageDurationMs = average;
    if (lastFailure) overview.lastFailure = overviewRun(lastFailure);
    return overview;
  }

  /**
   * Running runs, and runs completed and failed since the window began:
   * one grouped count, or three counts when the server cannot group.
   */
  private async countOverview(
    namespace: string,
    entityQuery: string,
    closedSince: string,
    limited: <T>(call: () => Promise<T>) => Promise<T>,
  ): Promise<{ running: number; completed: number; failed: number }> {
    let byStatus: Record<string, number>;
    try {
      byStatus = await limited(() =>
        this.temporalReads.countExecutionsByStatus(
          namespace,
          `(${entityQuery}) AND (ExecutionStatus = 'Running' OR ${closedSince})`,
        ),
      );
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      const count = (condition: string) =>
        limited(() =>
          this.temporalReads.countExecutions(
            namespace,
            `(${entityQuery}) AND ${condition}`,
          ),
        );
      const [running, completed, failed] = await Promise.all([
        count(`ExecutionStatus = 'Running'`),
        count(`ExecutionStatus = 'Completed' AND ${closedSince}`),
        count(`${FAILURE_CONDITION} AND ${closedSince}`),
      ]);
      return { running, completed, failed };
    }
    return {
      running: byStatus.Running ?? 0,
      completed: byStatus.Completed ?? 0,
      failed: CLOSED_WITH_FAILURE.reduce(
        (sum, status) => sum + (byStatus[status] ?? 0),
        0,
      ),
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
