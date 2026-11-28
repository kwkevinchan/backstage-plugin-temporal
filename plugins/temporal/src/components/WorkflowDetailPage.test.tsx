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
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { WorkflowDetail, WorkflowGraphResponse } from '../common';
import { temporalApiRef } from '../extensions';
import { failedWorkflow, graphResponse, mockTemporalApi } from '../testData';
import { TemporalPageContent } from './TemporalPage';

const RUN = '/namespaces/default/workflows/payment-1/runs/run-2';

async function renderRun(
  graph: Partial<WorkflowGraphResponse>,
  workflow: Partial<WorkflowDetail> = {},
  query = '',
) {
  const api = mockTemporalApi();
  api.getWorkflowGraph.mockResolvedValue({ ...graphResponse, ...graph });
  api.getWorkflow.mockResolvedValue({ ...failedWorkflow, ...workflow });
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <TemporalPageContent />
    </TestApiProvider>,
    {
      routeEntries: [`${RUN}${query}`],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
  await screen.findByTestId('workflow-graph');
  return api;
}

describe('header of the workflow details page', () => {
  it('shows the workflow ID, the run ID and the fields of the run', async () => {
    await renderRun({ current: 'chargeCard failed' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'payment-1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Run ID run-2')).toBeInTheDocument();
    const summary = screen.getByTestId('workflow-summary');
    expect(
      [...summary.children].map(item => item.firstElementChild?.textContent),
    ).toEqual(['Status', 'Stopped at', 'Workflow type', 'Duration', 'Started']);
    expect(within(summary).getByTestId('workflow-current')).toHaveTextContent(
      'chargeCard failed',
    );
    expect(
      screen.queryByTestId('workflow-run-chain'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('workflow-actions')).getByRole('link', {
        name: 'Open in Temporal UI',
      }),
    ).toHaveAttribute('href', failedWorkflow.webUiUrl);
  });

  it('shows what a running workflow waits for with its time limit, in a wide field', async () => {
    await renderRun(
      {
        status: 'Running',
        current: 'Waiting for the signal approve',
        currentDeadline: { time: '2000-01-01T00:00:00Z', kind: 'timeout' },
      },
      { status: 'Running', closeTime: undefined, failure: undefined },
    );
    const current = screen.getByTestId('workflow-current');
    expect(current).toHaveTextContent(
      'Waiting for the signal approve · times out now',
    );
    const item = current.closest('[data-wide]');
    expect(item).toHaveAttribute('data-wide', 'true');
    expect(item).toHaveTextContent(/^Now/);
    expect(screen.getByRole('switch', { name: 'Auto refresh' })).toBeChecked();
  });

  it('links to the runs before and after a run of a chain', async () => {
    await renderRun(
      {
        runChain: {
          index: 2,
          total: 3,
          previousRunId: 'run-1',
          nextRunId: 'run-3',
        },
      },
      { status: 'Completed', failure: undefined },
    );
    const chain = screen.getByTestId('workflow-run-chain');
    expect(chain).toHaveTextContent('Run 2 of 3');
    expect(within(chain).getByRole('link', { name: '← Run 1' })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/payment-1/runs/run-1',
    );
    expect(within(chain).getByRole('link', { name: 'Run 3 →' })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/payment-1/runs/run-3',
    );
  });

  it('names the neighbours of a run whose place in the chain is not known', async () => {
    await renderRun(
      { runChain: { previousRunId: 'run-1', nextRunId: 'run-3' } },
      { status: 'Completed', failure: undefined },
    );
    const chain = screen.getByTestId('workflow-run-chain');
    expect(chain).toHaveTextContent('One of several runs');
    expect(
      within(chain).getByRole('link', { name: '← Previous run' }),
    ).toBeInTheDocument();
    expect(
      within(chain).getByRole('link', { name: 'Next run →' }),
    ).toBeInTheDocument();
  });
});

describe('Details tab of the workflow details page', () => {
  it('lists the fields, the failure, the pending activities, the search attributes and the memo', async () => {
    await renderRun(
      {},
      {
        searchAttributes: { CustomKeywordField: ['blue'] },
        memo: { note: 'hello' },
        parent: { workflowId: 'parent-1', runId: 'p-1' },
      },
      '?tab=details',
    );
    const panel = screen.getByRole('tabpanel', { name: 'Details' });
    const terms = [...panel.querySelectorAll('dl')[0].querySelectorAll('dt')];
    expect(terms.map(term => term.textContent)).toEqual([
      'Workflow ID',
      'Run ID',
      'Workflow type',
      'Task queue',
      'Namespace',
      'Status',
      'Started',
      'Ended',
      'Duration',
      'History events',
      'Parent workflow',
    ]);
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map(heading => heading.textContent),
    ).toEqual(['Failure', 'Pending activities', 'Search attributes', 'Memo']);
    expect(panel).toHaveTextContent('parent-1');
    expect(panel).toHaveTextContent('Payment could not be completed');
    expect(panel).toHaveTextContent('waitForUpstream');
    expect(panel).toHaveTextContent('CustomKeywordField');
  });

  it('leaves out the parts that the run does not have', async () => {
    await renderRun(
      {},
      { failure: undefined, pendingActivities: [] },
      '?tab=details',
    );
    const panel = screen.getByRole('tabpanel', { name: 'Details' });
    expect(within(panel).queryAllByRole('heading', { level: 3 })).toEqual([]);
  });
});
