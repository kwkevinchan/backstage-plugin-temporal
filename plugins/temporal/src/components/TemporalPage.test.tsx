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

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderInTestApp,
  TestApiProvider,
  mockApis,
} from '@backstage/test-utils';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { TemporalPageContent } from './TemporalPage';
import { listResponse, mockTemporalApi } from '../testData';

function render(api: ReturnType<typeof mockTemporalApi>, path = '/') {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <TemporalPageContent />
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

describe('Workflows page', () => {
  it('lists every workflow with entity links', async () => {
    const api = mockTemporalApi();
    api.listWorkflows.mockResolvedValue({
      ...listResponse,
      items: [
        {
          ...listResponse.items[0],
          taskQueue: 'orders',
          workflowEntityRef: 'temporalworkflow:default/order-workflow',
        },
        {
          ...listResponse.items[1],
          entityRef: 'component:default/orders',
        },
        {
          ...listResponse.items[1],
          workflowId: 'running-1',
          runId: 'r3',
          status: 'Running',
        },
      ],
    });
    await render(api);
    const table = await screen.findByRole('grid', { name: 'All workflows' });
    expect(
      within(table).getByRole('link', { name: 'order-1' }),
    ).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/order-1/runs/run-1',
    );
    expect(within(table).getAllByText('orders').length).toBeGreaterThan(0);
    expect(
      within(table).getByRole('link', { name: /order-workflow/ }),
    ).toHaveAttribute(
      'href',
      '/catalog/default/temporalworkflow/order-workflow',
    );
    expect(
      within(table).getByRole('link', { name: /orders$/ }),
    ).toHaveAttribute('href', '/catalog/default/component/orders');
    // Running uses the animated status component.
    expect(
      within(table).getByTestId('workflow-status-running'),
    ).toHaveTextContent('Running');
    expect(api.listWorkflows).toHaveBeenCalledWith({
      status: undefined,
      workflowType: undefined,
      workflowIdPrefix: undefined,
      pageSize: 20,
      pageToken: undefined,
    });
  });

  it('filters by workflow ID prefix and type, and rejects unsafe input', async () => {
    const api = mockTemporalApi();
    await render(api);
    await screen.findByRole('grid', { name: 'All workflows' });
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Workflow ID starts with' }),
      'order-',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Workflow type' }),
      'orderWorkflow{enter}',
    );
    await waitFor(() =>
      expect(api.listWorkflows).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workflowType: 'orderWorkflow',
          workflowIdPrefix: 'order-',
        }),
      ),
    );
    const calls = api.listWorkflows.mock.calls.length;
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Workflow ID starts with' }),
      "' OR '1",
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'letters, digits and _ . : / - only',
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(api.listWorkflows).toHaveBeenCalledTimes(calls);
  });

  it('opens a workflow without an entity', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    expect(
      await screen.findByText('Payment could not be completed'),
    ).toBeInTheDocument();
    expect(api.getWorkflow).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: undefined },
    );
    expect(
      screen.getByRole('link', { name: '← All workflows' }),
    ).toBeInTheDocument();
  });
});
