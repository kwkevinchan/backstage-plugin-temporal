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

/** The entity content of the Temporal plugin collects the extensions. */
const ATTACH_ID = 'entity-content:temporal';

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
 * ```
 *
 * @alpha
 */
export const TemporalWorkflowActionBlueprint = createExtensionBlueprint({
  kind: 'temporal-workflow-action',
  attachTo: { id: ATTACH_ID, input: 'workflowActions' },
  output: [temporalWorkflowActionDataRef],
  dataRefs: { action: temporalWorkflowActionDataRef },
  *factory(
    params: {
      loader: Loader;
      filter?: (workflow: WorkflowDetail) => boolean;
    },
    { node },
  ) {
    yield temporalWorkflowActionDataRef({
      id: node.spec.id,
      component: lazyComponent(node, params.loader),
      filter: params.filter,
    });
  },
});

/**
 * Adds a card to the workflow details page, below the summary.
 *
 * @alpha
 */
export const TemporalWorkflowSectionBlueprint = createExtensionBlueprint({
  kind: 'temporal-workflow-section',
  attachTo: { id: ATTACH_ID, input: 'workflowSections' },
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
