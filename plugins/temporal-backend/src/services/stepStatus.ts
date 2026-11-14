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

import type { WorkflowNodeStatus } from '../common';

/* Statuses of the steps of a graph, shared by the graph, loops and groups. */

/** Statuses of a step that has not ended. */
export const OPEN_STATUSES = new Set<WorkflowNodeStatus>([
  'Scheduled',
  'Running',
  'Retrying',
  'Waiting',
]);

/** Statuses of a step that failed. */
export const FAILED_STATUSES = new Set<WorkflowNodeStatus>([
  'Failed',
  'TimedOut',
  'Terminated',
  'Rejected',
]);

/** A step while the graph is built: `last` is unset while it is open. */
export interface StatusStep {
  status: WorkflowNodeStatus;
  last?: number;
}

/**
 * Status of a set of steps (a round, a group): Running while a step is
 * open, Failed when a step failed, Canceled when a step was canceled, else
 * Completed.
 */
export function stepsStatus(steps: StatusStep[]): WorkflowNodeStatus {
  if (steps.some(s => s.last === undefined && OPEN_STATUSES.has(s.status))) {
    return 'Running';
  }
  if (steps.some(s => FAILED_STATUSES.has(s.status))) return 'Failed';
  if (steps.some(s => s.status === 'Canceled')) return 'Canceled';
  return 'Completed';
}
