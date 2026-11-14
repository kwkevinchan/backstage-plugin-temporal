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

// Copy of plugins/temporal-backend/src/common/eventGroups.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { WorkflowNodeStatus } from './graph';
import type { WorkflowLlmUsage } from './llm';

/*
 * Temporal Event Groups (an experimental feature of Temporal: server 1.32,
 * TypeScript SDK 1.23 or later). A workflow puts commands into groups; the
 * history keeps the groups of each command on the event it recorded
 * (`eventGroupMarkers`, outer groups first). The backend reads them into
 * the graph.
 */

/**
 * Kind of an event group, as in the history:
 *
 * - `label`: a group the workflow created (`createEventGroup`);
 * - `event`: the commands of a signal handler (or of the start event),
 *   grouped by the SDK by the event ID of the signal;
 * - `update`: the commands of an update handler, by the update ID.
 *
 * Experimental: Event Groups are experimental in Temporal, and the shape
 * may change.
 *
 * @alpha
 */
export type WorkflowEventGroupKind = 'label' | 'event' | 'update';

/**
 * One event group of a run.
 *
 * Experimental: Event Groups are experimental in Temporal, and the shape
 * may change.
 *
 * @alpha
 */
export interface WorkflowEventGroup {
  /**
   * `label:<id>`, `event:<event ID>` or `update:<update ID>`, as the
   * `groups` parameter of the Temporal UI. Unique within the run.
   */
  key: string;
  /** Who made the group: the workflow (`label`), a signal or an update. */
  kind: WorkflowEventGroupKind;
  /** The group ID, the event ID of the signal or the update ID. */
  id: string;
  /**
   * Display name: the label of a `label` group (its ID when it has no
   * label or the label cannot be read), `<signal name> (<event ID>)`,
   * `<update name> (<update ID>)`.
   */
  name: string;
  /**
   * True when the group has a label the backend cannot read, for example
   * one encoded by a payload codec; `name` is the ID then.
   */
  labelUnreadable?: boolean;
  /**
   * Graph node of the signal or update that started the commands of an
   * `event` or `update` group, when the history has it.
   */
  sourceNodeId?: string;
  /** Graph nodes of the steps in the group, oldest first. */
  nodeIds: string[];
  /**
   * Key of the group this one is inside. Inferred: Temporal records no
   * parent. A group is inside another when every step of it is also in the
   * other one, and the other one comes first in the groups of each step;
   * of several such groups, the innermost one.
   */
  parent?: string;
  /** Keys of the groups directly inside this one, in the order they started. */
  children: string[];
  /** Running while a step is open, Failed when a step failed, else Completed (or Canceled). */
  status: WorkflowNodeStatus;
  /** Start of the first step, ISO 8601. */
  startTime?: string;
  /** End of the last step, ISO 8601; left out while the group runs. */
  endTime?: string;
  /** Tokens of the model calls in the group; left out without any. */
  usage?: WorkflowLlmUsage;
  /** Model calls in the group; left out without any. */
  llmCalls?: number;
}
