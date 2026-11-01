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
 * Entry point for the new frontend system.
 *
 * @packageDocumentation
 */

import {
  compatWrapper,
  convertLegacyRouteRef,
  convertLegacyRouteRefs,
} from '@backstage/core-compat-api';
import {
  ApiBlueprint,
  createExtensionInput,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import AccountTreeIcon from '@material-ui/icons/AccountTree';
import {
  EntityCardBlueprint,
  EntityContentBlueprint,
} from '@backstage/plugin-catalog-react/alpha';
import {
  getDependsOnTemporalWorkflowRefs,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import {
  temporalWorkflowActionDataRef,
  temporalWorkflowSectionDataRef,
} from '@kwkevinchan/backstage-plugin-temporal-react/alpha';
import { TemporalClient } from './api';
import { entityContentRouteRef, rootRouteRef } from './routes';

/** @alpha */
export const temporalApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: temporalApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new TemporalClient({ discoveryApi, fetchApi }),
    }),
});

/**
 * Entity tab. Workflow actions and sections from
 * `TemporalWorkflowActionBlueprint` and `TemporalWorkflowSectionBlueprint`
 * attach to its `workflowActions` and `workflowSections` inputs.
 *
 * @alpha
 */
export const temporalEntityContent = EntityContentBlueprint.makeWithOverrides({
  inputs: {
    workflowActions: createExtensionInput([temporalWorkflowActionDataRef]),
    workflowSections: createExtensionInput([temporalWorkflowSectionDataRef]),
  },
  factory(originalFactory, { inputs }) {
    const workflowActions = inputs.workflowActions.map(i =>
      i.get(temporalWorkflowActionDataRef),
    );
    const workflowSections = inputs.workflowSections.map(i =>
      i.get(temporalWorkflowSectionDataRef),
    );
    return originalFactory({
      path: 'temporal',
      title: 'Temporal',
      routeRef: convertLegacyRouteRef(entityContentRouteRef),
      filter: isTemporalAvailable,
      loader: () =>
        import('./components/EntityTemporalContent').then(m =>
          compatWrapper(
            <m.EntityTemporalContentPage
              workflowActions={workflowActions}
              workflowSections={workflowSections}
            />,
          ),
        ),
    });
  },
});

/**
 * Workflows page on `/temporal`. Its title and icon make the app list it in
 * the sidebar. Workflow actions and sections from the blueprints attach to
 * the entity tab only.
 *
 * @alpha
 */
export const temporalPage = PageBlueprint.make({
  params: {
    path: '/temporal',
    title: 'Workflows',
    icon: <AccountTreeIcon fontSize="inherit" />,
    routeRef: convertLegacyRouteRef(rootRouteRef),
    loader: () =>
      import('./components/TemporalPage').then(m =>
        compatWrapper(<m.TemporalPageContent />),
      ),
  },
});

/**
 * Summary card on the overview of `TemporalWorkflow` entities.
 *
 * @alpha
 */
export const temporalWorkflowSummaryCard = EntityCardBlueprint.make({
  name: 'workflow-summary',
  params: {
    filter: isTemporalWorkflowEntity,
    loader: () =>
      import('./components/TemporalWorkflowSummaryCard').then(m =>
        compatWrapper(<m.TemporalWorkflowSummaryCard />),
      ),
  },
});

/**
 * Card with the `TemporalWorkflow` entities an entity depends on, on the
 * overview of entities that have any.
 *
 * @alpha
 */
export const temporalRelatedWorkflowsCard = EntityCardBlueprint.make({
  name: 'related-workflows',
  params: {
    filter: entity => getDependsOnTemporalWorkflowRefs(entity).length > 0,
    loader: () =>
      import('./components/TemporalRelatedWorkflowsCard').then(m =>
        compatWrapper(<m.TemporalRelatedWorkflowsCard />),
      ),
  },
});

/**
 * The Temporal plugin for the new frontend system.
 *
 * @alpha
 */
export default createFrontendPlugin({
  pluginId: 'temporal',
  extensions: [
    temporalApi,
    temporalPage,
    temporalEntityContent,
    temporalWorkflowSummaryCard,
    temporalRelatedWorkflowsCard,
  ],
  routes: convertLegacyRouteRefs({
    root: rootRouteRef,
    entityContent: entityContentRouteRef,
  }),
});
