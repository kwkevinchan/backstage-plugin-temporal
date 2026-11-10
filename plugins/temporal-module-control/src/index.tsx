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

/**
 * Operations that change Temporal workflows for the unofficial Backstage
 * Temporal plugin: start, signal, update, cancel, terminate, rerun and
 * buttons for custom backend actions. This entry point is for the legacy
 * frontend system and has the API; the new frontend system installs
 * `./alpha`.
 *
 * @packageDocumentation
 */

import {
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import type {
  TemporalWorkflowActionDef,
  TemporalWorkflowListActionDef,
} from '@kwkevinchan/backstage-plugin-temporal';
import {
  isTemporalWorkflowEntity,
  WorkflowDetail,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { TemporalControlClient, temporalControlApiRef } from './api';
import {
  ControlActionButton,
  TemporalControlActionButton,
} from './components/ControlActionButton';
import { StartWorkflowButton } from './components/StartWorkflow';
import { WorkflowControls } from './components/WorkflowControls';

export { TemporalControlClient, temporalControlApiRef } from './api';
export type { TemporalControlApi } from './api';
export type { TemporalControlActionButton } from './components/ControlActionButton';

/**
 * Factory of {@link TemporalControlApi} for the `apis` of a legacy app.
 *
 * @public
 */
export const temporalControlApiFactory = createApiFactory({
  api: temporalControlApiRef,
  deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
  factory: ({ discoveryApi, fetchApi }) =>
    new TemporalControlClient({ discoveryApi, fetchApi }),
});

/**
 * Signal, Update, Cancel, Terminate and Rerun, for the `workflowActions`
 * prop of `EntityTemporalContent` and `TemporalPage` (legacy frontend
 * system).
 *
 * @public
 */
export const temporalControlWorkflowActions: TemporalWorkflowActionDef[] = [
  { id: 'temporal-controls', component: WorkflowControls },
];

/**
 * "Start workflow", for the `workflowListActions` prop of
 * `EntityTemporalContent` and `TemporalPage` (legacy frontend system).
 *
 * @public
 */
export const temporalControlListActions: TemporalWorkflowListActionDef[] = [
  {
    id: 'temporal-start',
    component: StartWorkflowButton,
    filter: ({ entity }) => !entity || isTemporalWorkflowEntity(entity),
  },
];

/**
 * A workflow action with a button that runs a custom action of the backend
 * (legacy frontend system; the new one uses `TemporalControlActionBlueprint`
 * of `./alpha`).
 *
 * @public
 */
export function createTemporalControlActionDef(
  options: TemporalControlActionButton & {
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
