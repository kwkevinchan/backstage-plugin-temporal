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
import { isValidControlActionId, temporalPermissions } from './common';
import {
  TemporalControlAction,
  temporalExtensionPoint,
  TemporalWorkflowEnricher,
} from './extensions';
import { temporalServiceRef } from './service/TemporalService';
import { createRouter } from './router';
import { ExternalPayloads } from './service/payloads';
import { DefinitionReader } from './service/definition';
import {
  readControlOptions,
  WorkflowController,
} from './service/WorkflowController';
import { WorkflowReader } from './service/WorkflowReader';

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
        urlReader: coreServices.urlReader,
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
        urlReader,
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
        const reader = new WorkflowReader(
          temporal,
          enrichers,
          logger,
          ExternalPayloads.fromConfig(config, logger),
        );
        const controller = new WorkflowController(temporal, controlOptions);
        httpRouter.use(
          await createRouter({
            httpAuth,
            permissions,
            catalog,
            reader,
            definitions: DefinitionReader.fromConfig(config, urlReader, logger),
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
