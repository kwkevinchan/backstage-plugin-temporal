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
 * The default export installs everything with one `backend.add()`: the
 * plugin (the routes that read workflows and, unless
 * `temporal.control.enabled` is false, the routes that change them), the
 * default factory of its access service and the catalog module with the
 * `TemporalWorkflow` kind. The named exports are the same features one by
 * one, for a backend that leaves some out.
 *
 * Backend modules import the Temporal connection service and the extension
 * points from `./node` and `./alpha`, and the permissions, types and
 * annotation constants from `./common`.
 *
 * @packageDocumentation
 */

import { createBackendFeatureLoader } from '@backstage/backend-plugin-api';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { catalogModuleTemporalWorkflowKind } from './catalog';
import { temporalPlugin } from './plugin';

export { temporalPlugin } from './plugin';
export {
  catalogModuleTemporalWorkflowKind,
  TemporalWorkflowEntityProcessor,
} from './catalog';

/**
 * The Temporal backend plugin, the default factory of its access service
 * (`temporalAccessServiceRef`) and the catalog module with the
 * `TemporalWorkflow` kind.
 *
 * @public
 */
export default createBackendFeatureLoader({
  loader() {
    return [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogModuleTemporalWorkflowKind,
    ];
  },
});
