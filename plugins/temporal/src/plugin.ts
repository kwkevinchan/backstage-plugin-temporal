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
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { TemporalClient } from './api';
import { entityContentRouteRef } from './routes';

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
    entityContent: entityContentRouteRef,
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
