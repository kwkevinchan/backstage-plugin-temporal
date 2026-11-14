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
  WorkflowEventGroup,
  WorkflowEventGroupKind,
  WorkflowGraphNode,
} from '../common';
import { formatDuration } from './format';
import { tokensText } from './llm/llmText';

/* Texts of the Temporal event groups, shared by the graph, the timeline
   and the Event Groups tab. */

/**
 * Who made the group: `Label` (the workflow), `Signal` (a signal handler),
 * `Event` (the start of the run, or a signal not in the graph) or
 * `Update`.
 */
export function groupKindLabel(
  group: { kind: WorkflowEventGroupKind; sourceNodeId?: string },
  nodes: WorkflowGraphNode[],
): string {
  switch (group.kind) {
    case 'event':
      return nodes.find(n => n.id === group.sourceNodeId)?.kind === 'signal'
        ? 'Signal'
        : 'Event';
    case 'update':
      return 'Update';
    default:
      return 'Label';
  }
}

/** `×3` for a group with three groups directly inside; else nothing. */
export function groupCountBadge(group: WorkflowEventGroup): string | undefined {
  return group.children.length > 1 ? `×${group.children.length}` : undefined;
}

/**
 * How long the group took, or has run so far while it runs; nothing
 * without the times.
 */
export function groupDuration(group: WorkflowEventGroup): string {
  if (!group.startTime) return '';
  if (!group.endTime && group.status !== 'Running') return '';
  return formatDuration(group.startTime, group.endTime);
}

/** Steps of the group shown in the graph (not the internal ones). */
export function groupSteps(
  group: WorkflowEventGroup,
  nodes: WorkflowGraphNode[],
): number {
  const shown = new Set(nodes.filter(n => !n.internal).map(n => n.id));
  return new Set(group.nodeIds.filter(id => shown.has(id))).size;
}

export function stepsText(count: number): string {
  return count === 1 ? '1 step' : `${count} steps`;
}

/** Tokens of the model calls in the group, like `1.2k in · 180 out`. */
export function groupTokens(group: WorkflowEventGroup): string {
  return tokensText(group.usage);
}

/** Why the name of a group is its ID. */
export const UNREADABLE_LABEL_TEXT =
  'The label cannot be read (it may be encoded by a payload codec); the group ID is shown.';
