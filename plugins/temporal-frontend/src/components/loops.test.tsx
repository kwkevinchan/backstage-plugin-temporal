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
import { focusFrame, groupLoops, isLoopBoxNode } from './graph/loops';
import {
  entity,
  failedWorkflow,
  loopGraphResponse,
  loopsResponse,
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

  it('puts every round of an expanded loop into its own frame', () => {
    const grouped = groupLoops(nodes, edges, loops, {
      'draft-review': { expanded: true },
    });
    // The loop is one box of the main graph; its steps are in the frames.
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
    const box = grouped.nodes.find(isLoopBoxNode)!.loopBox;
    expect(box.frames.map(f => [f.id, f.stepIds])).toEqual([
      ['loop:draft-review#1', ['activity-5', 'activity-8']],
      ['loop:draft-review#2', ['activity-12', 'activity-15']],
    ]);
    // Arrows inside a round stay in its frame; arrows between rounds go.
    expect(pairs(grouped.frameEdges.get('loop:draft-review#1')!)).toEqual([
      'activity-5>activity-8',
    ]);
    expect(pairs(grouped.frameEdges.get('loop:draft-review#2')!)).toEqual([
      'activity-12>activity-15',
    ]);
    expect(box.fromEarlierRun).toBe(false);
  });

  it('marks a loop that started in an earlier run', () => {
    const later = loops!.map(loop => ({
      ...loop,
      rounds: loop.rounds.map(r => ({ ...r, iteration: r.iteration + 10 })),
    }));
    const grouped = groupLoops(
      nodes,
      edges,
      later,
      { 'draft-review': { expanded: true } },
      { previousRun: true },
    );
    expect(grouped.boxes[0].fromEarlierRun).toBe(true);
    expect(grouped.boxes[0].frames.map(f => f.round.iteration)).toEqual([
      11, 12,
    ]);
  });

  it('brings the named, running, failed or last round into view', () => {
    const rounds = (statuses: string[]) => ({
      ...loops![0],
      rounds: statuses.map((status, i) => ({
        ...loops![0].rounds[0],
        iteration: i + 1,
        status: status as 'Completed',
        steps: [],
      })),
    });
    const box = (statuses: string[]) =>
      groupLoops(nodes, edges, [rounds(statuses)], {
        'draft-review': { expanded: true },
      }).boxes[0];
    const frame = (statuses: string[], iteration?: number) =>
      focusFrame(box(statuses), { expanded: true, iteration })?.round.iteration;
    expect(frame(['Completed', 'Completed', 'Running'])).toBe(3);
    expect(frame(['Completed', 'Failed', 'Completed'])).toBe(2);
    expect(frame(['Completed', 'Completed'])).toBe(2);
    expect(frame(['Completed', 'Completed', 'Running'], 1)).toBe(1);
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
    .filter(label => label && !/zoom|fit view/i.test(label));

describe('loops on the workflow page', () => {
  it('collapses the loop and expands it into a frame per round', async () => {
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
        'llmDraft, Completed',
        'llmReview, Completed',
        'publishDraft, Completed',
        'End, Completed',
      ]),
    );
    // Every round has its frame, with its decision and score.
    const first = screen.getByTestId('loop-round-draft-review-1');
    const second = screen.getByTestId('loop-round-draft-review-2');
    expect(first).toHaveTextContent('Round 1 · revise · score 0.5');
    expect(second).toHaveTextContent('Round 2 · accept · score 0.9');
    // The last round is brought into view.
    await waitFor(() => expect(second).toHaveAttribute('data-focused', 'true'));
    const controls = screen.getByTestId('loop-controls-draft-review');
    expect(within(controls).getByTestId('loop-round')).toHaveTextContent(
      'Rounds 1–2 of 5 · Done',
    );
    expect(
      within(controls).queryByRole('button', { name: 'Previous round' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(controls).getByRole('button', { name: 'Collapse' }),
    );
    expect(screen.queryByTestId('step-activity-5')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('loop-round-draft-review-1'),
    ).not.toBeInTheDocument();
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
    // The round picked in the tab is the one brought into view.
    expect(screen.getByTestId('loop-round-draft-review-2')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });

  it('colors the steps of a round like the steps of the graph', async () => {
    const api = loopApi();
    const [loop] = loopsResponse.loops!;
    const statuses = [
      'Terminated',
      'Rejected',
      'Retrying',
      'Canceled',
    ] as const;
    api.getWorkflowLoops.mockResolvedValue({
      ...loopsResponse,
      loops: [
        {
          ...loop,
          rounds: loop.rounds.map(r => ({
            ...r,
            steps: statuses.map((status, i) => ({
              ...r.steps[0],
              nodeId: `s-${r.iteration}-${i}`,
              name: `step-${status}`,
              status,
            })),
          })),
        },
      ],
    });
    await render(api, '/namespaces/default/workflows/draft-1/runs/run-2');
    await userEvent.click(await screen.findByRole('tab', { name: 'Loops' }));
    const table = await screen.findByTestId('loop-table-draft-review');
    const tone = (status: string) =>
      within(table)
        .getAllByTitle(`step-${status}: ${status}`)[0]
        .className.match(/tp-tone-\w+/)?.[0];
    expect(tone('Terminated')).toBe('tp-tone-warning');
    expect(tone('Rejected')).toBe('tp-tone-danger');
    expect(tone('Retrying')).toBe('tp-tone-warning');
    expect(tone('Canceled')).toBe('tp-tone-neutral');
  });

  it('opens the round named in the link', async () => {
    const api = loopApi();
    await render(
      api,
      '/namespaces/default/workflows/draft-1/runs/run-2?loop=draft-review&round=1',
    );
    expect(await screen.findByTestId('step-activity-5')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('loop-round-draft-review-1')).toHaveAttribute(
        'data-focused',
        'true',
      ),
    );
    expect(screen.getByTestId('loop-round-draft-review-2')).toHaveAttribute(
      'data-focused',
      'false',
    );
  });

  it('shows the run of the chain in the header, with an explanation', async () => {
    const api = loopApi();
    api.getWorkflowGraph.mockResolvedValue({
      ...loopGraphResponse,
      runChain: {
        previousRunId: 'run-1',
        nextRunId: 'run-3',
        index: 2,
        total: 3,
      },
    });
    await render(api, '/namespaces/default/workflows/draft-1/runs/run-2');
    const chain = await screen.findByTestId('workflow-run-chain');
    expect(chain).toHaveTextContent('Run 2 of 3');
    expect(
      within(chain).getByRole('link', { name: '← Run 1' }),
    ).toHaveAttribute('href', expect.stringContaining('/runs/run-1'));
    expect(
      within(chain).getByRole('link', { name: 'Run 3 →' }),
    ).toHaveAttribute('href', expect.stringContaining('/runs/run-3'));
    // Screen readers read the explanation as the description of the button.
    expect(
      within(chain).getByRole('button', { name: 'About runs' }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('same Workflow ID, new Run ID'),
    );
    expect(screen.getByTestId('workflow-summary')).toHaveTextContent(
      'Workflow type',
    );
  });

  it('shows a loop of a run that continued as new as continuing', async () => {
    const api = loopApi();
    api.getWorkflow.mockResolvedValue({
      ...failedWorkflow,
      status: 'ContinuedAsNew',
      workflowId: 'draft-1',
      runId: 'run-2',
    });
    api.getWorkflowGraph.mockResolvedValue({
      ...loopGraphResponse,
      status: 'ContinuedAsNew',
      runChain: {
        previousRunId: 'run-1',
        nextRunId: 'run-3',
        index: 2,
        total: 3,
      },
      loops: loopGraphResponse.loops!.map(loop => ({
        ...loop,
        status: 'continued' as const,
        rounds: loop.rounds.map(r => ({ ...r, iteration: r.iteration + 10 })),
        iteration: 12,
      })),
    });
    await render(api, '/namespaces/default/workflows/draft-1/runs/run-2');
    const box = await screen.findByTestId('loop-draft-review');
    expect(box).toHaveAttribute(
      'aria-label',
      'Loop draft-review, round 12 of 5, continued in next run',
    );
    fireEvent.click(box);
    expect(
      await screen.findByTestId('loop-note-before-draft-review'),
    ).toHaveTextContent('Rounds 1–10 ran in earlier runs');
    expect(
      screen.getByTestId('loop-note-after-draft-review'),
    ).toHaveTextContent('The loop continues in run 3');
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
