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
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { TemporalPluginClient } from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { registerTemporalActions } from './actions';

/**
 * Module of the Temporal plugin that registers the actions
 * `temporal:list-workflows`, `temporal:get-workflow`,
 * `temporal:start-workflow`, `temporal:signal-workflow` and
 * `temporal:update-workflow` in the actions registry. They call the Temporal
 * backend plugin as the user who invokes the action, so its permission
 * checks and audit records apply; the actions that change workflows need
 * its operations (`temporal.control.enabled`, on by default). A service
 * principal is not a user: the Temporal backend does not apply permission
 * policies to it, and it can invoke the actions that change workflows only
 * with `temporal.actions.allowServiceWrites`. It is then recorded as
 * `plugin:temporal`.
 *
 * @public
 */
export const temporalActionsModule = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'actions',
  register(reg) {
    reg.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        config: coreServices.rootConfig,
        catalog: catalogServiceRef,
      },
      async init({ actionsRegistry, discovery, auth, config, catalog }) {
        registerTemporalActions(actionsRegistry, {
          client: new TemporalPluginClient(discovery, auth),
          auth,
          catalog,
          appBaseUrl: config.getString('app.baseUrl'),
          allowServiceWrites:
            config.getOptionalBoolean('temporal.actions.allowServiceWrites') ??
            false,
          // As the Temporal backend plugin reads it.
          defaultNamespace:
            config.getOptionalString('temporal.connection.defaultNamespace') ??
            'default',
        });
      },
    });
  },
});
