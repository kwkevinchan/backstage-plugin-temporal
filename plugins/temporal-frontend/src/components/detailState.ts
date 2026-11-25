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

import type { WorkflowGraphNode } from '../common';

/** Default active tab of the workflow detail page (omitted from the URL). */
export const DEFAULT_DETAIL_TAB = 'steps';

/** Built-in tabs that are always rendered once a workflow is loaded. */
export const STATIC_DETAIL_TABS = [
  'steps',
  'timeline',
  'events',
  'details',
] as const;

/** Tab ID shown when the run graph includes Temporal event groups. */
export const EVENT_GROUPS_TAB = 'event-groups';

/**
 * Whether a step ID is safe to persist in and restore from the `?step=` URL
 * query parameter across page reloads and auto-refresh.
 *
 * All 12 history-backed `WorkflowNodeKind`s use immutable initiating event IDs
 * (or the run's singleton `'start'` / `'end'` IDs): `workflowStarted`,
 * `workflowClosed`, `activity`, `timer`, `signal`, `signalSent`, `update`,
 * `childWorkflow`, `marker`, `cancelRequest`, `workflowTask` (linkable when
 * failed and therefore non-internal), and `event` (non-internal only if ever
 * promoted).
 *
 * By contrast, synthetic `waiting` nodes (`id: 'waiting'`, `events: []`) are
 * derived transiently while a workflow is waiting with no open steps and may
 * vanish or reappear as the run progresses across reloads/auto-refresh, while
 * `internal` nodes (non-failed `workflowTask` and ungrouped `event`) are hidden
 * from selectable step views. Both are excluded from URL deep links.
 */
export function isLinkableStep(node: WorkflowGraphNode): boolean {
  return !node.internal && node.kind !== 'waiting';
}

/**
 * Resolves the active tab from the `?tab=` query parameter, falling back to
 * {@link DEFAULT_DETAIL_TAB} when the parameter is absent or not in
 * `availableTabs`.
 */
export function resolveDetailTab(
  search: URLSearchParams,
  availableTabs: ReadonlySet<string>,
): string {
  const tab = search.get('tab');
  return tab && availableTabs.has(tab) ? tab : DEFAULT_DETAIL_TAB;
}

/**
 * Resolves the selected step node from the `?step=` query parameter, ignoring
 * missing, unknown, internal, or non-linkable (ephemeral `waiting`) steps.
 */
export function resolveDetailStep(
  search: URLSearchParams,
  nodes: readonly WorkflowGraphNode[] | undefined,
): WorkflowGraphNode | undefined {
  const id = search.get('step');
  if (!id || !nodes) return undefined;
  return nodes.find(n => n.id === id && isLinkableStep(n));
}

/**
 * Returns updated URL search params for `tab`, omitting `tab` when it is the
 * default (`'steps'`) and preserving `step` and all unrelated query params.
 */
export function withDetailTab(
  current: URLSearchParams,
  tab: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (!tab || tab === DEFAULT_DETAIL_TAB) {
    next.delete('tab');
  } else {
    next.set('tab', tab);
  }
  return next;
}

/**
 * Returns updated URL search params for `stepId`, deleting `step` when
 * cleared and preserving `tab` and all unrelated query params.
 */
export function withDetailStep(
  current: URLSearchParams,
  stepId: string | undefined,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (!stepId) {
    next.delete('step');
  } else {
    next.set('step', stepId);
  }
  return next;
}
