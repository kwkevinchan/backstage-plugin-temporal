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

import type { WorkflowEventGroupKind, WorkflowNodeKind } from '../../common';
import { kindTint } from './StepNode';

/**
 * Which end of an edge gives it its kind color. Flip this to try the other
 * variant; both are implemented, and the same classification is used.
 *
 * `target` colors the arrow by the step (or group) it leads to, so the
 * kind of what comes next is visible at a glance. `source` colors it by
 * the step it leaves.
 */
export const EDGE_KIND_COLOR_FROM: 'target' | 'source' = 'target';

export type EdgeKindColorFrom = 'target' | 'source';

/**
 * Kind tint of a group box or a collapsed group used as an edge endpoint:
 * a signal or update group counts as a message, like the signal or update
 * that started it; a label group (a loop or other ordinary group) stays
 * uncolored.
 */
export function groupKindTint(
  kind: WorkflowEventGroupKind,
): string | undefined {
  if (kind === 'event' || kind === 'update') return 'message';
  return undefined;
}

/** Kind tint of a step or group box at one end of an edge. */
export function endpointKindTint(
  id: string,
  nodes: ReadonlyArray<{ id: string; kind: WorkflowNodeKind }>,
  boxes?: ReadonlyMap<string, { group: { kind: WorkflowEventGroupKind } }>,
): string | undefined {
  const step = nodes.find(n => n.id === id);
  if (step) return kindTint(step.kind);
  const box = boxes?.get(id);
  if (box) return groupKindTint(box.group.kind);
  return undefined;
}

/** Kind tint that colors one edge, from the chosen end. */
export function edgeKindTint(
  source: string,
  target: string,
  nodes: ReadonlyArray<{ id: string; kind: WorkflowNodeKind }>,
  boxes?: ReadonlyMap<string, { group: { kind: WorkflowEventGroupKind } }>,
  from: EdgeKindColorFrom = EDGE_KIND_COLOR_FROM,
): string | undefined {
  return endpointKindTint(from === 'target' ? target : source, nodes, boxes);
}
