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
import {
  isValidControlActionId,
  temporalPermissions,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalControlAction,
  temporalExtensionPoint,
  TemporalWorkflowEnricher,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-node';
import { DefaultTemporalAccessService } from './access/DefaultTemporalAccessService';
import { TemporalReadRepository } from './repositories/TemporalReadRepository';
import { createRouter } from './routes/router';
import { PayloadStore } from './repositories/PayloadStore';
import {
  readControlOptions,
  WorkflowController,
} from './services/WorkflowController';
import { WorkflowQueries } from './services/WorkflowQueries';

/**
 * Backend plugin for Temporal. Serves routes under `/api/temporal` that read
 * workflows and, checked with the permission framework, change them.
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
        config: coreServices.rootConfig,
        auditor: coreServices.auditor,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        catalog: catalogServiceRef,
        temporal: temporalServiceRef,
      },
      async init({
        logger,
        config,
        auditor,
        httpAuth,
        httpRouter,
        permissions,
        permissionsRegistry,
        catalog,
        temporal,
      }) {
        permissionsRegistry.addPermissions(temporalPermissions);
        for (const action of controlActions) {
          if (!isValidControlActionId(action.id)) {
            throw new Error(`Invalid control action id: ${action.id}`);
          }
        }
        const controlOptions = readControlOptions(config);
        if (!controlOptions.enabled) {
          logger.info('Temporal workflow controls are disabled');
        }
        // Layers: routes → access (permissions, catalog) → services (use
        // cases) → repositories (Temporal, S3).
        const queries = new WorkflowQueries(
          temporal,
          enrichers,
          logger,
          PayloadStore.fromConfig(config, logger),
          new TemporalReadRepository(temporal),
        );
        const access = new DefaultTemporalAccessService(
          permissions,
          catalog,
          queries,
        );
        const controller = new WorkflowController(temporal, controlOptions);
        httpRouter.use(
          await createRouter({
            httpAuth,
            access,
            queries,
            controls: {
              auditor,
              temporal,
              controller,
              actions: controlActions,
            },
          }),
        );
      },
    });
  },
});
