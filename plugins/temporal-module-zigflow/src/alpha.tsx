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
 * Entry point for the new frontend system: a module of the Temporal plugin
 * (default export) with the Definition tab of `TemporalWorkflow` entities.
 *
 * @packageDocumentation
 */

import { compatWrapper } from '@backstage/core-compat-api';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { isTemporalWorkflowEntity } from '@kwkevinchan/backstage-plugin-temporal-frontend/common';

/**
 * Definition tab of `TemporalWorkflow` entities
 * (`entity-content:temporal/definition`): the YAML of a workflow written in
 * the Serverless Workflow DSL next to its graph, with one run on top; links
 * to the source for workflows written in code.
 *
 * @alpha
 */
export const temporalDefinitionContent = EntityContentBlueprint.make({
  name: 'definition',
  params: {
    path: 'definition',
    title: 'Definition',
    filter: isTemporalWorkflowEntity,
    loader: () =>
      import('./components/definition/DefinitionContent').then(m =>
        compatWrapper(<m.EntityTemporalDefinitionContentPage />),
      ),
  },
});

/**
 * Module of the Temporal plugin (`@kwkevinchan/backstage-plugin-temporal/alpha`)
 * for the new frontend system: adds the Definition tab.
 *
 * @alpha
 */
export default createFrontendModule({
  pluginId: 'temporal',
  extensions: [temporalDefinitionContent],
});
