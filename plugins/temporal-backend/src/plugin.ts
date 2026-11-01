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
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { temporalPermissions } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalControlAction,
  temporalExtensionPoint,
  temporalServiceRef,
  TemporalWorkflowEnricher,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import { createRouter } from './router';
import { WorkflowReader } from './service/WorkflowReader';

/**
 * Backend plugin for Temporal. Serves read-only routes under `/api/temporal`.
 *
 * @public
 */
export const temporalPlugin = createBackendPlugin({
  pluginId: 'temporal',
  register(env) {
    const enrichers: TemporalWorkflowEnricher[] = [];
    const controlActions: TemporalControlAction[] = [];
    env.registerExtensionPoint(temporalExtensionPoint, {
      addWorkflowEnricher(enricher) {
        if (enrichers.some(e => e.id === enricher.id)) {
          throw new Error(`Duplicate workflow enricher id: ${enricher.id}`);
        }
        enrichers.push(enricher);
      },
      addControlAction(action) {
        if (controlActions.some(a => a.id === action.id)) {
          throw new Error(`Duplicate control action id: ${action.id}`);
        }
        controlActions.push(action);
      },
    });

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        catalog: catalogServiceRef,
        temporal: temporalServiceRef,
      },
      async init({
        logger,
        httpAuth,
        httpRouter,
        permissions,
        permissionsRegistry,
        catalog,
        temporal,
      }) {
        permissionsRegistry.addPermissions(temporalPermissions);
        if (controlActions.length > 0) {
          logger.warn(
            `${controlActions.length} Temporal control action(s) registered; control routes are not served by this version`,
          );
        }
        const reader = new WorkflowReader(temporal, enrichers, logger);
        httpRouter.use(
          await createRouter({ httpAuth, permissions, catalog, reader }),
        );
      },
    });
  },
});
