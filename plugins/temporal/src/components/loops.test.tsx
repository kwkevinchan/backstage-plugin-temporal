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
import { temporalApiRef } from '../extensions';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { groupLoops, isLoopBoxNode } from './graph/loops';
import {
  entity,
  failedWorkflow,
  loopGraphResponse,
  mockTemporalApi,
} from '../testData';

const pairs = (edges: { source: string; target: string }[]) =>
  edges.map(e => `${e.source}>${e.target}`);

describe('groupLoops', () => {
  const { nodes, edges, loops } = loopGraphResponse;

  it('replaces a collapsed loop with one box', () => {
    const grouped = groupLoops(nodes, edges, loops, {});
    expect(grouped.nodes.map(n => n.id)).toEqual([
      'start',
      'loop:draft-review',
      'activity-20',
      'end',
    ]);
    expect(pairs(grouped.edges)).toEqual([
      'start>loop:draft-review',
      'loop:draft-review>activity-20',
      'activity-20>end',
    ]);
    const box = grouped.nodes.find(isLoopBoxNode)!;
    expect(box.loopBox).toMatchObject({ expanded: false });
    expect(box.loopBox.round?.iteration).toBe(2);
  });

  it('shows the box and the steps of the chosen round when expanded', () => {
    const grouped = groupLoops(nodes, edges, loops, {
      'draft-review': { expanded: true, iteration: 1 },
    });
    expect(grouped.nodes.map(n => n.id)).toEqual([
      'start',
      'loop:draft-review',
      'activity-5',
      'activity-8',
      'activity-20',
      'end',
    ]);
    expect(pairs(grouped.edges)).toEqual([
      'start>loop:draft-review',
      'loop:draft-review>activity-5',
      'activity-5>activity-8',
      'activity-8>activity-20',
      'activity-20>end',
    ]);
  });

  it('leaves a graph without loops as it is', () => {
    const grouped = groupLoops(nodes, edges, undefined, {});
    expect(grouped.nodes).toBe(nodes);
    expect(grouped.edges).toBe(edges);
  });
});

function render(api: ReturnType<typeof mockTemporalApi>, path: string) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityTemporalContentPage />
      </EntityProvider>
    </TestApiProvider>,
    { routeEntries: [path] },
  );
}

function loopApi() {
  const api = mockTemporalApi();
  api.getWorkflow.mockResolvedValue({
    ...failedWorkflow,
    status: 'Completed',
    workflowId: 'draft-1',
    runId: 'run-2',
  });
  api.getWorkflowGraph.mockResolvedValue(loopGraphResponse);
  return api;
}

const graphButtons = () =>
  within(screen.getByTestId('workflow-graph'))
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label'))
    .filter(label => label && !/zoom/i.test(label));

describe('loops on the workflow page', () => {
  it('collapses the loop, expands it and steps through the rounds', async () => {
    const api = loopApi();
    await render(api, '/namespaces/default/workflows/draft-1/runs/run-2');
    const box = await screen.findByRole('button', {
      name: 'Loop draft-review, round 2 of 5, done',
    });
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(graphButtons()).toEqual([
      'Start, Completed',
      'Loop draft-review, round 2 of 5, done',
      'publishDraft, Completed',
      'End, Completed',
    ]);

    fireEvent.click(box);
    await waitFor(() =>
      expect(graphButtons()).toEqual([
        'Start, Completed',
        'Loop draft-review, round 2 of 5, done, expanded',
        'llmDraft, Completed',
        'llmReview, Completed',
        'publishDraft, Completed',
        'End, Completed',
      ]),
    );
    const controls = screen.getByTestId('loop-controls-draft-review');
    expect(within(controls).getByTestId('loop-round')).toHaveTextContent(
      'Round 2 of 5',
    );
    expect(
      within(controls).getByRole('button', { name: 'Next round' }),
    ).toBeDisabled();

    await userEvent.click(
      within(controls).getByRole('button', { name: 'Previous round' }),
    );
    expect(within(controls).getByTestId('loop-round')).toHaveTextContent(
      'Round 1 of 5',
    );
    expect(screen.getByTestId('step-activity-5')).toBeInTheDocument();
    expect(screen.queryByTestId('step-activity-12')).not.toBeInTheDocument();

    await userEvent.click(
      within(controls).getByRole('button', { name: 'Collapse' }),
    );
    expect(screen.queryByTestId('step-activity-5')).not.toBeInTheDocument();
  });

  it('lists the rounds in the Loops tab and shows a round in the graph', async () => {
    const api = loopApi();
    await render(api, '/namespaces/default/workflows/draft-1/runs/run-2');
    await userEvent.click(await screen.findByRole('tab', { name: 'Loops' }));
    const table = await screen.findByTestId('loop-table-draft-review');
    expect(api.getWorkflowLoops).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'draft-1', runId: 'run-2' },
      { entityRef: 'component:default/orders' },
    );
    expect(table).toHaveTextContent('Done');
    expect(table).toHaveTextContent('Round 2 of 5 · last accept · score 0.9');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/^2Run 2 \(this run\)Completed.*accept0\.9$/),
      expect.stringMatching(/^1Run 1Completed.*revise0\.5$/),
    ]);
    // Round 1 ran in the run before: a link to that run.
    expect(
      within(rows[1]).getByRole('link', { name: 'Run 1' }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining('/runs/run-1?loop=draft-review&round=1'),
    );
    // A round of this run opens in the graph.
    await userEvent.click(within(rows[0]).getByText('2'));
    await waitFor(() =>
      expect(screen.getByTestId('loop-draft-review')).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    );
    expect(screen.getByTestId('step-activity-12')).toBeInTheDocument();
  });

  it('opens the round named in the link', async () => {
    const api = loopApi();
    await render(
      api,
      '/namespaces/default/workflows/draft-1/runs/run-2?loop=draft-review&round=1',
    );
    expect(await screen.findByTestId('step-activity-5')).toBeInTheDocument();
    expect(screen.queryByTestId('step-activity-12')).not.toBeInTheDocument();
  });

  it('has no Loops tab without loops', async () => {
    const api = mockTemporalApi();
    await render(api, '/namespaces/default/workflows/payment-1/runs/run-2');
    await screen.findByTestId('workflow-graph');
    expect(screen.getByRole('tab', { name: 'Steps' })).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Loops' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^loop-controls/)).not.toBeInTheDocument();
  });
});
