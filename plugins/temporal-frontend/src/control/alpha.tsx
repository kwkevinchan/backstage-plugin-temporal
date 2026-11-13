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

// The extensions of the operations that change workflows, for the new
// frontend system, and the blueprint of buttons that run custom backend
// actions. `../alpha` adds them to the plugin and exports them.

import { createExtensionBlueprint } from '@backstage/frontend-plugin-api';
import type { TemporalWorkflowExtensionProps } from '../extensions';
import {
  lazyComponent,
  TEMPORAL_WORKFLOW_EXTENSIONS_API_ID,
  temporalWorkflowActionDataRef,
  TemporalWorkflowActionBlueprint,
  TemporalScheduleActionBlueprint,
  TemporalWorkflowListActionBlueprint,
} from '../extensions/blueprints';
import { isTemporalWorkflowEntity, WorkflowDetail } from '../common';
import type { TemporalControlActionButtonOptions } from './ControlActionButton';

/**
 * Signal, Update, Cancel and Terminate (running workflows) and Rerun
 * (closed ones) in the action bar of the workflow details page.
 *
 * @alpha
 */
export const temporalWorkflowControlsAction =
  TemporalWorkflowActionBlueprint.make({
    name: 'controls',
    params: {
      loader: () => import('./WorkflowControls').then(m => m.WorkflowControls),
    },
  });

/**
 * "Start workflow" above the list of a `TemporalWorkflow` entity and on the
 * Workflows page.
 *
 * @alpha
 */
export const temporalStartWorkflowListAction =
  TemporalWorkflowListActionBlueprint.make({
    name: 'start',
    params: {
      loader: () => import('./StartWorkflow').then(m => m.StartWorkflowButton),
      filter: ({ entity }) => !entity || isTemporalWorkflowEntity(entity),
    },
  });

/**
 * Pause or resume, and run now, on each schedule.
 *
 * @alpha
 */
export const temporalScheduleControlsAction =
  TemporalScheduleActionBlueprint.make({
    name: 'controls',
    params: {
      loader: () => import('./ScheduleControls').then(m => m.ScheduleControls),
    },
  });

/**
 * Adds a button to the action bar of the workflow details page that runs a
 * custom action of the backend (added with
 * `temporalControlExtensionPoint.addControlAction()`) and shows its result.
 *
 * @example
 * ```tsx
 * TemporalControlActionBlueprint.make({
 *   name: 'escalate',
 *   params: {
 *     actionId: 'escalate',
 *     label: 'Escalate',
 *     confirm: 'Raise the priority of this ticket?',
 *     filter: workflow => workflow.status === 'Running',
 *   },
 * });
 * ```
 *
 * @alpha
 */
export const TemporalControlActionBlueprint = createExtensionBlueprint({
  kind: 'temporal-control-action',
  attachTo: { id: TEMPORAL_WORKFLOW_EXTENSIONS_API_ID, input: 'actions' },
  output: [temporalWorkflowActionDataRef],
  *factory(
    params: TemporalControlActionButtonOptions & {
      filter?: (workflow: WorkflowDetail) => boolean;
    },
    { node },
  ) {
    const { filter, ...action } = params;
    yield temporalWorkflowActionDataRef({
      id: node.spec.id,
      component: lazyComponent<TemporalWorkflowExtensionProps>(node, () =>
        import('./ControlActionButton').then(
          m => (props: TemporalWorkflowExtensionProps) =>
            <m.ControlActionButton {...props} action={action} />,
        ),
      ),
      filter,
    });
  },
});
