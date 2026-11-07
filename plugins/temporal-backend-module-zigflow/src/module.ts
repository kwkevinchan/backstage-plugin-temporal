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
import { createRouter } from './router';
import { DefinitionReader } from './service/definition';

/**
 * Module of the Temporal backend plugin for workflows written in the
 * Serverless Workflow DSL and run by Zigflow: serves the definition file of
 * a `TemporalWorkflow` entity (`spec.definition`) under
 * `/api/temporal/entities/:kind/:namespace/:name/definition`, for the
 * Definition tab of `@kwkevinchan/backstage-plugin-temporal-module-zigflow`.
 *
 * @public
 */
export const temporalModuleZigflow = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'zigflow',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        permissions: coreServices.permissions,
        urlReader: coreServices.urlReader,
        catalog: catalogServiceRef,
      },
      async init({
        logger,
        config,
        httpAuth,
        httpRouter,
        permissions,
        urlReader,
        catalog,
      }) {
        httpRouter.use(
          await createRouter({
            httpAuth,
            permissions,
            catalog,
            definitions: DefinitionReader.fromConfig(config, urlReader, logger),
          }),
        );
      },
    });
  },
});
