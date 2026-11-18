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
import { useLocation } from 'react-router-dom';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { WorkflowDetail, WorkflowSummary } from '../common';
import { temporalApiRef } from '../extensions';
import { withControls } from '../control';
import { TemporalPageContent } from './TemporalPage';
import { failedWorkflow, mockTemporalApi } from '../testData';

/** Where the router is, for the redirect of a workflow ID with one run. */
function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function render(api: ReturnType<typeof mockTemporalApi>, path: string) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <TemporalPageContent {...withControls({})} />
      <Location />
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

const run = (runId: string, status: WorkflowSummary['status']) => ({
  namespace: 'default',
  workflowId: 'long-1',
  runId,
  workflowType: 'pollWorkflow',
  taskQueue: 'polls',
  status,
  startTime: '2026-01-01T10:00:00.000Z',
});

describe('the runs of a workflow ID', () => {
  it('opens the run of a workflow ID with one run in its place', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/namespaces/default/workflows/payment-1/runs/run-2',
      ),
    );
    expect(api.listWorkflowRuns).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1' },
      { entityRef: undefined, pageSize: 20, pageToken: undefined },
    );
    expect(api.getWorkflow).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1', runId: 'run-2' },
      { entityRef: undefined },
    );
  });

  it('lists several runs, the first marked as the latest, with links to each run', async () => {
    const api = mockTemporalApi();
    api.listWorkflowRuns.mockResolvedValue({
      namespace: 'default',
      items: [
        run('r3', 'Running'),
        run('r2', 'ContinuedAsNew'),
        run('r1', 'ContinuedAsNew'),
      ],
    });
    await render(api, '/namespaces/default/workflows/long-1');
    const table = await screen.findByRole('grid', {
      name: 'Runs of the workflow ID',
    });
    expect(within(table).getByRole('link', { name: 'r3' })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/long-1/runs/r3',
    );
    expect(within(table).getByRole('link', { name: 'r1' })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/long-1/runs/r1',
    );
    expect(within(table).getAllByTestId('latest-run')).toHaveLength(1);
    expect(
      within(table).getByRole('link', { name: 'r3' }).closest('[role="row"]'),
    ).toContainElement(within(table).getByTestId('latest-run'));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/namespaces/default/workflows/long-1',
    );
  });

  it('pages through the runs, marking the latest only on the first page', async () => {
    const api = mockTemporalApi();
    api.listWorkflowRuns
      .mockResolvedValueOnce({
        namespace: 'default',
        items: [run('r3', 'Running'), run('r2', 'ContinuedAsNew')],
        nextPageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        namespace: 'default',
        items: [run('r1', 'ContinuedAsNew')],
      });
    await render(api, '/namespaces/default/workflows/long-1');
    await screen.findByRole('link', { name: 'r3' });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('link', { name: 'r1' });
    expect(api.listWorkflowRuns).toHaveBeenLastCalledWith(
      { namespace: 'default', workflowId: 'long-1' },
      { entityRef: undefined, pageSize: 20, pageToken: 'page-2' },
    );
    expect(screen.queryByTestId('latest-run')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/namespaces/default/workflows/long-1',
    );
  });

  it('says so when no run can be shown', async () => {
    const api = mockTemporalApi();
    api.listWorkflowRuns.mockResolvedValue({ namespace: 'default', items: [] });
    await render(api, '/namespaces/default/workflows/gone-1');
    expect(
      await screen.findByText(/No runs of this workflow ID can be shown/),
    ).toBeInTheDocument();
  });
});

describe('notices on a run', () => {
  const continued: WorkflowDetail = {
    ...failedWorkflow,
    workflowId: 'long-1',
    runId: 'r1',
    status: 'ContinuedAsNew',
    failure: undefined,
    continuedAsNewRunId: 'r2',
  };

  it('links a run that continued as new to the run it continued as', async () => {
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue(continued);
    await render(api, '/namespaces/default/workflows/long-1/runs/r1');
    const notice = await screen.findByTestId('run-continued-as-new');
    expect(
      within(notice).getByRole('link', {
        name: 'Open the run it continued as',
      }),
    ).toHaveAttribute('href', '/namespaces/default/workflows/long-1/runs/r2');
    // The run it continued as is known: the run list is not read.
    expect(api.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it('links a closed run that is not the latest to the runs of its workflow ID', async () => {
    const api = mockTemporalApi();
    api.listWorkflowRuns.mockResolvedValue({
      namespace: 'default',
      items: [{ ...failedWorkflow, runId: 'run-3' }],
    });
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    const notice = await screen.findByTestId('run-not-latest');
    expect(
      within(notice).getByRole('link', {
        name: 'See the runs of this workflow ID',
      }),
    ).toHaveAttribute('href', '/namespaces/default/workflows/payment-1');
    // The other run is not named.
    expect(notice).not.toHaveTextContent('run-3');
    expect(api.listWorkflowRuns).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'payment-1' },
      { entityRef: undefined, pageSize: 1 },
    );
  });

  it('shows no notice on the latest run, and does not read the run list of a running run', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    await screen.findByText('Run ID run-2');
    await waitFor(() => expect(api.listWorkflowRuns).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('run-not-latest')).not.toBeInTheDocument();

    const running = mockTemporalApi();
    running.getWorkflow.mockResolvedValue({
      ...failedWorkflow,
      status: 'Running',
      failure: undefined,
    });
    await render(running, '/namespaces/default/workflows/payment-1/runs/run-2');
    await screen.findAllByText('Run ID run-2');
    expect(running.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it('shows no notice when the run list cannot be read', async () => {
    const api = mockTemporalApi();
    api.listWorkflowRuns.mockRejectedValue(new Error('403 Forbidden'));
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    await screen.findByText('Run ID run-2');
    await waitFor(() => expect(api.listWorkflowRuns).toHaveBeenCalled());
    expect(screen.queryByTestId('run-not-latest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('temporal-error')).not.toBeInTheDocument();
  });
});
