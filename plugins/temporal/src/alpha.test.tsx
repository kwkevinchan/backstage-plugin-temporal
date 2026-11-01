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
import { coreExtensionData } from '@backstage/frontend-plugin-api';
import {
  createExtensionTester,
  renderInTestApp,
} from '@backstage/frontend-test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import {
  TemporalWorkflowActionBlueprint,
  TemporalWorkflowSectionBlueprint,
} from '@kwkevinchan/backstage-plugin-temporal-react/alpha';
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

  it('renders actions and sections from the blueprints on the details page', async () => {
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
    const element = createExtensionTester(
      temporalPlugin.getExtension('entity-content:temporal'),
    )
      .add(action)
      .add(section)
      .get(coreExtensionData.reactElement);

    renderInTestApp(
      <EntityProvider entity={entity}>{element}</EntityProvider>,
      {
        apis: [[temporalApiRef, mockTemporalApi()]],
        initialRouteEntries: ['/namespaces/default/workflows/payment-1'],
      },
    );

    expect(
      await screen.findByRole('button', { name: 'Approve payment-1' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('No approvals yet')).toBeInTheDocument();
    expect(screen.getByText('Approvals')).toBeInTheDocument();
  });
});
