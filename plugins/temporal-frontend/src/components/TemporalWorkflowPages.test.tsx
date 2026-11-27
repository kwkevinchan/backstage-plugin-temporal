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

import { screen, within } from '@testing-library/react';
import { MockConfigApi, mockApis } from '@backstage/test-utils';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { configApiRef } from '@backstage/core-plugin-api';
import { Entity } from '@backstage/catalog-model';
import {
  catalogApiRef,
  entityRouteRef,
  EntityProvider,
} from '@backstage/plugin-catalog-react';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { temporalApiRef } from '../extensions';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import {
  checkoutEntity,
  listResponse,
  mockTemporalApi,
  workflowEntity,
} from '../testData';

async function render(entity: Entity, api: ReturnType<typeof mockTemporalApi>) {
  const config = new MockConfigApi({
    temporal: { webUi: { baseUrl: 'http://temporal-ui/' } },
  });
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
        [configApiRef, config],
        [catalogApiRef, catalogApiMock({ entities: [workflowEntity] })],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityTemporalContentPage />
      </EntityProvider>
    </TestApiProvider>,
    { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
  );
}

describe('TemporalWorkflow entity tab', () => {
  it('shows the summary, recent run statistics and the runs', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockResolvedValue({
      items: [
        {
          entityRef: 'temporalworkflow:default/order-workflow',
          running: 1,
          completed: 4,
          failed: 2,
          windowDays: 7,
          sampleSize: 7,
          averageDurationMs: 2500,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    await render(workflowEntity, api);

    expect(
      await screen.findByRole('heading', { name: 'Workflow type' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('orderWorkflow').length).toBeGreaterThan(0);
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /team-a/ })).toHaveAttribute(
      'href',
      '/catalog/default/group/team-a',
    );
    expect(screen.getByRole('link', { name: /shop/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /checkout/ })).toHaveAttribute(
      'href',
      '/catalog/default/component/checkout',
    );
    expect(
      screen.getByRole('link', { name: /Open in Temporal UI/ }),
    ).toHaveAttribute(
      'href',
      `http://temporal-ui/namespaces/default/workflows?query=${encodeURIComponent(
        'WorkflowType="orderWorkflow" AND TaskQueue="orders"',
      )}`,
    );

    expect(
      await screen.findByText(
        'Completed and failed in the last 7 days; average of the last 7 runs',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Completed' })).getByText('4'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Failed' })).getByText('2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Running' })).getByText('1'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Average duration' })).getByText(
        '2.5s',
      ),
    ).toBeInTheDocument();
    expect(api.getWorkflowTypeOverview).toHaveBeenCalledWith(
      ['temporalworkflow:default/order-workflow'],
      undefined,
    );

    expect(
      screen.getByRole('heading', { name: 'Workflow executions' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    // One workflow type: its runs list leaves out the type column.
    expect(
      within(screen.getByRole('grid', { name: 'Workflow executions' }))
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).not.toContain('Workflow type');
    expect(api.listEntityWorkflows).toHaveBeenCalledWith(
      'temporalworkflow:default/order-workflow',
      expect.anything(),
    );
    expect(
      screen.queryByTestId('related-workflows-truncated'),
    ).not.toBeInTheDocument();
  });
});

describe('Temporal tab of a component that depends on workflows', () => {
  it('lists the workflow entities and the merged runs', async () => {
    const api = mockTemporalApi();
    api.listEntityWorkflows.mockResolvedValue({
      ...listResponse,
      items: [
        {
          ...listResponse.items[0],
          workflowEntityRef: 'temporalworkflow:default/order-workflow',
        },
        {
          ...listResponse.items[1],
          workflowId: 'deploy-1',
          workflowType: 'deploymentWorkflow',
        },
      ],
    });
    await render(checkoutEntity, api);

    const workflows = await screen.findByRole('grid', {
      name: 'Workflow types',
    });
    expect(
      within(workflows).getByRole('link', { name: /order-workflow/ }),
    ).toHaveAttribute(
      'href',
      '/catalog/default/temporalworkflow/order-workflow',
    );
    expect(within(workflows).getByText('orders')).toBeInTheDocument();

    const runs = await screen.findByRole('grid', {
      name: 'Workflow executions',
    });
    expect(within(runs).getByText('deploy-1')).toBeInTheDocument();
    // Temporal UI order: status, the workflow ID, the run ID, then the type,
    // which links to the TemporalWorkflow entity.
    expect(
      within(runs)
        .getAllByRole('columnheader')
        .slice(0, 4)
        .map(h => h.textContent),
    ).toEqual(['Status', 'Workflow ID', 'Run ID', 'Workflow type']);
    expect(
      within(runs).getAllByRole('link', { name: 'orderWorkflow' })[0],
    ).toHaveAttribute(
      'href',
      '/catalog/default/temporalworkflow/order-workflow',
    );
    expect(api.listEntityWorkflows).toHaveBeenCalledWith(
      'component:default/checkout',
      expect.anything(),
    );
    expect(api.getWorkflowTypeOverview).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('related-workflows-truncated'),
    ).not.toBeInTheDocument();
  });

  it('shows a notice when the merged list covers only the first related types', async () => {
    const api = mockTemporalApi();
    api.listEntityWorkflows.mockResolvedValue({
      ...listResponse,
      relatedWorkflows: { total: 21, queried: 20 },
    });
    await render(checkoutEntity, api);
    expect(
      await screen.findByTestId('related-workflows-truncated'),
    ).toHaveTextContent(
      'Showing executions of the first 20 of 21 workflow types. Open a workflow type above to see its executions.',
    );
  });

  it('does not show a notice when every related type is queried', async () => {
    const api = mockTemporalApi();
    api.listEntityWorkflows.mockResolvedValue({
      ...listResponse,
      relatedWorkflows: { total: 20, queried: 20 },
    });
    await render(checkoutEntity, api);
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    expect(
      screen.queryByTestId('related-workflows-truncated'),
    ).not.toBeInTheDocument();
  });
});
