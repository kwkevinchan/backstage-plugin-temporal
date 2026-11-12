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
import type { Entity } from '@backstage/catalog-model';
import {
  temporalWorkflowActionDataRef,
  temporalWorkflowListActionDataRef,
} from '@kwkevinchan/backstage-plugin-temporal/alpha';
import {
  TemporalControlActionBlueprint,
  temporalStartWorkflowListAction,
  temporalWorkflowControlsAction,
} from './alpha';

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

describe('control module (new frontend system)', () => {
  it('adds the operations to the action bar of the details page', () => {
    const action = createExtensionTester(temporalWorkflowControlsAction).get(
      temporalWorkflowActionDataRef,
    );
    expect(action.id).toBe('temporal-workflow-action:controls');
    expect(action.filter).toBeUndefined();
  });

  it('shows Start on TemporalWorkflow entities and the Workflows page', () => {
    const start = createExtensionTester(temporalStartWorkflowListAction).get(
      temporalWorkflowListActionDataRef,
    );
    expect(start.filter!({ entity: workflowEntity })).toBe(true);
    expect(start.filter!({})).toBe(true);
    expect(start.filter!({ entity: component })).toBe(false);
  });

  it('makes a button for a custom backend action', () => {
    const filter = () => true;
    const extension = TemporalControlActionBlueprint.make({
      name: 'escalate',
      params: { actionId: 'escalate', label: 'Escalate', filter },
    });
    expect((extension as unknown as { attachTo: unknown }).attachTo).toEqual({
      id: 'api:temporal/workflow-extensions',
      input: 'actions',
    });
    const action = createExtensionTester(extension).get(
      temporalWorkflowActionDataRef,
    );
    expect(action.id).toBe('temporal-control-action:escalate');
    expect(action.filter).toBe(filter);
  });
});
