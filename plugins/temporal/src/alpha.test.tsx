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
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import {
  temporalApiRef,
  TemporalWorkflowExtensionsApi,
  temporalWorkflowExtensionsApiRef,
} from './extensions';
import {
  TemporalWorkflowActionBlueprint,
  TemporalWorkflowSectionBlueprint,
} from './extensions/blueprints';
import temporalPlugin from './alpha';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import {
  checkoutEntity,
  entity,
  mockTemporalApi,
  workflowEntity,
} from './testData';

describe('temporal (new frontend system)', () => {
  it('exports a frontend plugin', () => {
    expect(temporalPlugin.id).toBe('temporal');
  });

  it('adds the Workflows page with a title and icon for the sidebar', () => {
    const tester = createExtensionTester(
      temporalPlugin.getExtension('page:temporal'),
    );
    expect(tester.get(coreExtensionData.routePath)).toBe('/temporal');
    expect(tester.get(coreExtensionData.title)).toBe('Workflows');
    expect(tester.get(coreExtensionData.icon)).toBeTruthy();
  });

  it('shows the workflow summary card on TemporalWorkflow entities only', () => {
    const card = createExtensionTester(
      temporalPlugin.getExtension('entity-card:temporal/workflow-summary'),
    );
    const filter = card.get(EntityCardBlueprint.dataRefs.filterFunction)!;
    expect(filter(workflowEntity)).toBe(true);
    expect(filter(entity)).toBe(false);
    const related = createExtensionTester(
      temporalPlugin.getExtension('entity-card:temporal/related-workflows'),
    ).get(EntityCardBlueprint.dataRefs.filterFunction)!;
    expect(related(checkoutEntity)).toBe(true);
    expect(related(entity)).toBe(false);
  });

  it('collects blueprint actions and sections in the shared extensions API', () => {
    const action = TemporalWorkflowActionBlueprint.make({
      name: 'approve',
      params: {
        loader: async () => props =>
          <button type="button">Approve {props.workflow.workflowId}</button>,
      },
    });
    const section = TemporalWorkflowSectionBlueprint.make({
      name: 'approvals',
      params: {
        title: 'Approvals',
        loader: async () => () => <div>No approvals yet</div>,
      },
    });
    const factory = createExtensionTester(
      temporalPlugin.getExtension('api:temporal/workflow-extensions'),
    )
      .add(action)
      .add(section)
      .get(ApiBlueprint.dataRefs.factory);
    expect(factory.api.id).toBe(temporalWorkflowExtensionsApiRef.id);
    const api = factory.factory({}) as TemporalWorkflowExtensionsApi;
    expect(api.getActions().map(a => a.id)).toEqual([
      'temporal-workflow-action:approve',
    ]);
    expect(api.getSections().map(s => [s.id, s.title])).toEqual([
      ['temporal-workflow-section:approvals', 'Approvals'],
    ]);
  });

  it('shows the shared actions and sections on the entity tab and the Workflows page', async () => {
    const extensions: TemporalWorkflowExtensionsApi = {
      getActions: () => [
        {
          id: 'approve',
          component: props => (
            <button type="button">Approve {props.workflow.workflowId}</button>
          ),
        },
      ],
      getSections: () => [
        {
          id: 'approvals',
          title: 'Approvals',
          component: () => <div>No approvals yet</div>,
        },
      ],
    };
    for (const id of ['entity-content:temporal', 'page:temporal']) {
      const element = createExtensionTester(
        temporalPlugin.getExtension(id as 'page:temporal'),
      ).get(coreExtensionData.reactElement);
      const { unmount } = renderInTestApp(
        <EntityProvider entity={entity}>{element}</EntityProvider>,
        {
          apis: [
            [temporalApiRef, mockTemporalApi()],
            [temporalWorkflowExtensionsApiRef, extensions],
            [permissionApiRef, mockApis.permission()],
          ],
          initialRouteEntries: ['/namespaces/default/workflows/payment-1'],
        },
      );
      // The page loads its parts lazily; slow under a full parallel run.
      expect(
        await screen.findByRole(
          'button',
          { name: 'Approve payment-1' },
          { timeout: 10_000 },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Approvals' }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
