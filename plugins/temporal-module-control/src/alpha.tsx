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
 * Entry point for the new frontend system: the module (default export) with
 * the operations that change workflows, and the blueprint of buttons that
 * run custom backend actions.
 *
 * @packageDocumentation
 */

import { lazy, Suspense } from 'react';
import {
  ApiBlueprint,
  createExtensionBlueprint,
  createFrontendModule,
  discoveryApiRef,
  ExtensionBoundary,
  fetchApiRef,
} from '@backstage/frontend-plugin-api';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal';
import {
  TEMPORAL_WORKFLOW_EXTENSIONS_API_ID,
  temporalWorkflowActionDataRef,
  TemporalWorkflowActionBlueprint,
  TemporalWorkflowListActionBlueprint,
} from '@kwkevinchan/backstage-plugin-temporal/alpha';
import {
  isTemporalWorkflowEntity,
  WorkflowDetail,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { TemporalControlClient, temporalControlApiRef } from './api';
import type { TemporalControlActionButton } from './components/ControlActionButton';

const LazyControlActionButton = lazy(() =>
  import('./components/ControlActionButton').then(m => ({
    default: m.ControlActionButton,
  })),
);

/**
 * The client of the control routes (`api:temporal/control`).
 *
 * @alpha
 */
export const temporalControlApi = ApiBlueprint.make({
  name: 'control',
  params: defineParams =>
    defineParams({
      api: temporalControlApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new TemporalControlClient({ discoveryApi, fetchApi }),
    }),
});

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
      loader: () =>
        import('./components/WorkflowControls').then(m => m.WorkflowControls),
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
      loader: () =>
        import('./components/StartWorkflow').then(m => m.StartWorkflowButton),
      filter: ({ entity }) => !entity || isTemporalWorkflowEntity(entity),
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
    params: TemporalControlActionButton & {
      filter?: (workflow: WorkflowDetail) => boolean;
    },
    { node },
  ) {
    const { filter, ...action } = params;
    yield temporalWorkflowActionDataRef({
      id: node.spec.id,
      component: (props: TemporalWorkflowExtensionProps) => (
        <ExtensionBoundary node={node}>
          <Suspense fallback={null}>
            <LazyControlActionButton {...props} action={action} />
          </Suspense>
        </ExtensionBoundary>
      ),
      filter,
    });
  },
});

/**
 * The control module of the Temporal plugin for the new frontend system:
 * the operations that change workflows. Needs the backend control module,
 * `@kwkevinchan/backstage-plugin-temporal-backend-module-control`.
 *
 * @alpha
 */
export default createFrontendModule({
  pluginId: 'temporal',
  extensions: [
    temporalControlApi,
    temporalWorkflowControlsAction,
    temporalStartWorkflowListAction,
  ],
});
