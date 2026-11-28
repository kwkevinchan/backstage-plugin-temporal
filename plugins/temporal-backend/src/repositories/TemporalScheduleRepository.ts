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
import { NotFoundError } from '@backstage/errors';
import type {
  ScheduleHandle,
  ScheduleOverlapPolicy,
  ScheduleSummary,
} from '@temporalio/client';
import { TEMPORAL_DEADLINES } from '../lib/deadlines';
import type { TemporalService } from '../node';
import {
  isScheduleNotFound,
  mapCommandError,
  mapTemporalError,
} from './errors';
import { scheduleClientOf } from './scheduleClient';
import { callTemporal } from './temporalCall';

/** A schedule to operate: what it starts, and its overlap policy. */
export interface ScheduleTarget {
  namespace: string;
  scheduleId: string;
  workflowType: string;
  taskQueue: string;
  overlap?: ScheduleOverlapPolicy;
}

/**
 * The calls the plugin makes to Temporal's schedules, with the schedule
 * client of the SDK (see `scheduleClientOf`). Errors are mapped to Backstage
 * errors: those of the reads like the other reads, those of the operations
 * like the operations on workflows. Nothing here checks permissions or
 * namespaces: the services above do.
 */
export class TemporalScheduleRepository {
  constructor(
    private readonly temporal: TemporalService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * The first `max` schedules of a namespace, as the list of the SDK gives
   * them; `more` when the namespace has more. One deadline for the whole
   * list: its pages are read as it is iterated.
   */
  async list(
    namespace: string,
    max: number,
  ): Promise<{ summaries: ScheduleSummary[]; more: boolean }> {
    const summaries: ScheduleSummary[] = [];
    let more = false;
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
          if (summaries.length >= max) {
            more = true;
            break;
          }
          summaries.push(summary);
        }
      },
    );
    return { summaries, more };
  }

  /**
   * The task queue of the workflows a schedule starts, which the list
   * lacks. Undefined for a schedule that does not exist (any more).
   */
  taskQueue(
    namespace: string,
    scheduleId: string,
  ): Promise<string | undefined> {
    return callTemporal(
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
          .getHandle(scheduleId)
          .describe()
          .then(d => d.action.taskQueue as string | undefined)
          .catch(error => {
            if (isScheduleNotFound(error)) return undefined;
            throw error;
          }),
    );
  }

  /** A call on one schedule, with the errors of operations. */
  private operate<T>(
    temporalCall: string,
    namespace: string,
    scheduleId: string,
    timeoutMs: number,
    fn: (handle: ScheduleHandle) => Promise<T>,
  ): Promise<T> {
    return callTemporal(
      this.temporal,
      {
        timeoutMs,
        mapError: mapCommandError,
        temporalCall,
        namespace,
        logger: this.logger,
      },
      connection =>
        fn(scheduleClientOf(connection, namespace).getHandle(scheduleId)),
    );
  }

  /**
   * A schedule, read for an operation on it. Throws NotFoundError for a
   * schedule that does not exist.
   */
  async target(namespace: string, scheduleId: string): Promise<ScheduleTarget> {
    const description = await this.operate(
      'schedule.describe',
      namespace,
      scheduleId,
      TEMPORAL_DEADLINES.read,
      handle =>
        handle.describe().catch(error => {
          if (isScheduleNotFound(error)) {
            throw new NotFoundError(`No schedule ${scheduleId}`);
          }
          throw error;
        }),
    );
    return {
      namespace,
      scheduleId,
      workflowType: description.action.workflowType,
      taskQueue: description.action.taskQueue,
      overlap: description.policies?.overlap,
    };
  }

  async pause(schedule: ScheduleTarget, note: string): Promise<void> {
    await this.operate(
      'schedule.pause',
      schedule.namespace,
      schedule.scheduleId,
      TEMPORAL_DEADLINES.operation,
      handle => handle.pause(note),
    );
  }

  async unpause(schedule: ScheduleTarget, note: string): Promise<void> {
    await this.operate(
      'schedule.unpause',
      schedule.namespace,
      schedule.scheduleId,
      TEMPORAL_DEADLINES.operation,
      handle => handle.unpause(note),
    );
  }

  /**
   * Triggers a schedule with its own overlap policy (the default of the SDK
   * is to allow every overlap).
   */
  async trigger(schedule: ScheduleTarget): Promise<void> {
    await this.operate(
      'schedule.trigger',
      schedule.namespace,
      schedule.scheduleId,
      TEMPORAL_DEADLINES.operation,
      handle => handle.trigger(schedule.overlap),
    );
  }
}
