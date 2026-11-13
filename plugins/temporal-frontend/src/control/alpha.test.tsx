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

import { screen } from '@testing-library/react';
import {
  ApiBlueprint,
  coreExtensionData,
} from '@backstage/frontend-plugin-api';
import {
  createExtensionTester,
  mockApis,
  renderInTestApp,
} from '@backstage/frontend-test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  temporalApiRef,
  TemporalWorkflowExtensionsApi,
  temporalWorkflowExtensionsApiRef,
} from '../extensions';
import { entity, mockTemporalApi } from '../testData';
import type { Entity } from '@backstage/catalog-model';
import {
  TemporalWorkflowActionBlueprint,
  temporalWorkflowActionDataRef,
  temporalWorkflowListActionDataRef,
} from '../extensions/blueprints';
import {
  TemporalControlActionBlueprint,
  temporalStartWorkflowListAction,
  temporalWorkflowControlsAction,
} from './alpha';
import temporalPlugin from '../alpha';
import { SCHEDULE_CONTROL_IDS } from './index';

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

describe('operations (new frontend system)', () => {
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

describe('the operations in the plugin (new frontend system)', () => {
  it.each([
    'temporal-workflow-action:temporal/controls',
    'temporal-workflow-list-action:temporal/start',
    'temporal-schedule-action:temporal/controls',
  ])('includes %s', id => {
    expect(temporalPlugin.getExtension(id as any)).toBeDefined();
  });
});

describe('the operations on the pages (new frontend system)', () => {
  /**
   * An action that shows once the module of the operation buttons has
   * loaded: the buttons are lazy, so a check that they are absent must
   * wait for it.
   */
  const probeAction = TemporalWorkflowActionBlueprint.make({
    name: 'probe',
    params: {
      loader: async () => {
        await import('./WorkflowControls');
        return () => <span>probe</span>;
      },
    },
  });

  /** The shared extensions API of the plugin, with its control extensions. */
  function workflowExtensions(): TemporalWorkflowExtensionsApi {
    const factory = createExtensionTester(
      temporalPlugin.getExtension('api:temporal/workflow-extensions'),
    )
      .add(temporalWorkflowControlsAction)
      .add(temporalStartWorkflowListAction)
      .add(probeAction)
      .get(ApiBlueprint.dataRefs.factory);
    return factory.factory({}) as TemporalWorkflowExtensionsApi;
  }

  /** Renders the details page on the entity tab and on the Workflows page. */
  async function eachPage(control: object, check: () => Promise<void>) {
    for (const id of ['entity-content:temporal', 'page:temporal']) {
      const element = createExtensionTester(
        temporalPlugin.getExtension(id as 'page:temporal'),
      ).get(coreExtensionData.reactElement);
      const { unmount } = renderInTestApp(
        <EntityProvider entity={entity}>{element}</EntityProvider>,
        {
          apis: [
            [temporalApiRef, mockTemporalApi()],
            [temporalWorkflowExtensionsApiRef, workflowExtensions()],
            [permissionApiRef, mockApis.permission()],
          ],
          config: { temporal: { control } },
          initialRouteEntries: ['/namespaces/default/workflows/payment-1'],
        },
      );
      expect(
        await screen.findByTestId('workflow-summary', {}, { timeout: 10_000 }),
      ).toHaveTextContent('Failed');
      await check();
      unmount();
    }
  }

  it('names the schedule action as the list of operations expects', () => {
    const factory = createExtensionTester(
      temporalPlugin.getExtension('api:temporal/workflow-extensions'),
    )
      .add(
        temporalPlugin.getExtension(
          'temporal-schedule-action:temporal/controls',
        ),
      )
      .get(ApiBlueprint.dataRefs.factory);
    const api = factory.factory({}) as TemporalWorkflowExtensionsApi;
    expect(SCHEDULE_CONTROL_IDS.has(api.getScheduleActions()[0].id)).toBe(true);
  });

  it('shows Rerun on the entity tab and the Workflows page', async () => {
    await eachPage({}, async () => {
      expect(
        await screen.findByRole('button', { name: 'Rerun' }),
      ).toBeInTheDocument();
    });
  });

  it('shows no operations with temporal.control.enabled false', async () => {
    await eachPage({ enabled: false }, async () => {
      expect(await screen.findByText('probe')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Rerun' })).toBeNull();
      // Query is not one of the operations.
      expect(
        screen.getByRole('button', { name: 'Query…' }),
      ).toBeInTheDocument();
    });
  });
});
