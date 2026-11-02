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

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  temporalExtensionPoint,
  temporalWorkflowUpdatePermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend';

/**
 * Example custom workflow action: "Escalate" on a running ticket workflow
 * (packages/example-worker) raises its priority with the `setPriority`
 * update and adds a note with the user who escalated it. The frontend apps
 * show it as a button on the workflow details page.
 */
export const escalateActionModule = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'example-escalate-action',
  register(reg) {
    reg.registerInit({
      deps: { temporal: temporalExtensionPoint },
      async init({ temporal }) {
        temporal.addControlAction({
          id: 'escalate',
          permission: temporalWorkflowUpdatePermission,
          filter: workflow =>
            workflow.workflowType === 'ticketWorkflow' &&
            workflow.status === 'Running',
          async handle(ref, _body, { client, credentials }) {
            const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
            const principal = credentials.principal as {
              userEntityRef?: string;
            };
            const result = await handle.executeUpdate('setPriority', {
              args: ['high'],
            });
            await handle.signal(
              'addNote',
              `Escalated by ${principal.userEntityRef ?? 'a service'}`,
            );
            return result as { previous: string; priority: string };
          },
        });
      },
    });
  },
});
