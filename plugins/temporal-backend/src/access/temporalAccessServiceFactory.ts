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
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  temporalAccessServiceRef,
  temporalWorkflowPermissionResourceRef,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import { WorkflowQueries } from '../services/WorkflowQueries';
import { DefaultTemporalAccessService } from './DefaultTemporalAccessService';

/**
 * The default factory of `temporalAccessServiceRef`. It is installed with
 * the plugin (the package's default export); a backend that wants other
 * access rules adds its own factory for the ref instead.
 *
 * The service is built from Backstage services only, not from anything the
 * plugin sets up in its init, because modules can start before the plugin.
 *
 * @alpha
 */
export const temporalAccessServiceFactory = createServiceFactory({
  service: temporalAccessServiceRef,
  deps: {
    logger: coreServices.logger,
    permissions: coreServices.permissions,
    permissionsRegistry: coreServices.permissionsRegistry,
    catalog: catalogServiceRef,
    temporal: temporalServiceRef,
  },
  factory({ logger, permissions, permissionsRegistry, catalog, temporal }) {
    // The access checks only need the workflow's status and search
    // attributes: no enrichers, and no S3 client (a memo stored in External
    // Storage is not resolved here). The routes answer with the plugin's own
    // WorkflowQueries.
    const queries = new WorkflowQueries(temporal, [], logger);
    return new DefaultTemporalAccessService(permissions, catalog, queries, () =>
      permissionsRegistry.getPermissionRuleset(
        temporalWorkflowPermissionResourceRef,
      ),
    );
  },
});
