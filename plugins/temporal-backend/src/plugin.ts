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
import {
  isValidControlActionId,
  parseTemporalWorkflowResourceRef,
  temporalPermissions,
} from './common';
import { temporalExtensionPoint, TemporalWorkflowEnricher } from './node';
import { temporalServiceRef } from './node';
import {
  TemporalControlAction,
  temporalAccessServiceRef,
  temporalControlExtensionPoint,
  temporalWorkflowPermissionResourceRef,
} from './node/alpha';
import { temporalWorkflowPermissionRules } from './access/rules';
import { TemporalReadRepository } from './repositories/TemporalReadRepository';
import { createControlRouter } from './routes/controlRoutes';
import { createRouter } from './routes/router';
import { PayloadStore } from './repositories/PayloadStore';
import { AiWorkflowQueries } from './services/ai/AiWorkflowQueries';
import { EntityWorkflowSources } from './services/EntityWorkflowSources';
import { WorkflowListQueries } from './services/WorkflowListQueries';
import { WorkflowQueries } from './services/WorkflowQueries';
import {
  readControlOptions,
  WorkflowCommands,
} from './services/WorkflowCommands';

/**
 * Backend plugin for Temporal. Serves routes under `/api/temporal` that read
 * workflows and, unless `temporal.control.enabled` is false, the routes that
 * change them (start, signal, update, cancel, terminate, rerun, custom
 * actions and schedule operations). Every route is checked with the
 * permission framework; the operations are recorded with the auditor.
 *
 * @public
 */
export const temporalPlugin = createBackendPlugin({
  pluginId: 'temporal',
  register(env) {
    const enrichers: TemporalWorkflowEnricher[] = [];
    env.registerExtensionPoint(temporalExtensionPoint, {
      addWorkflowEnricher(enricher) {
        if (enrichers.some(e => e.id === enricher.id)) {
          throw new Error(`Duplicate workflow enricher id: ${enricher.id}`);
        }
        enrichers.push(enricher);
      },
    });
    // Registered whether or not the operations are enabled, so that the
    // modules that add actions start either way.
    const actions: TemporalControlAction[] = [];
    env.registerExtensionPoint(temporalControlExtensionPoint, {
      addControlAction(action) {
        if (actions.some(a => a.id === action.id)) {
          throw new Error(`Duplicate control action id: ${action.id}`);
        }
        actions.push(action);
      },
    });

    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        auditor: coreServices.auditor,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        permissionsRegistry: coreServices.permissionsRegistry,
        temporal: temporalServiceRef,
        access: temporalAccessServiceRef,
      },
      async init({
        logger,
        config,
        auditor,
        httpAuth,
        httpRouter,
        permissionsRegistry,
        temporal,
        access,
      }) {
        permissionsRegistry.addPermissions(temporalPermissions);
        const controlEnabled =
          config.getOptionalBoolean('temporal.control.enabled') ?? true;
        if (controlEnabled) {
          for (const action of actions) {
            if (!isValidControlActionId(action.id)) {
              throw new Error(`Invalid control action id: ${action.id}`);
            }
          }
          const commands = new WorkflowCommands(
            temporal,
            readControlOptions(config),
          );
          httpRouter.use(
            createControlRouter({
              httpAuth,
              access,
              auditor,
              temporal,
              commands,
              actions,
            }),
          );
        } else {
          for (const action of actions) {
            logger.warn(
              `Ignoring the control action ${action.id}: temporal.control.enabled is false, so the routes that change workflows are not served`,
            );
          }
        }
        // Layers: routes → access (permissions, catalog; shared with the
        // modules through temporalAccessServiceRef) → services (use cases)
        // → repositories (Temporal, S3).
        const temporalReads = new TemporalReadRepository(temporal);
        const aiWorkflows =
          config.getOptionalBoolean('temporal.experimental.aiWorkflows') ??
          false;
        const sources = new EntityWorkflowSources(temporal, logger);
        const queries = new WorkflowQueries(
          temporal,
          enrichers,
          logger,
          sources,
          PayloadStore.fromConfig(config, logger),
          temporalReads,
          { aiWorkflows },
        );
        const lists = new WorkflowListQueries(
          temporal,
          temporalReads,
          sources,
          queries,
        );
        const ai = new AiWorkflowQueries(temporalReads, logger, queries);
        // Workflows as a permission resource, for the list permissions.
        // Modules can add more rules (addPermissionRules).
        permissionsRegistry.addResourceType({
          resourceRef: temporalWorkflowPermissionResourceRef,
          rules: Object.values(temporalWorkflowPermissionRules),
          async getResources(resourceRefs) {
            return Promise.all(
              resourceRefs.map(async resourceRef => {
                const ref = parseTemporalWorkflowResourceRef(resourceRef);
                if (!ref) return undefined;
                return queries.describe(ref).catch(() => undefined);
              }),
            );
          },
        });
        httpRouter.use(
          await createRouter({
            httpAuth,
            auditor,
            access,
            sources,
            queries,
            lists,
            ai,
          }),
        );
      },
    });
  },
});
