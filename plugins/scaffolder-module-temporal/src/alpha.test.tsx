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

import { createExtensionTester } from '@backstage/frontend-test-utils';
import { FormFieldBlueprint } from '@backstage/plugin-scaffolder-react/alpha';
import scaffolderPlugin from '@backstage/plugin-scaffolder/alpha';
import { ApiBlueprint } from '@backstage/frontend-plugin-api';
import scaffolderTemporalModule, {
  temporalWorkflowPickerFormField,
} from './alpha';
import { TemporalWorkflowPicker } from './components/TemporalWorkflowPicker';

describe('Scaffolder Temporal module (new frontend system)', () => {
  it('provides the TemporalWorkflowPicker form field attached to api:scaffolder/form-fields', async () => {
    expect(
      (temporalWorkflowPickerFormField as unknown as { attachTo: unknown })
        .attachTo,
    ).toEqual({
      id: 'api:scaffolder/form-fields',
      input: 'formFields',
    });

    const loader = createExtensionTester(temporalWorkflowPickerFormField).get(
      FormFieldBlueprint.dataRefs.formFieldLoader,
    );
    const field = await loader();
    expect(field.$$type).toBe('@backstage/scaffolder/FormField');

    // Load through the scaffolder form-fields API extension to verify the opaque field payload.
    const factory = createExtensionTester(
      scaffolderPlugin.getExtension('api:scaffolder/form-fields'),
    )
      .add(temporalWorkflowPickerFormField)
      .get(ApiBlueprint.dataRefs.factory);
    const api = factory.factory({
      appTreeApi: {
        getTree: () => ({ tree: { nodes: new Map() } }),
      },
    }) as {
      loadFormFields(): Promise<Array<{ name: string; component: unknown }>>;
    };
    const fields = await api.loadFormFields();
    expect(fields).toContainEqual(
      expect.objectContaining({
        name: 'TemporalWorkflowPicker',
        component: TemporalWorkflowPicker,
      }),
    );
  });

  it('registers temporalWorkflowPickerFormField in the scaffolder module', () => {
    expect(scaffolderTemporalModule.$$type).toBe('@backstage/FrontendModule');
    expect(scaffolderTemporalModule.pluginId).toBe('scaffolder');
    const internal = scaffolderTemporalModule as unknown as {
      extensions: Array<{ id: string }>;
    };
    expect(internal.extensions).toEqual([
      expect.objectContaining({
        id: 'scaffolder-form-field:scaffolder/temporal-workflow-picker',
      }),
    ]);
  });
});
