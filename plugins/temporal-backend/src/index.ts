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
 * Unofficial Backstage backend plugin for Temporal workflows.
 *
 * The package exports only the plugin. Modules use
 * `@kwkevinchan/backstage-plugin-temporal-node` (the Temporal client service
 * and the extension point) and `@kwkevinchan/backstage-plugin-temporal-common`
 * (permissions, types and annotation constants).
 *
 * @packageDocumentation
 */

import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';

/**
 * The Temporal backend plugin, with the default factory of its access
 * service (`temporalAccessServiceRef`).
 *
 * @public
 */
export default createBackendFeatureLoader({
  loader() {
    return [temporalPlugin, temporalAccessServiceFactory];
  },
});
