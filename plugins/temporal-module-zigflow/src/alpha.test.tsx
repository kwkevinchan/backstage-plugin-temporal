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

import { coreExtensionData } from '@backstage/frontend-plugin-api';
import { createExtensionTester } from '@backstage/frontend-test-utils';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import type { Entity } from '@backstage/catalog-model';
import { temporalDefinitionContent } from './alpha';

const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'flow', namespace: 'default' },
  spec: { owner: 'team', workflowType: 'flow' },
};

const component: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders', namespace: 'default' },
  spec: { type: 'service', owner: 'team' },
};

describe('Zigflow module (new frontend system)', () => {
  it('adds the Definition tab to TemporalWorkflow entities only', () => {
    const tab = createExtensionTester(temporalDefinitionContent);
    expect(tab.get(coreExtensionData.routePath)).toBe('definition');
    expect(tab.get(EntityContentBlueprint.dataRefs.title)).toBe('Definition');
    const filter = tab.get(EntityContentBlueprint.dataRefs.filterFunction)!;
    expect(filter(workflowEntity)).toBe(true);
    expect(filter(component)).toBe(false);
  });
});
