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
  parseTemporalWorkflowResourceRef,
  temporalPermissions,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  temporalExtensionPoint,
  TemporalWorkflowEnricher,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  temporalAccessServiceRef,
  temporalWorkflowPermissionResourceRef,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import { temporalWorkflowPermissionRules } from './access/rules';
import { TemporalReadRepository } from './repositories/TemporalReadRepository';
import { createRouter } from './routes/router';
import { PayloadStore } from './repositories/PayloadStore';
import { AiWorkflowQueries } from './services/AiWorkflowQueries';
import { EntityWorkflowSources } from './services/EntityWorkflowSources';
import { WorkflowListQueries } from './services/WorkflowListQueries';
import { WorkflowQueries } from './services/WorkflowQueries';

/**
 * Backend plugin for Temporal. Serves routes under `/api/temporal` that read
 * workflows, checked with the permission framework. The control module
 * (`@kwkevinchan/backstage-plugin-temporal-backend-module-control`) adds the
 * routes that change them.
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
        const ai = new AiWorkflowQueries(temporalReads, logger, queries, {
          aiWorkflows,
        });
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
