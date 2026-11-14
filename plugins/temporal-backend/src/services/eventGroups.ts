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

import { addLlmUsage } from '../common';
import type {
  WorkflowEventGroup,
  WorkflowEventGroupKind,
  WorkflowGraphNode,
  WorkflowLlmUsage,
  WorkflowNodeStatus,
  WorkflowStatus,
} from '../common';
import { decodePayload, dropUndefined, summaryText } from './convert';
import { FAILED_STATUSES, stepsStatus } from './stepStatus';

/*
 * Temporal Event Groups in the graph. The history keeps the groups of a
 * command on the event it recorded (`eventGroupMarkers`): activity
 * scheduled, timer started, child workflow initiated, the marker of a local
 * activity, continued as new and the other command events. The marker list
 * is flat, outer groups first; Temporal records no parent, so the nesting
 * is inferred from the members (`inferEventGroupParents`).
 */

type Json = any;

/** Most groups of one run; the history of a run is read up to 5000 events. */
export const MAX_EVENT_GROUPS = 1000;

/** Most groups of one step; more are left out. */
export const MAX_GROUPS_PER_STEP = 32;

/** One marker of an event, read. */
export interface EventGroupMarker {
  key: string;
  kind: WorkflowEventGroupKind;
  id: string;
  /** The label payload of a `label` marker. */
  label?: Json;
}

/** The ID of an inbound event: a string (int64 in protobuf JSON) or a number. */
function eventIdText(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

/**
 * The event group markers of a history event, outer groups first, each
 * group once. Markers of an unknown shape are skipped.
 */
export function readEventGroupMarkers(event: Json): EventGroupMarker[] {
  const raw = event?.eventGroupMarkers;
  if (!Array.isArray(raw)) return [];
  const markers: EventGroupMarker[] = [];
  const seen = new Set<string>();
  const push = (marker: EventGroupMarker) => {
    if (seen.has(marker.key)) return;
    seen.add(marker.key);
    markers.push(marker);
  };
  for (const m of raw) {
    const label = m?.label;
    if (label && typeof label.id === 'string' && label.id !== '') {
      push({
        key: `label:${label.id}`,
        kind: 'label',
        id: label.id,
        label: label.label ?? undefined,
      });
      continue;
    }
    const eventId = eventIdText(m?.inboundEvent?.inboundEventId);
    if (eventId !== undefined) {
      push({ key: `event:${eventId}`, kind: 'event', id: eventId });
      continue;
    }
    const updateId = m?.inboundUpdate?.inboundUpdateId;
    if (typeof updateId === 'string' && updateId !== '') {
      push({ key: `update:${updateId}`, kind: 'update', id: updateId });
    }
  }
  return markers;
}

/**
 * The label of a group as a step summary shows (`summaryText`: the first
 * line, trimmed), `unreadable` for a payload the backend cannot decode (for
 * example one encoded by a codec), or undefined for no label or an empty
 * one.
 */
function readLabel(payload: Json): string | 'unreadable' | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  if (payload.data === undefined && payload.metadata === undefined) {
    return undefined;
  }
  const decoded = decodePayload(payload);
  if (!('value' in decoded) || typeof decoded.value !== 'string') {
    return 'unreadable';
  }
  return summaryText(decoded.value);
}

/**
 * The parent of each group, from the groups of the steps (each list outer
 * groups first, each group once). A group A is the parent of B when every
 * step of B is also in A and A comes before B in the groups of each of
 * these steps; of several such groups, the one listed last before B in the
 * first step of B (the innermost one). Groups whose steps overlap without
 * one containing the other get no parent. Two groups with the same steps
 * nest in the order of the list.
 *
 * Cycles cannot happen: a parent comes strictly before its child in the
 * list of a step they share, and the groups of a cycle would share all
 * their steps. The time is linear in the steps times the square of the
 * groups of one step.
 */
export function inferEventGroupParents(
  memberships: string[][],
): Map<string, string | undefined> {
  // Groups that are before the key in every step of it so far.
  const candidates = new Map<string, Set<string>>();
  // The groups of the first step of each group, for the innermost one.
  const firstList = new Map<string, string[]>();
  for (const keys of memberships) {
    const position = new Map<string, number>();
    keys.forEach((key, i) => {
      if (!position.has(key)) position.set(key, i);
    });
    keys.forEach((key, i) => {
      if (position.get(key) !== i) return;
      const known = candidates.get(key);
      if (!known) {
        candidates.set(key, new Set(keys.slice(0, i)));
        firstList.set(key, keys);
        return;
      }
      for (const candidate of known) {
        const at = position.get(candidate);
        if (at === undefined || at >= i) known.delete(candidate);
      }
    });
  }
  const parents = new Map<string, string | undefined>();
  for (const [key, known] of candidates) {
    const list = firstList.get(key)!;
    let parent: string | undefined;
    for (const candidate of list) {
      if (candidate === key) break;
      if (known.has(candidate)) parent = candidate;
    }
    parents.set(key, parent);
  }
  return parents;
}

/** A graph node while the graph is built: `last` is unset while it runs. */
export type EventGroupNode = WorkflowGraphNode & { last?: number };

/** Run statuses after which a group left open failed. */
const FAILED_RUNS = new Set<WorkflowStatus>([
  'Failed',
  'TimedOut',
  'Terminated',
]);

/** How the run stands, for groups whose steps did not all end. */
export interface EventGroupRun {
  /** Status of the run from describe. */
  status: WorkflowStatus;
  /** The node of the closing event, when the history has it. */
  end?: EventGroupNode;
}

/** Run statuses that are final: a step left open will not end any more. */
const ENDED_RUNS = new Set<WorkflowStatus>([
  ...FAILED_RUNS,
  'Completed',
  'Canceled',
  'ContinuedAsNew',
]);

/**
 * Status of a group: from its steps (`stepsStatus`) while the run runs or
 * its status is unknown. After the run ended (completed, failed, canceled,
 * timed out, terminated or continued as new), a group whose steps did not
 * all end is `Failed` when a step failed or the run failed, timed out or
 * was terminated, else `Canceled`.
 */
export function eventGroupStatus(
  steps: EventGroupNode[],
  run: EventGroupRun,
): WorkflowNodeStatus {
  const status = stepsStatus(steps);
  if (status !== 'Running' || !ENDED_RUNS.has(run.status)) return status;
  if (steps.some(s => FAILED_STATUSES.has(s.status))) return 'Failed';
  return FAILED_RUNS.has(run.status) ? 'Failed' : 'Canceled';
}

interface Draft {
  key: string;
  kind: WorkflowEventGroupKind;
  id: string;
  label?: string;
  labelUnreadable?: boolean;
  nodeIds: string[];
}

/**
 * Collects the groups of the steps of one run while the graph is built,
 * then builds the groups from the finished steps.
 */
export class EventGroupCollector {
  private readonly drafts = new Map<string, Draft>();
  private readonly memberships: string[][] = [];
  private truncated = false;

  /**
   * Reads the markers of the event that starts the step `nodeId`. Returns
   * the keys of its groups, outer groups first, or undefined for none.
   */
  add(nodeId: string, event: Json): string[] | undefined {
    const markers = readEventGroupMarkers(event);
    if (markers.length === 0) return undefined;
    if (markers.length > MAX_GROUPS_PER_STEP) this.truncated = true;
    const keys: string[] = [];
    for (const marker of markers.slice(0, MAX_GROUPS_PER_STEP)) {
      let draft = this.drafts.get(marker.key);
      if (!draft) {
        if (this.drafts.size >= MAX_EVENT_GROUPS) {
          this.truncated = true;
          continue;
        }
        draft = {
          key: marker.key,
          kind: marker.kind,
          id: marker.id,
          nodeIds: [],
        };
        this.drafts.set(marker.key, draft);
      }
      // SDK 1.24 sends the label with every marker: the first readable one.
      if (draft.label === undefined && marker.label !== undefined) {
        const label = readLabel(marker.label);
        if (label === 'unreadable') draft.labelUnreadable = true;
        else if (label !== undefined) {
          draft.label = label;
          delete draft.labelUnreadable;
        }
      }
      draft.nodeIds.push(nodeId);
      keys.push(marker.key);
    }
    if (keys.length === 0) return undefined;
    this.memberships.push(keys);
    return keys;
  }

  /** The groups, in the order they started, from the finished steps. */
  build(
    nodes: EventGroupNode[],
    run: EventGroupRun,
  ): {
    groups: WorkflowEventGroup[];
    truncated: boolean;
  } {
    if (this.drafts.size === 0) {
      return { groups: [], truncated: this.truncated };
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    // Sources of inbound groups: the signal (or start) event, the update.
    const byFirstEvent = new Map<string, EventGroupNode>();
    const updates = new Map<string, EventGroupNode>();
    for (const node of nodes) {
      const first = node.events[0]?.eventId;
      if (
        first &&
        (node.kind === 'signal' || node.kind === 'workflowStarted')
      ) {
        byFirstEvent.set(first, node);
      }
      if (node.kind === 'update' && node.stepId) updates.set(node.stepId, node);
    }
    const parents = inferEventGroupParents(this.memberships);
    const groups: WorkflowEventGroup[] = [];
    const byKey = new Map<string, WorkflowEventGroup>();
    for (const draft of this.drafts.values()) {
      const steps = draft.nodeIds
        .map(id => byId.get(id))
        .filter((n): n is EventGroupNode => !!n);
      const status = eventGroupStatus(steps, run);
      const starts = steps.map(s => s.startTime).filter(Boolean) as string[];
      const ends = steps.map(s => s.endTime).filter(Boolean) as string[];
      let endTime: string | undefined;
      if (stepsStatus(steps) === 'Running') {
        // Steps left open when the run ended end with the run.
        if (status !== 'Running') endTime = run.end?.endTime;
      } else endTime = ends.sort()[ends.length - 1];
      let usage: WorkflowLlmUsage | undefined;
      let llmCalls = 0;
      for (const step of steps) {
        if (!step.llm) continue;
        usage = addLlmUsage(usage, step.llm.usage);
        llmCalls += step.llm.callCount ?? 1;
      }
      const { name, source } = this.nameOf(draft, byFirstEvent, updates);
      const group: WorkflowEventGroup = dropUndefined({
        key: draft.key,
        kind: draft.kind,
        id: draft.id,
        name,
        labelUnreadable: draft.labelUnreadable || undefined,
        sourceNodeId: source?.id,
        nodeIds: draft.nodeIds,
        parent: parents.get(draft.key),
        children: [],
        status,
        startTime: starts.sort()[0],
        endTime,
        usage,
        llmCalls: llmCalls > 0 ? llmCalls : undefined,
      });
      groups.push(group);
      byKey.set(group.key, group);
    }
    for (const group of groups) {
      if (group.parent) byKey.get(group.parent)?.children.push(group.key);
    }
    return { groups, truncated: this.truncated };
  }

  /**
   * The display name of a group, as the Temporal UI shows it: the label
   * (else the ID), `<signal> (<event ID>)` or `<update> (<update ID>)`.
   */
  private nameOf(
    draft: Draft,
    byFirstEvent: Map<string, EventGroupNode>,
    updates: Map<string, EventGroupNode>,
  ): { name: string; source?: EventGroupNode } {
    if (draft.kind === 'label') return { name: draft.label ?? draft.id };
    if (draft.kind === 'event') {
      const source = byFirstEvent.get(draft.id);
      if (!source) return { name: draft.id };
      if (source.kind === 'signal') {
        return { name: `${source.name} (${draft.id})`, source };
      }
      return { name: source.events[0].eventType, source };
    }
    const source = updates.get(draft.id);
    return source
      ? { name: `${source.name} (${draft.id})`, source }
      : { name: draft.id };
  }
}
