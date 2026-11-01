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
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { rootRouteRef } from './routes';

/** @alpha */
export const temporalPage = PageBlueprint.make({
  params: {
    path: '/temporal',
    routeRef: convertLegacyRouteRef(rootRouteRef),
    loader: () =>
      import('./components/ExampleComponent').then(m =>
        compatWrapper(<m.ExampleComponent />),
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
  extensions: [temporalPage],
  routes: convertLegacyRouteRefs({
    root: rootRouteRef,
  }),
});
