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

import { ComponentType, lazy, Suspense } from 'react';
import {
  createExtensionBlueprint,
  createExtensionDataRef,
  ExtensionBoundary,
} from '@backstage/frontend-plugin-api';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import type {
  TemporalControlActionButton,
  TemporalWorkflowActionDef,
  TemporalWorkflowExtensionProps,
  TemporalWorkflowSectionDef,
} from './extensions';

/**
 * Extension data with a workflow action.
 *
 * @alpha
 */
export const temporalWorkflowActionDataRef =
  createExtensionDataRef<TemporalWorkflowActionDef>().with({
    id: 'temporal.workflow-action',
  });

/**
 * Extension data with a workflow section.
 *
 * @alpha
 */
export const temporalWorkflowSectionDataRef =
  createExtensionDataRef<TemporalWorkflowSectionDef>().with({
    id: 'temporal.workflow-section',
  });

/**
 * The workflow extensions API of the Temporal plugin collects the
 * extensions; the entity tab and the Workflows page both read it.
 *
 * @alpha
 */
export const TEMPORAL_WORKFLOW_EXTENSIONS_API_ID =
  'api:temporal/workflow-extensions';
const ATTACH_ID = TEMPORAL_WORKFLOW_EXTENSIONS_API_ID;

type Loader = () => Promise<ComponentType<TemporalWorkflowExtensionProps>>;

function lazyComponent(
  node: Parameters<typeof ExtensionBoundary>[0]['node'],
  loader: Loader,
): ComponentType<TemporalWorkflowExtensionProps> {
  const Lazy = lazy(() => loader().then(component => ({ default: component })));
  return (props: TemporalWorkflowExtensionProps) => (
    <ExtensionBoundary node={node}>
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    </ExtensionBoundary>
  );
}

/**
 * Adds a control to the action bar of the workflow details page.
 *
 * @example
 * ```tsx
 * TemporalWorkflowActionBlueprint.make({
 *   name: 'approve',
 *   params: {
 *     loader: () => import('./ApproveButton').then(m => m.ApproveButton),
 *     filter: workflow => workflow.status === 'Running',
 *   },
 * });
 *
 * // A button that runs a custom action of the backend.
 * TemporalWorkflowActionBlueprint.make({
 *   name: 'escalate',
 *   params: {
 *     controlAction: { actionId: 'escalate', label: 'Escalate' },
 *     filter: workflow => workflow.status === 'Running',
 *   },
 * });
 * ```
 *
 * @alpha
 */
export const TemporalWorkflowActionBlueprint = createExtensionBlueprint({
  kind: 'temporal-workflow-action',
  attachTo: { id: ATTACH_ID, input: 'actions' },
  output: [temporalWorkflowActionDataRef],
  dataRefs: { action: temporalWorkflowActionDataRef },
  *factory(
    params: {
      /** Loads the control to show. */
      loader?: Loader;
      /** Instead of `loader`: a button that runs a custom backend action. */
      controlAction?: TemporalControlActionButton;
      filter?: (workflow: WorkflowDetail) => boolean;
    },
    { node },
  ) {
    if (!params.loader && !params.controlAction) {
      throw new Error(
        `${node.spec.id}: a workflow action needs a loader or a controlAction`,
      );
    }
    yield temporalWorkflowActionDataRef({
      id: node.spec.id,
      component: params.loader ? lazyComponent(node, params.loader) : undefined,
      controlAction: params.controlAction,
      filter: params.filter,
    });
  },
});

/**
 * Adds a tab to the workflow details page, next to Steps, Events and
 * Details.
 *
 * @alpha
 */
export const TemporalWorkflowSectionBlueprint = createExtensionBlueprint({
  kind: 'temporal-workflow-section',
  attachTo: { id: ATTACH_ID, input: 'sections' },
  output: [temporalWorkflowSectionDataRef],
  dataRefs: { section: temporalWorkflowSectionDataRef },
  *factory(
    params: {
      title?: string;
      loader: Loader;
      filter?: (workflow: WorkflowDetail) => boolean;
    },
    { node },
  ) {
    yield temporalWorkflowSectionDataRef({
      id: node.spec.id,
      title: params.title,
      component: lazyComponent(node, params.loader),
      filter: params.filter,
    });
  },
});
