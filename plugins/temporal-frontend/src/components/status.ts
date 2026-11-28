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

import type { WorkflowNodeStatus, WorkflowStatus } from '../common';

/**
 * Color tone of a status, mapped to the `@backstage/ui` status tokens.
 *
 * @alpha
 */
export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * A workflow status or a step status.
 *
 * @alpha
 */
export type AnyStatus = WorkflowStatus | WorkflowNodeStatus;

const LABELS: Record<AnyStatus, string> = {
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
  Canceled: 'Canceled',
  Terminated: 'Terminated',
  ContinuedAsNew: 'Continued as new',
  TimedOut: 'Timed out',
  Unknown: 'Unknown',
  Scheduled: 'Scheduled',
  Retrying: 'Retrying',
  Waiting: 'Waiting',
  Rejected: 'Rejected',
};

/**
 * The label of a workflow or step status.
 *
 * @alpha
 */
export function statusLabel(status: AnyStatus): string {
  return LABELS[status] ?? status;
}

/**
 * The color tone of a workflow or step status.
 *
 * @alpha
 */
export function statusTone(status: AnyStatus): Tone {
  switch (status) {
    case 'Completed':
      return 'success';
    case 'Failed':
    case 'TimedOut':
    case 'Rejected':
      return 'danger';
    case 'Terminated':
    case 'Retrying':
      return 'warning';
    case 'Running':
    case 'ContinuedAsNew':
      return 'info';
    default:
      return 'neutral';
  }
}

/**
 * True for statuses that are still in progress.
 *
 * @alpha
 */
export function isActiveStatus(status: AnyStatus): boolean {
  return status === 'Running' || status === 'Retrying';
}
