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

import {
  createApiFactory,
  createComponentExtension,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { temporalApiRef } from './extensions';
import { TemporalClient } from './api';
import {
  definitionContentRouteRef,
  entityContentRouteRef,
  rootRouteRef,
} from './routes';

/**
 * The Temporal plugin for the legacy frontend system.
 *
 * @public
 */
export const temporalPlugin = createPlugin({
  id: 'temporal',
  apis: [
    createApiFactory({
      api: temporalApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new TemporalClient({ discoveryApi, fetchApi }),
    }),
  ],
  routes: {
    root: rootRouteRef,
    entityContent: entityContentRouteRef,
    definitionContent: definitionContentRouteRef,
  },
});

/**
 * Entity tab with the entity's Temporal workflows and the workflow details.
 * Pass `workflowActions` and `workflowSections` to extend the details page.
 *
 * @public
 */
export const EntityTemporalContent = temporalPlugin.provide(
  createRoutableExtension({
    name: 'EntityTemporalContent',
    component: () =>
      import('./components/EntityTemporalContent').then(
        m => m.EntityTemporalContentPage,
      ),
    mountPoint: entityContentRouteRef,
  }),
);

/**
 * Definition tab of `TemporalWorkflow` entities: the YAML of a workflow
 * written in the Serverless Workflow DSL (`spec.definition`) next to its
 * graph, optionally with one run on top. Workflows written in code get
 * links to their source. Mount it on `/definition` of the
 * `TemporalWorkflow` entity page.
 *
 * @public
 */
export const EntityTemporalDefinitionContent = temporalPlugin.provide(
  createRoutableExtension({
    name: 'EntityTemporalDefinitionContent',
    component: () =>
      import('./components/definition/DefinitionContent').then(
        m => m.EntityTemporalDefinitionContentPage,
      ),
    mountPoint: definitionContentRouteRef,
  }),
);

/**
 * Workflows page: every workflow of the default namespace, with filters,
 * and the workflow details. Needs the `temporal.workflow.list` permission.
 * Mount it on `/temporal` and add a sidebar item.
 *
 * @public
 */
export const TemporalPage = temporalPlugin.provide(
  createRoutableExtension({
    name: 'TemporalPage',
    component: () =>
      import('./components/TemporalPage').then(m => m.TemporalPageWithHeader),
    mountPoint: rootRouteRef,
  }),
);

/**
 * Card with the workflow type, task queue, namespace, owner, system and users
 * of a `TemporalWorkflow` entity, with a link to the Temporal UI.
 *
 * @public
 */
export const EntityTemporalWorkflowSummaryCard = temporalPlugin.provide(
  createComponentExtension({
    name: 'EntityTemporalWorkflowSummaryCard',
    component: {
      lazy: () =>
        import('./components/TemporalWorkflowSummaryCard').then(
          m => m.TemporalWorkflowSummaryCard,
        ),
    },
  }),
);

/**
 * Card with succeeded, failed and running counts and the mean duration of an
 * entity's most recent runs.
 *
 * @public
 */
export const EntityTemporalWorkflowStatsCard = temporalPlugin.provide(
  createComponentExtension({
    name: 'EntityTemporalWorkflowStatsCard',
    component: {
      lazy: () =>
        import('./components/TemporalWorkflowStatsCard').then(
          m => m.TemporalWorkflowStatsCard,
        ),
    },
  }),
);

/**
 * Card with the `TemporalWorkflow` entities an entity depends on.
 *
 * @public
 */
export const EntityTemporalRelatedWorkflowsCard = temporalPlugin.provide(
  createComponentExtension({
    name: 'EntityTemporalRelatedWorkflowsCard',
    component: {
      lazy: () =>
        import('./components/TemporalRelatedWorkflowsCard').then(
          m => m.TemporalRelatedWorkflowsCard,
        ),
    },
  }),
);
