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
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { TemporalPluginClient } from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import {
  createTemporalWorkflowSignalAction,
  createTemporalWorkflowStartAction,
  createTemporalWorkflowUpdateAction,
  createTemporalWorkflowWaitAction,
} from './actions';

/**
 * Scaffolder module with the Temporal template actions:
 * `temporal:workflow:start`, `temporal:workflow:wait`,
 * `temporal:workflow:signal` and `temporal:workflow:update`. They call the
 * Temporal backend plugin with the credentials of the task's initiator;
 * starting, signals and updates need its operations (`temporal.control.enabled`, on by default). `start`,
 * `signal` and `update` refuse a task that does not run as a user, unless
 * `temporal.scaffolder.allowServiceWrites` is true; `wait` only reads and
 * accepts any initiator.
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
        catalog: catalogServiceRef,
      },
      async init({ scaffolder, discovery, auth, config, catalog }) {
        const options = {
          client: new TemporalPluginClient(discovery, auth),
          auth,
          allowServiceWrites:
            config.getOptionalBoolean(
              'temporal.scaffolder.allowServiceWrites',
            ) ?? false,
          catalog,
          appBaseUrl: config.getString('app.baseUrl'),
          pagePath: config.getOptionalString('temporal.pagePath'),
          // As the Temporal backend plugin reads it.
          defaultNamespace:
            config.getOptionalString('temporal.connection.defaultNamespace') ??
            'default',
        };
        scaffolder.addActions(
          createTemporalWorkflowStartAction(options),
          createTemporalWorkflowWaitAction(options),
          createTemporalWorkflowSignalAction(options),
          createTemporalWorkflowUpdateAction(options),
        );
      },
    });
  },
});
