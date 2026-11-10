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

/**
 * Entry point for the new frontend system: a module of the Scaffolder with
 * the `TemporalWorkflowPicker` form field.
 *
 * @packageDocumentation
 */

import { createFrontendModule } from '@backstage/frontend-plugin-api';
import {
  createFormField,
  FormFieldBlueprint,
} from '@backstage/plugin-scaffolder-react/alpha';

/**
 * The `TemporalWorkflowPicker` form field.
 *
 * @alpha
 */
export const temporalWorkflowPickerFormField = FormFieldBlueprint.make({
  name: 'temporal-workflow-picker',
  params: {
    field: () =>
      import('./components/TemporalWorkflowPicker').then(m =>
        createFormField({
          name: 'TemporalWorkflowPicker',
          component: m.TemporalWorkflowPicker,
        }),
      ),
  },
});

/**
 * The Scaffolder module with the Temporal form fields.
 *
 * @alpha
 */
export default createFrontendModule({
  pluginId: 'scaffolder',
  extensions: [temporalWorkflowPickerFormField],
});
