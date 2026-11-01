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
  StatusAborted,
  StatusError,
  StatusOK,
  StatusPending,
  StatusRunning,
  StatusWarning,
} from '@backstage/core-components';
import type { WorkflowStatus } from '@kwkevinchan/backstage-plugin-temporal-common';

const LABELS: Record<WorkflowStatus, string> = {
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
  Canceled: 'Canceled',
  Terminated: 'Terminated',
  ContinuedAsNew: 'Continued as new',
  TimedOut: 'Timed out',
  Unknown: 'Unknown',
};

export function statusLabel(status: WorkflowStatus): string {
  return LABELS[status] ?? status;
}

/** Status with the Backstage status icons. */
export function WorkflowStatusLabel(props: { status: WorkflowStatus }) {
  const label = statusLabel(props.status);
  switch (props.status) {
    case 'Completed':
      return <StatusOK>{label}</StatusOK>;
    case 'Running':
      return <StatusRunning>{label}</StatusRunning>;
    case 'Failed':
    case 'TimedOut':
      return <StatusError>{label}</StatusError>;
    case 'Terminated':
      return <StatusWarning>{label}</StatusWarning>;
    case 'Canceled':
      return <StatusAborted>{label}</StatusAborted>;
    default:
      return <StatusPending>{label}</StatusPending>;
  }
}
