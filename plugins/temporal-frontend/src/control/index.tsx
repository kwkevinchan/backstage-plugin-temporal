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

// The operations that change workflows for the legacy frontend system:
// start, signal, update, cancel, terminate, rerun and buttons for custom
// backend actions. The new frontend system gets them from `./alpha.tsx`.

import { useMemo } from 'react';
import type {
  TemporalWorkflowActionDef,
  TemporalScheduleActionDef,
  TemporalWorkflowListActionDef,
} from '../extensions';
import { isTemporalWorkflowEntity, WorkflowDetail } from '../common';
import {
  ControlActionButton,
  TemporalControlActionButtonOptions,
} from './ControlActionButton';
import { ScheduleControls } from './ScheduleControls';
import { StartWorkflowButton } from './StartWorkflow';
import { WorkflowControls } from './WorkflowControls';
import { useControlEnabled } from './config';

export type { TemporalControlActionButtonOptions } from './ControlActionButton';

/** Signal, Update, Cancel, Terminate and Rerun on the details page. */
export const temporalControlWorkflowActions: TemporalWorkflowActionDef[] = [
  { id: 'temporal-controls', component: WorkflowControls },
];

/** "Start workflow" above the workflow lists. */
export const temporalControlListActions: TemporalWorkflowListActionDef[] = [
  {
    id: 'temporal-start',
    component: StartWorkflowButton,
    filter: ({ entity }) => !entity || isTemporalWorkflowEntity(entity),
  },
];

/** Pause or resume, and run now, on each schedule. */
export const temporalControlScheduleActions: TemporalScheduleActionDef[] = [
  { id: 'temporal-schedule-controls', component: ScheduleControls },
];

/**
 * A workflow action with a button that runs a custom action of the backend
 * (legacy frontend system; the new one uses `TemporalControlActionBlueprint`
 * of `./alpha`).
 *
 * @public
 */
export function createTemporalControlActionDef(
  options: TemporalControlActionButtonOptions & {
    /** Defaults to the action ID. */
    id?: string;
    filter?: (workflow: WorkflowDetail) => boolean;
  },
): TemporalWorkflowActionDef {
  const { id, filter, ...action } = options;
  return {
    id: id ?? action.actionId,
    component: props => <ControlActionButton {...props} action={action} />,
    filter,
  };
}

/**
 * The props of `EntityTemporalContent` and `TemporalPage` with the
 * operations that change workflows first in each list of actions. The
 * buttons render nothing when `temporal.control.enabled` is false.
 */
export function withControls<
  P extends {
    workflowActions?: TemporalWorkflowActionDef[];
    workflowListActions?: TemporalWorkflowListActionDef[];
    scheduleActions?: TemporalScheduleActionDef[];
  },
>(props: P): P {
  return {
    ...props,
    workflowActions: [
      ...temporalControlWorkflowActions,
      ...(props.workflowActions ?? []),
    ],
    workflowListActions: [
      ...temporalControlListActions,
      ...(props.workflowListActions ?? []),
    ],
    scheduleActions: [
      ...temporalControlScheduleActions,
      ...(props.scheduleActions ?? []),
    ],
  };
}

/**
 * IDs of the schedule actions of the operations: the legacy definition
 * above and the extension `temporal-schedule-action:temporal/controls` of
 * the new frontend system (`./alpha.test.tsx` checks the ID against the
 * extension).
 */
export const SCHEDULE_CONTROL_IDS = new Set([
  ...temporalControlScheduleActions.map(a => a.id),
  'temporal-schedule-action:temporal/controls',
]);

/**
 * The schedule actions to show: without those of the operations when
 * `temporal.control.enabled` is false, so that a list with no other action
 * has no column for them.
 */
export function useShownScheduleActions(
  actions: TemporalScheduleActionDef[],
): TemporalScheduleActionDef[] {
  const enabled = useControlEnabled();
  return useMemo(
    () =>
      enabled ? actions : actions.filter(a => !SCHEDULE_CONTROL_IDS.has(a.id)),
    [enabled, actions],
  );
}
