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

// Copy of plugins/temporal-backend/src/common/schedules.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { CompoundEntityRef } from '@backstage/catalog-model';
import { buildEntityWorkflowsPath } from './paths';

/**
 * A workflow a schedule started.
 *
 * @public
 */
export interface TemporalScheduleAction {
  /** ISO 8601 time the action was scheduled for. */
  scheduledAt: string;
  /** ISO 8601 time the action was taken. */
  takenAt: string;
  workflowId: string;
  /** The first run of the workflow it started. */
  runId: string;
}

/**
 * A Temporal schedule that starts a workflow.
 *
 * @public
 */
export interface TemporalSchedule {
  namespace: string;
  scheduleId: string;
  /** The workflow type it starts. */
  workflowType?: string;
  /** When it runs, one line per interval or calendar, e.g. `every 1h`. */
  spec: string[];
  /** Time zone of the calendars. */
  timezone?: string;
  paused: boolean;
  /** Why it is paused, or another note. */
  note?: string;
  /** ISO 8601 times of the next actions. */
  nextActionTimes: string[];
  /** The most recent actions, newest first. */
  recentActions: TemporalScheduleAction[];
}

/**
 * Response of the schedule lists.
 *
 * @public
 */
export interface TemporalScheduleListResponse {
  items: TemporalSchedule[];
  /** True when there were more schedules than the backend reads. */
  truncated: boolean;
}

/**
 * Operations on a schedule (the control routes).
 *
 * @public
 */
export type TemporalScheduleOperation = 'pause' | 'unpause' | 'trigger';

/**
 * Body of `POST .../schedules/:scheduleId/pause` and `.../unpause`.
 *
 * @public
 */
export interface TemporalScheduleNoteRequest {
  note?: string;
}

/**
 * Path of the schedules of a namespace: `/schedules`.
 *
 * @public
 */
export const SCHEDULES_PATH = '/schedules';

/**
 * Path of the schedules of an entity's workflow types.
 *
 * @public
 */
export function buildEntitySchedulesPath(entity: CompoundEntityRef): string {
  return buildEntityWorkflowsPath(entity).replace(/\/workflows$/, '/schedules');
}

/**
 * Path of an operation on one schedule, e.g.
 * `/namespaces/default/schedules/nightly/pause`.
 *
 * @public
 */
export function buildScheduleOperationPath(
  ref: { namespace: string; scheduleId: string },
  operation: TemporalScheduleOperation,
): string {
  return `/namespaces/${encodeURIComponent(
    ref.namespace,
  )}/schedules/${encodeURIComponent(ref.scheduleId)}/${operation}`;
}
