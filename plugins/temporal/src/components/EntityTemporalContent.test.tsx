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

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import {
  temporalApiRef,
  TemporalWorkflowActionDef,
  useTemporalWorkflow,
} from '@kwkevinchan/backstage-plugin-temporal-react';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { entity, mockTemporalApi } from '../testData';

function render(
  api: ReturnType<typeof mockTemporalApi>,
  path: string,
  workflowActions?: TemporalWorkflowActionDef[],
) {
  return renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <EntityProvider entity={entity}>
        <EntityTemporalContentPage workflowActions={workflowActions} />
      </EntityProvider>
    </TestApiProvider>,
    { routeEntries: [path] },
  );
}

describe('EntityTemporalContent', () => {
  it('lists workflows with status and times, and pages', async () => {
    const api = mockTemporalApi();
    await render(api, '/');
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('payment-1')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Namespace: default')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'payment-1' })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/payment-1/runs/run-2',
    );
    expect(api.listEntityWorkflows).toHaveBeenCalledWith(
      'component:default/orders',
      { status: undefined, pageSize: 20, pageToken: undefined },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(api.listEntityWorkflows).toHaveBeenLastCalledWith(
        'component:default/orders',
        { status: undefined, pageSize: 20, pageToken: 'next' },
      ),
    );
  });

  it('shows details with failure chain, pending activities and history', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    expect(
      await screen.findByText('Payment could not be completed'),
    ).toBeInTheDocument();
    expect(screen.getByText('Activity task failed')).toBeInTheDocument();
    expect(screen.getAllByText('Card declined').length).toBeGreaterThan(0);
    // The workflow failure chain, outermost first (the activity failure in
    // the inputs and outputs card comes after it).
    const levels = screen
      .getAllByTestId('failure-level')
      .map(e => e.textContent);
    expect(levels.slice(0, 3)).toEqual([
      expect.stringContaining('Payment could not be completed'),
      expect.stringContaining('Activity task failed'),
      expect.stringContaining('Card declined'),
    ]);
    expect(screen.getByText('waitForUpstream')).toBeInTheDocument();
    expect(screen.getByText('Upstream not ready')).toBeInTheDocument();
    expect(
      await screen.findByText('WorkflowExecutionStarted'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open in Temporal UI/ }),
    ).toHaveAttribute(
      'href',
      'http://temporal-ui/namespaces/default/workflows/payment-1/run-2/history',
    );
    expect(api.getWorkflow).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
    expect(api.getWorkflowHistory).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      {
        entityRef: 'component:default/orders',
        pageSize: 50,
        pageToken: undefined,
      },
    );
  });

  it('shows workflow and activity inputs and outputs', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    const activities = await screen.findByRole('table', { name: 'Activities' });
    expect(activities).toHaveTextContent('reserveStock');
    expect(activities).toHaveTextContent('{"sku":"BOOK-1"}');
    expect(activities).toHaveTextContent('{"reserved":true}');
    expect(activities).toHaveTextContent('chargeCard');
    expect(activities).toHaveTextContent(
      'binary/encrypted, 64 bytes (not decoded)',
    );
    expect(activities).toHaveTextContent('Card declined');
    expect(screen.getByTestId('workflow-input')).toHaveTextContent(
      '{"paymentId":"pay-1","amount":42}',
    );
    expect(screen.getByTestId('workflow-result')).toHaveTextContent('—');
    expect(api.getWorkflowSteps).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
  });

  it('shows the tab for entities of any kind', async () => {
    const api = mockTemporalApi();
    await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <EntityProvider
          entity={{
            apiVersion: 'example.com/v1',
            kind: 'Workflow',
            metadata: {
              name: 'nightly',
              annotations: { 'temporal.io/workflow-type': 'nightly' },
            },
          }}
        >
          <EntityTemporalContentPage />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    expect(api.listEntityWorkflows).toHaveBeenCalledWith(
      'workflow:default/nightly',
      expect.anything(),
    );
  });

  it('renders workflow actions passed as props, with the workflow context', async () => {
    const api = mockTemporalApi();
    const ContextAction = () => {
      const { workflow } = useTemporalWorkflow();
      return <button type="button">Approve {workflow.workflowId}</button>;
    };
    await render(api, '/namespaces/default/workflows/payment-1', [
      { id: 'approve', component: ContextAction },
      {
        id: 'hidden',
        component: () => <button type="button">Hidden action</button>,
        filter: wf => wf.status === 'Running',
      },
    ]);
    expect(
      await screen.findByRole('button', { name: 'Approve payment-1' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Hidden action')).not.toBeInTheDocument();
  });

  it('shows errors from the backend', async () => {
    const api = mockTemporalApi();
    api.listEntityWorkflows.mockRejectedValue(new Error('Temporal is down'));
    await render(api, '/');
    expect(
      (await screen.findAllByText(/Temporal is down/)).length,
    ).toBeGreaterThan(0);
  });
});
