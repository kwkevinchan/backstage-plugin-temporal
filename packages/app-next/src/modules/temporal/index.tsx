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
import { TemporalWorkflowActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-react/alpha';

/** Example workflow action, added through the temporal-react blueprint. */
const copyWorkflowIdAction = TemporalWorkflowActionBlueprint.make({
  name: 'copy-workflow-id',
  params: {
    loader: () =>
      import('./CopyWorkflowIdAction').then(m => m.CopyWorkflowIdAction),
  },
});

export const temporalExtrasModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [copyWorkflowIdAction],
});
