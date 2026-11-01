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

import type {
  WorkflowGraphNode,
  WorkflowNodeKind,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { formatDuration } from './format';

const KIND_LABELS: Record<WorkflowNodeKind, string> = {
  workflowStarted: 'Start',
  workflowClosed: 'End',
  activity: 'Activity',
  timer: 'Timer',
  signal: 'Signal',
  signalSent: 'Signal sent',
  update: 'Update',
  childWorkflow: 'Child workflow',
  marker: 'Marker',
  cancelRequest: 'Cancel request',
  waiting: 'Waiting',
  workflowTask: 'Workflow task',
  event: 'Event',
};

export function kindLabel(kind: WorkflowNodeKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/** True for steps that are not closed yet. */
export function isOpenStep(node: WorkflowGraphNode): boolean {
  return ['Scheduled', 'Running', 'Retrying', 'Waiting'].includes(node.status);
}

/** Second line of a step: what it waits for, or its duration. */
export function stepSubtitle(node: WorkflowGraphNode): string {
  if (node.waitingFor && isOpenStep(node)) return node.waitingFor;
  if (node.failure) return node.failure.message;
  const duration =
    node.startTime && node.endTime && node.startTime !== node.endTime
      ? formatDuration(node.startTime, node.endTime)
      : '';
  return [kindLabel(node.kind), duration].filter(Boolean).join(' · ');
}

/** Retries of an activity, as `×3` for the third attempt. */
export function retryBadge(node: WorkflowGraphNode): string | undefined {
  return node.attempt && node.attempt > 1 ? `×${node.attempt}` : undefined;
}
