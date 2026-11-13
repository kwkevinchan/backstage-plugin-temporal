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
import type { Entity } from '@backstage/catalog-model';
import {
  createExtensionBlueprint,
  createExtensionDataRef,
  ExtensionBoundary,
} from '@backstage/frontend-plugin-api';
import type { TemporalSchedule, WorkflowDetail } from '../common';
import type {
  TemporalWorkflowActionDef,
  TemporalWorkflowExtensionProps,
  TemporalScheduleActionDef,
  TemporalScheduleActionProps,
  TemporalWorkflowListActionDef,
  TemporalWorkflowListActionProps,
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
 * Extension data with a workflow list action.
 *
 * @alpha
 */
export const temporalWorkflowListActionDataRef =
  createExtensionDataRef<TemporalWorkflowListActionDef>().with({
    id: 'temporal.workflow-list-action',
  });

/**
 * Extension data with a schedule action.
 *
 * @alpha
 */
export const temporalScheduleActionDataRef =
  createExtensionDataRef<TemporalScheduleActionDef>().with({
    id: 'temporal.schedule-action',
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

type Loader<P> = () => Promise<ComponentType<P>>;

export function lazyComponent<P extends object>(
  node: Parameters<typeof ExtensionBoundary>[0]['node'],
  loader: Loader<P>,
): ComponentType<P> {
  // Typed loosely: React cannot check the props of a generic lazy component.
  const Lazy = lazy<ComponentType<any>>(() =>
    loader().then(component => ({ default: component })),
  );
  return (props: P) => (
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
 * A button that runs a custom action of the backend comes from
 * `TemporalControlActionBlueprint`.
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
      loader: Loader<TemporalWorkflowExtensionProps>;
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
 * Adds a control above the workflow lists: the list of an entity and the
 * Workflows page. `filter` gets the entity, absent on the Workflows page.
 *
 * @example
 * ```tsx
 * TemporalWorkflowListActionBlueprint.make({
 *   name: 'export',
 *   params: {
 *     loader: () => import('./ExportButton').then(m => m.ExportButton),
 *     filter: ({ entity }) => entity !== undefined,
 *   },
 * });
 * ```
 *
 * @alpha
 */
export const TemporalWorkflowListActionBlueprint = createExtensionBlueprint({
  kind: 'temporal-workflow-list-action',
  attachTo: { id: ATTACH_ID, input: 'listActions' },
  output: [temporalWorkflowListActionDataRef],
  dataRefs: { listAction: temporalWorkflowListActionDataRef },
  *factory(
    params: {
      /** Loads the control to show. */
      loader: Loader<TemporalWorkflowListActionProps>;
      filter?: (context: { entity?: Entity }) => boolean;
    },
    { node },
  ) {
    yield temporalWorkflowListActionDataRef({
      id: node.spec.id,
      component: lazyComponent(node, params.loader),
      filter: params.filter,
    });
  },
});

/**
 * Adds a control to each schedule of the schedule lists: the schedules of
 * an entity and of the Workflows page.
 *
 * @alpha
 */
export const TemporalScheduleActionBlueprint = createExtensionBlueprint({
  kind: 'temporal-schedule-action',
  attachTo: { id: ATTACH_ID, input: 'scheduleActions' },
  output: [temporalScheduleActionDataRef],
  dataRefs: { scheduleAction: temporalScheduleActionDataRef },
  *factory(
    params: {
      /** Loads the control to show. */
      loader: Loader<TemporalScheduleActionProps>;
      filter?: (schedule: TemporalSchedule) => boolean;
    },
    { node },
  ) {
    yield temporalScheduleActionDataRef({
      id: node.spec.id,
      component: lazyComponent(node, params.loader),
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
      loader: Loader<TemporalWorkflowExtensionProps>;
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
