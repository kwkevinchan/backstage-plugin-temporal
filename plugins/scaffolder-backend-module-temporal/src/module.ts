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
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import {
  createTemporalWorkflowSignalAction,
  createTemporalWorkflowStartAction,
  createTemporalWorkflowWaitAction,
} from './actions';
import { TemporalPluginClient } from './client';

/**
 * Scaffolder module with the Temporal template actions:
 * `temporal:workflow:start`, `temporal:workflow:wait` and
 * `temporal:workflow:signal`. They call the Temporal backend plugin as the
 * user who runs the template; starting, signals and updates need its
 * control module.
 *
 * @public
 */
export const scaffolderTemporalModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'temporal',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        config: coreServices.rootConfig,
      },
      async init({ scaffolder, discovery, auth, config }) {
        const options = {
          client: new TemporalPluginClient(discovery, auth),
          appBaseUrl: config.getString('app.baseUrl'),
        };
        scaffolder.addActions(
          createTemporalWorkflowStartAction(options),
          createTemporalWorkflowWaitAction(options),
          createTemporalWorkflowSignalAction(options),
        );
      },
    });
  },
});
