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

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderInTestApp,
  TestApiProvider,
  mockApis,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  temporalApiRef,
  TemporalWorkflowActionDef,
  useTemporalWorkflow,
} from '../extensions';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import {
  entity,
  failedWorkflow,
  graphResponse,
  mockTemporalApi,
} from '../testData';

function render(
  api: ReturnType<typeof mockTemporalApi>,
  path: string,
  workflowActions?: TemporalWorkflowActionDef[],
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
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
    const table = screen.getByRole('grid', { name: 'Workflow executions' });
    expect(within(table).getByText('Completed')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    // Progress of each run, loaded per row.
    expect(
      (await screen.findAllByText('1/2 steps · Failed at chargeCard')).length,
    ).toBe(2);
    expect(api.getWorkflowProgress).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
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

  it('shows the summary line and the step graph', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    const summary = await screen.findByTestId('workflow-summary');
    expect(summary).toHaveTextContent('Failed');
    expect(summary).toHaveTextContent('paymentWorkflow');
    expect(await screen.findByTestId('workflow-current')).toHaveTextContent(
      'Failed at chargeCard',
    );
    expect(
      screen.getByRole('link', { name: /Open in Temporal UI/ }),
    ).toHaveAttribute(
      'href',
      'http://temporal-ui/namespaces/default/workflows/payment-1/run-2/history',
    );
    const graph = screen.getByTestId('workflow-graph');
    // Internal workflow tasks are not drawn.
    expect(
      within(graph)
        .getAllByRole('button', { name: /, (Completed|Failed)/ })
        .map(b => b.getAttribute('aria-label')),
    ).toEqual([
      'Start, Completed',
      'reserveStock, Completed',
      'chargeCard, Failed, attempt 2',
      'End, Failed',
    ]);
    expect(within(graph).getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 steps done')).toBeInTheDocument();
    expect(api.getWorkflow).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
    expect(api.getWorkflowGraph).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
  });

  it('opens a step with its input, output, error and attempts', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'chargeCard, Failed, attempt 2',
      }),
    );
    const drawer = screen.getByTestId('step-drawer');
    expect(within(drawer).getByTestId('step-input')).toHaveTextContent(
      'binary/encrypted, 64 bytes (not decoded)',
    );
    expect(within(drawer).getByTestId('step-error')).toHaveTextContent(
      'Card declined',
    );
    expect(within(drawer).getByTestId('step-attempts')).toHaveTextContent(
      'Bank timeout',
    );
    expect(within(drawer).getByTestId('step-events')).toHaveTextContent(
      'ActivityTaskFailed',
    );
    expect(within(drawer).getByText('2 of 2')).toBeInTheDocument();

    // Another step: decoded JSON that can be copied.
    fireEvent.click(
      screen.getByRole('button', { name: 'reserveStock, Completed' }),
    );
    expect(screen.getByTestId('step-input')).toHaveTextContent(
      '"sku": "BOOK-1"',
    );
    expect(screen.getByTestId('step-output')).toHaveTextContent(
      '"reserved": true',
    );
    expect(
      within(screen.getByTestId('step-drawer')).getAllByRole('button', {
        name: 'Copy JSON',
      }).length,
    ).toBe(2);

    await userEvent.click(
      screen.getByRole('button', { name: 'Close step details' }),
    );
    expect(screen.queryByTestId('step-drawer')).not.toBeInTheDocument();
  });

  it('says when inputs and results are hidden', async () => {
    const api = mockTemporalApi();
    api.getWorkflowGraph.mockResolvedValue({
      ...graphResponse,
      payloadsHidden: true,
      nodes: graphResponse.nodes.map(({ input, result, ...n }) => n),
    });
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    fireEvent.click(
      await screen.findByRole('button', { name: 'reserveStock, Completed' }),
    );
    expect(screen.getByTestId('step-drawer')).toHaveTextContent(
      'Inputs and results are hidden',
    );
  });

  it('has tabs with the steps, grouped and raw events, and details', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    const steps = await screen.findByRole('grid', { name: 'Steps' });
    expect(steps).toHaveTextContent('reserveStock');
    expect(steps).toHaveTextContent('Card declined');
    expect(steps).not.toHaveTextContent('Workflow task');

    await userEvent.click(screen.getByRole('tab', { name: 'Events' }));
    const grouped = screen.getByTestId('grouped-events');
    expect(grouped).toHaveTextContent('chargeCard');
    expect(grouped).toHaveTextContent('3 events');
    expect(grouped).not.toHaveTextContent('Workflow task');
    await userEvent.click(screen.getByText('Show workflow tasks'));
    expect(screen.getByTestId('grouped-events')).toHaveTextContent(
      'Workflow task',
    );
    expect(api.getWorkflowHistory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: 'Raw' }));
    expect(
      await screen.findByText('WorkflowExecutionStarted'),
    ).toBeInTheDocument();
    expect(api.getWorkflowHistory).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      {
        entityRef: 'component:default/orders',
        pageSize: 50,
        pageToken: undefined,
      },
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    const levels = screen
      .getAllByTestId('failure-level')
      .map(e => e.textContent);
    expect(levels).toEqual([
      expect.stringContaining('Payment could not be completed'),
      expect.stringContaining('Activity task failed'),
      expect.stringContaining('Card declined'),
    ]);
    expect(screen.getByText('waitForUpstream')).toBeInTheDocument();
    expect(screen.getByText('Upstream not ready')).toBeInTheDocument();
  });

  it('has a Timeline tab whose bars open the step panel', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    await screen.findByRole('grid', { name: 'Steps' });
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    const timeline = screen.getByTestId('workflow-timeline');
    const bar = within(timeline).getByRole('button', {
      name: /^chargeCard, Failed/,
    });
    fireEvent.click(bar);
    const drawers = screen.getAllByTestId('step-drawer');
    expect(drawers).toHaveLength(1);
    expect(drawers[0]).toHaveTextContent('Card declined');
  });

  it('reloads a running workflow every five seconds until turned off', async () => {
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue({ ...failedWorkflow, status: 'Running' });
    const intervals: (() => void)[] = [];
    const setIntervalSpy = jest
      .spyOn(window, 'setInterval')
      .mockImplementation(((fn: () => void, ms: number) => {
        if (ms === 5000) intervals.push(fn);
        return intervals.length as any;
      }) as any);
    try {
      await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
      const toggle = await screen.findByRole('switch', {
        name: 'Auto refresh',
      });
      expect(toggle).toBeChecked();
      expect(intervals.length).toBeGreaterThan(0);
      intervals[intervals.length - 1]();
      await waitFor(() => expect(api.getWorkflow).toHaveBeenCalledTimes(2));
      expect(api.getWorkflowGraph).toHaveBeenCalledTimes(2);
      const before = intervals.length;
      await userEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(intervals.length).toBe(before);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('shows the tab for entities of any kind', async () => {
    const api = mockTemporalApi();
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
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
