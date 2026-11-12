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
import { isValidControlActionId } from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  TemporalControlAction,
  temporalAccessServiceRef,
  temporalControlExtensionPoint,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import { createControlRouter } from './routes/controlRoutes';
import {
  readControlOptions,
  WorkflowCommands,
} from './services/WorkflowCommands';

/**
 * Module of the Temporal backend plugin that changes workflows: start,
 * signal, update, cancel, terminate, rerun and custom actions. Without it
 * the plugin only reads. Each operation is checked with the permission
 * framework through the plugin's access service and recorded with the
 * auditor.
 *
 * @public
 */
export const temporalModuleControl = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'control',
  register(reg) {
    const actions: TemporalControlAction[] = [];
    reg.registerExtensionPoint(temporalControlExtensionPoint, {
      addControlAction(action) {
        if (actions.some(a => a.id === action.id)) {
          throw new Error(`Duplicate control action id: ${action.id}`);
        }
        actions.push(action);
      },
    });
    reg.registerInit({
      deps: {
        config: coreServices.rootConfig,
        auditor: coreServices.auditor,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        access: temporalAccessServiceRef,
        temporal: temporalServiceRef,
      },
      async init({ config, auditor, httpAuth, httpRouter, access, temporal }) {
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
      },
    });
  },
});
