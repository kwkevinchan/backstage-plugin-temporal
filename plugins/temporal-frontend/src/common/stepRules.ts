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

// Copy of plugins/temporal-backend/src/common/stepRules.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { PendingActivity, WorkflowStatus } from './types';
import type { WorkflowNodeStatus } from './graph';

/*
 * Rules about steps and runs that the backend applies when it builds a
 * graph and the frontend applies when it shows one. Not exported from the
 * package: the frontend has a copy of this folder.
 */

/** Statuses of a step that has not ended. */
export const OPEN_STATUSES: ReadonlySet<WorkflowNodeStatus> = new Set([
  'Scheduled',
  'Running',
  'Retrying',
  'Waiting',
]);

/** Statuses of a step that failed. */
export const FAILED_STATUSES: ReadonlySet<WorkflowNodeStatus> = new Set([
  'Failed',
  'TimedOut',
  'Terminated',
  'Rejected',
]);

/** Statuses of a run that closed with a failure. */
export const CLOSED_WITH_FAILURE: readonly WorkflowStatus[] = [
  'Failed',
  'TimedOut',
  'Terminated',
];

/**
 * True for the name of a marker that records a local activity (such as
 * `core_local_activity`): a local activity is a step, other markers are not.
 */
export function isLocalActivityMarker(markerName: string): boolean {
  return /local_?activity/i.test(markerName);
}

/**
 * The fields of a pending activity that the graph of a run shows. They
 * change without a history event, so the frontend reads the graph again
 * when one of them changes.
 */
export const GRAPH_PENDING_ACTIVITY_FIELDS = [
  'activityId',
  'attempt',
  'maximumAttempts',
  'lastFailure',
  'state',
  'lastStartedTime',
] as const satisfies ReadonlyArray<keyof PendingActivity>;
