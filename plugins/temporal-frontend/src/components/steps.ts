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

import type { WorkflowGraphNode, WorkflowNodeKind } from '../common';
import { deadlineText, formatDuration } from './format';

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

/**
 * Markers that are not steps of their own: side effects, version and patch
 * markers. They are left out of the graph and the step list by default.
 * Local activities are recorded as markers too, but count as steps.
 */
export function isMarkerStep(node: WorkflowGraphNode): boolean {
  if (node.kind !== 'marker') return false;
  const name = node.details?.markerName;
  return !/local_?activity/i.test(typeof name === 'string' ? name : node.name);
}

/** True for steps that are not closed yet. */
export function isOpenStep(node: WorkflowGraphNode): boolean {
  return ['Scheduled', 'Running', 'Retrying', 'Waiting'].includes(node.status);
}

/** What a step box knows besides the step. */
export interface StepTextOptions {
  /**
   * Number of the run that follows (`runChain.index + 1`), for the end of a
   * run that continued as new.
   */
  nextRun?: number;
}

/** Second line of a step: what it waits for, or its duration. */
export function stepSubtitle(
  node: WorkflowGraphNode,
  now: number = Date.now(),
  options: StepTextOptions = {},
): string {
  if (isOpenStep(node) && (node.waitingFor || node.deadline)) {
    const deadline = node.deadline ? deadlineText(node.deadline, now) : '';
    const text = [node.waitingFor, deadline].filter(Boolean).join(' · ');
    return text.charAt(0).toLocaleUpperCase('en-US') + text.slice(1);
  }
  if (node.failure) return node.failure.message;
  if (node.kind === 'workflowStarted' || node.kind === 'workflowClosed') {
    if (node.status !== 'ContinuedAsNew' || !node.workflow?.runId) return '';
    return options.nextRun
      ? `Continues in run ${options.nextRun}`
      : 'Continues in a new run';
  }
  const duration =
    node.startTime && node.endTime && node.startTime !== node.endTime
      ? formatDuration(node.startTime, node.endTime)
      : '';
  return [kindLabel(node.kind), duration].filter(Boolean).join(' · ');
}

/**
 * Title and subtitle of a step box. A timer that is the time limit of a
 * wait is titled with what the run waits for, and its subtitle says when
 * the wait times out.
 */
export function stepBoxText(
  node: WorkflowGraphNode,
  now: number = Date.now(),
  options: StepTextOptions = {},
): { title: string; subtitle: string } {
  if (
    isOpenStep(node) &&
    node.deadline?.kind === 'timeout' &&
    node.waitingFor
  ) {
    const left = deadlineText(node.deadline, now);
    return {
      title: node.waitingFor,
      subtitle: [
        left.charAt(0).toLocaleUpperCase('en-US') + left.slice(1),
        node.name,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  const subtitle = stepSubtitle(node, now, options);
  // A summary from the workflow reads better than the activity type; the
  // type stays in the subtitle.
  if (node.summary) {
    return {
      title: node.summary,
      subtitle: [node.name, subtitle].filter(Boolean).join(' · '),
    };
  }
  return { title: node.name, subtitle };
}

/** Retries of an activity, as `×3` for the third attempt. */
export function retryBadge(node: WorkflowGraphNode): string | undefined {
  return node.attempt && node.attempt > 1 ? `×${node.attempt}` : undefined;
}
