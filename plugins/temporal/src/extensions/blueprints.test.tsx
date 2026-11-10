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
import {
  TemporalWorkflowActionBlueprint,
  temporalWorkflowActionDataRef,
  TemporalWorkflowListActionBlueprint,
  temporalWorkflowListActionDataRef,
  TemporalWorkflowSectionBlueprint,
  temporalWorkflowSectionDataRef,
} from './blueprints';

describe('blueprints', () => {
  it('outputs a workflow action attached to the Temporal entity content', () => {
    const filter = () => true;
    const extension = TemporalWorkflowActionBlueprint.make({
      name: 'approve',
      params: { loader: async () => () => null, filter },
    });
    expect((extension as unknown as { attachTo: unknown }).attachTo).toEqual({
      id: 'api:temporal/workflow-extensions',
      input: 'actions',
    });
    const action = createExtensionTester(extension).get(
      temporalWorkflowActionDataRef,
    );
    expect(action.id).toBe('temporal-workflow-action:approve');
    expect(action.filter).toBe(filter);
    expect(typeof action.component).toBe('function');
  });

  it('outputs a workflow section', () => {
    const extension = TemporalWorkflowSectionBlueprint.make({
      name: 'notes',
      params: { title: 'Notes', loader: async () => () => null },
    });
    expect((extension as unknown as { attachTo: unknown }).attachTo).toEqual({
      id: 'api:temporal/workflow-extensions',
      input: 'sections',
    });
    const section = createExtensionTester(extension).get(
      temporalWorkflowSectionDataRef,
    );
    expect(section.title).toBe('Notes');
  });

  it('outputs a workflow list action', () => {
    const filter = () => true;
    const extension = TemporalWorkflowListActionBlueprint.make({
      name: 'export',
      params: { loader: async () => () => null, filter },
    });
    expect((extension as unknown as { attachTo: unknown }).attachTo).toEqual({
      id: 'api:temporal/workflow-extensions',
      input: 'listActions',
    });
    const action = createExtensionTester(extension).get(
      temporalWorkflowListActionDataRef,
    );
    expect(action.id).toBe('temporal-workflow-list-action:export');
    expect(action.filter).toBe(filter);
  });
});
