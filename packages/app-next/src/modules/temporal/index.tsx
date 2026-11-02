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

import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { TemporalWorkflowActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal/alpha';

/** Example workflow action, added through the blueprint of the Temporal plugin. */
const copyWorkflowIdAction = TemporalWorkflowActionBlueprint.make({
  name: 'copy-workflow-id',
  params: {
    loader: () =>
      import('./CopyWorkflowIdAction').then(m => m.CopyWorkflowIdAction),
  },
});

/**
 * Example button that runs the example backend action
 * (packages/backend/src/escalateAction.ts) on running ticket workflows.
 */
const escalateAction = TemporalWorkflowActionBlueprint.make({
  name: 'escalate',
  params: {
    controlAction: {
      actionId: 'escalate',
      label: 'Escalate',
      confirm: 'Raise the priority of this ticket to high?',
    },
    filter: workflow =>
      workflow.workflowType === 'ticketWorkflow' &&
      workflow.status === 'Running',
  },
});

export const temporalExtrasModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [copyWorkflowIdAction, escalateAction],
});
