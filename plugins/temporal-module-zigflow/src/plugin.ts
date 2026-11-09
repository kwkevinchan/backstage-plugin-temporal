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

import { createComponentExtension } from '@backstage/core-plugin-api';
import { temporalPlugin } from '@kwkevinchan/backstage-plugin-temporal';

/**
 * Definition tab of `TemporalWorkflow` entities for the legacy frontend
 * system: the YAML of a workflow written in the Serverless Workflow DSL
 * (`spec.definition`) next to its graph, optionally with one run on top.
 * Workflows written in code get links to their source. Mount it on
 * `/definition` of the `TemporalWorkflow` entity page.
 *
 * @public
 */
export const EntityTemporalDefinitionContent = temporalPlugin.provide(
  createComponentExtension({
    name: 'EntityTemporalDefinitionContent',
    component: {
      lazy: () =>
        import('./components/definition/DefinitionContent').then(
          m => m.EntityTemporalDefinitionContentPage,
        ),
    },
  }),
);
