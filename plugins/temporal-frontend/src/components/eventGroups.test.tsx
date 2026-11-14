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
import { coreExtensionData } from '@backstage/frontend-plugin-api';
import {
  createExtensionTester,
  renderInTestApp as renderInNewApp,
} from '@backstage/frontend-test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { WorkflowGraphResponse } from '../common';
import { temporalApiRef } from '../extensions';
import temporalPlugin from '../alpha';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { groupNotice } from './graph/WorkflowGraph';
import { entity, failedWorkflow, mockTemporalApi } from '../testData';
import { agentGraph } from '../testGraphs/agentGraph';
import { codecLoopGraph } from '../testGraphs/codecLoopGraph';
import { loopGraph } from '../testGraphs/loopGraph';
import { loopGraphPayloadsHidden } from '../testGraphs/loopGraphPayloadsHidden';
import { parallelGraph } from '../testGraphs/parallelGraph';

const PATH = '/namespaces/default/workflows/groups-1/runs/run-1';

function groupApi(graph: WorkflowGraphResponse) {
  const api = mockTemporalApi();
  const start = graph.nodes.find(n => n.kind === 'workflowStarted');
  const end = graph.nodes.find(n => n.kind === 'workflowClosed');
  api.getWorkflow.mockResolvedValue({
    ...failedWorkflow,
    status: 'Completed',
    workflowId: 'groups-1',
    runId: 'run-1',
    startTime: start?.startTime ?? start?.endTime,
    closeTime: end?.endTime ?? end?.startTime,
    failure: undefined,
    pendingActivities: [],
  });
  api.getWorkflowGraph.mockResolvedValue(graph);
  return api;
}

function render(graph: WorkflowGraphResponse) {
  const api = groupApi(graph);
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
    { routeEntries: [PATH] },
  );
}

/** The graph without any event group, as from a run without them. */
function withoutGroups(graph: WorkflowGraphResponse): WorkflowGraphResponse {
  const { eventGroups: _groups, ...rest } = graph;
  return {
    ...rest,
    nodes: graph.nodes.map(({ groups: _g, ...node }) => node),
  };
}

const graphButtons = () =>
  within(screen.getByTestId('workflow-graph'))
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label'))
    .filter(label => label && !/zoom|fit view/i.test(label));

const roundKey = (n: number) => `label:loop:draft-review:${n}`;

describe('event groups on the workflow page', () => {
  it('draws the loop as a frame with its rounds collapsed, ×3', async () => {
    await render(loopGraph);
    const loop = await screen.findByTestId(
      'group-frame-label:loop:draft-review',
    );
    const title = within(loop).getByRole('button', { expanded: true });
    expect(title).toHaveTextContent('Loop draft-review×3');
    expect(within(loop).getByTestId('group-facts')).toHaveTextContent(
      /^Completed · \d+s$/,
    );
    // The rounds are a row of collapsed boxes with their steps counted.
    for (const n of [1, 2, 3]) {
      const round = screen.getByTestId(`group-${roundKey(n)}`);
      expect(round).toHaveAttribute('aria-expanded', 'false');
      expect(round).toHaveTextContent(`draft-review · round ${n}`);
      expect(round).toHaveTextContent(/Completed · \ds · 3 steps/);
    }
    expect(screen.queryByTestId('step-activity-5')).not.toBeInTheDocument();
    // A group of one step, and the group of the signal handler with a
    // button to the signal.
    expect(screen.getByTestId('group-frame-label:wrap-up')).toBeInTheDocument();
    const signal = screen.getByTestId('group-frame-event:29');
    expect(signal).toHaveAttribute('data-kind', 'event');
    expect(signal).toHaveTextContent('hint (29)');
    // Inside the graph, clicks are plain events, as in the loop tests.
    fireEvent.click(
      within(signal).getByRole('button', {
        name: 'Show the signal that started this group',
      }),
    );
    expect(await screen.findByTestId('step-drawer')).toHaveTextContent('hint');
  });

  it('expands and collapses a group from the graph, with the keyboard too', async () => {
    await render(loopGraph);
    const round = await screen.findByTestId(`group-${roundKey(2)}`);
    fireEvent.click(round);
    const frame = await screen.findByTestId(`group-frame-${roundKey(2)}`);
    expect(screen.getByTestId('step-activity-22')).toBeInTheDocument();
    expect(screen.getByTestId('step-activity-43')).toBeInTheDocument();
    // The step of the signal ran between the steps of the round: it stays
    // out of the round's frame, in its own group.
    expect(screen.getByTestId('step-activity-33')).toBeInTheDocument();
    // Only a group picked in the tab is marked.
    expect(frame).toHaveAttribute('data-focused', 'false');

    // Collapsing the loop hides every round in it.
    const collapse = within(
      screen.getByTestId('group-frame-label:loop:draft-review'),
    ).getByRole('button', { name: /^Collapse Event group Loop draft-review/ });
    collapse.focus();
    await userEvent.keyboard('{Enter}');
    const loop = await screen.findByTestId('group-label:loop:draft-review');
    expect(loop).toHaveAccessibleName(
      /^Event group Loop draft-review, 3 groups, completed, \d+s, 9 steps, collapsed$/,
    );
    expect(
      screen.queryByTestId(`group-${roundKey(1)}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-activity-22')).not.toBeInTheDocument();
    loop.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByTestId('group-frame-label:loop:draft-review');
    // The round opened before is open again.
    expect(
      screen.getByTestId(`group-frame-${roundKey(2)}`),
    ).toBeInTheDocument();
  });

  it('shows the tokens of the model calls of an agent round', async () => {
    await render(agentGraph);
    const loop = await screen.findByTestId('group-frame-label:loop:agent');
    expect(within(loop).getByTestId('group-facts')).toHaveTextContent(
      /Completed · .* · 1\.3k in · 180 out$/,
    );
    const round = screen.getByTestId('group-label:loop:agent:1');
    expect(round).toHaveTextContent('643 in · 90 out');
    fireEvent.click(round);
    const frame = await screen.findByTestId('group-frame-label:loop:agent:1');
    expect(frame).toHaveTextContent('6');
    // Model calls and tool calls are in the round.
    expect(
      screen
        .getAllByRole('button')
        .filter(b => /^Model call/.test(b.getAttribute('aria-label') ?? '')),
    ).toHaveLength(3);
    // A model call without a name has the model as its title, once.
    expect(
      screen.getByTestId('step-activity-11').textContent?.match(/fake-model/g),
    ).toHaveLength(1);
  });

  it('labels the steps of groups that share steps with another frame', async () => {
    await render(parallelGraph);
    await screen.findByTestId('group-frame-label:par:a');
    expect(screen.getByTestId('group-frame-label:par:b')).toBeInTheDocument();
    expect(
      screen.getByTestId('group-frame-label:par:a:sub'),
    ).toBeInTheDocument();
    // Tag X shares a step with Parallel A without being inside it.
    expect(
      screen.queryByTestId('group-frame-label:tag:x'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('group-tag-activity-52#groups'),
    ).toHaveTextContent('Tag X');
    // The tab says how the graph shows each group.
    await userEvent.click(screen.getByRole('tab', { name: 'Event Groups' }));
    expect(
      await screen.findByTestId('group-row-note-label:tag:x'),
    ).toHaveTextContent('Labels on its steps in the graph');
    expect(
      screen.queryByTestId('group-row-note-label:par:a'),
    ).not.toBeInTheDocument();
  });

  it('says why groups are not drawn as asked', () => {
    const base = {
      layout: { positions: new Map(), width: 0, height: 0, wrapped: false },
      plan: { boxes: new Map(), boxOf: new Map(), tags: new Map() },
      graph: { nodes: [], edges: [], frames: [], collapsed: [] },
      refused: [],
    };
    expect(groupNotice(undefined)).toBeUndefined();
    expect(groupNotice(base)).toBeUndefined();
    expect(groupNotice({ ...base, notice: 'failed' })).toMatch(
      /^The frames of the event groups could not be laid out; .* The Timeline and the Event Groups tab show every group\.$/,
    );
    expect(groupNotice({ ...base, notice: 'tooLarge' })).toMatch(
      /^The run is too long to draw frames/,
    );
    const refused = ['a', 'b', 'c'].map(id => ({
      ...loopGraph.eventGroups![0],
      key: `label:${id}`,
      name: id.toUpperCase(),
    }));
    expect(groupNotice({ ...base, refused })).toBe(
      '“A”, “B” and 1 more could not be expanded: the open groups already hold 300 boxes. Collapse another group, or see the steps in the Timeline or the Event Groups tab.',
    );
  });

  it('shows the ID of a group whose label is encoded, with a note', async () => {
    await render(codecLoopGraph);
    const loop = await screen.findByTestId(
      'group-frame-label:loop:draft-review',
    );
    expect(loop).toHaveTextContent('loop:draft-review');
    expect(within(loop).getByTestId('group-label-unreadable')).toHaveAttribute(
      'title',
      expect.stringContaining('payload codec'),
    );
  });

  it('draws the frames when the payloads are hidden', async () => {
    await render(loopGraphPayloadsHidden);
    expect(
      await screen.findByTestId('group-frame-label:loop:draft-review'),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`group-${roundKey(3)}`)).toBeInTheDocument();
  });

  it('says when the backend left out event groups', async () => {
    await render({ ...loopGraph, eventGroupsTruncated: true });
    expect(
      await screen.findByText(
        'The run has more event groups than the backend reads; some groups are left out.',
      ),
    ).toBeInTheDocument();
  });

  it('draws a run without event groups as before', async () => {
    const plain = withoutGroups(loopGraph);
    await render(plain);
    await screen.findByTestId('step-activity-5');
    // Every step that is not internal, and nothing else.
    expect(graphButtons()).toHaveLength(
      plain.nodes.filter(n => !n.internal).length,
    );
    expect(document.querySelector('[data-testid^="group-"]')).toBeNull();
    expect(
      screen.queryByRole('tab', { name: 'Event Groups' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/more event groups/)).not.toBeInTheDocument();
  });

  it('lists the groups in the Event Groups tab and shows one in the graph', async () => {
    await render(loopGraph);
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Event Groups' }),
    );
    const table = await screen.findByRole('grid', { name: 'Event groups' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map(r => r.querySelector('[data-group-level]')?.textContent),
    ).toEqual([
      'Loop draft-review',
      'draft-review · round 1',
      'draft-review · round 2',
      'draft-review · round 3',
      'hint (29)',
      'Wrap-up',
    ]);
    expect(
      rows.map(r =>
        r.querySelector('[data-group-level]')?.getAttribute('data-group-level'),
      ),
    ).toEqual(['0', '1', '1', '1', '0', '0']);
    expect(rows[0]).toHaveTextContent(/^Loop draft-reviewLabelCompleted93/);
    expect(rows[4]).toHaveTextContent(/^hint \(29\)SignalCompleted1/);

    // A round opens in the graph and is brought into view.
    await userEvent.click(within(rows[2]).getByText('draft-review · round 2'));
    const frame = await screen.findByTestId(`group-frame-${roundKey(2)}`);
    await waitFor(() => expect(frame).toHaveAttribute('data-focused', 'true'));
    expect(screen.getByTestId('step-activity-22')).toBeInTheDocument();
    // Pressing the graph clears the mark.
    fireEvent.pointerDown(screen.getByTestId('workflow-graph'));
    await waitFor(() => expect(frame).toHaveAttribute('data-focused', 'false'));
  });

  it('opens the groups of a step picked in the Steps tab', async () => {
    await render(loopGraph);
    await screen.findByTestId(`group-${roundKey(3)}`);
    await userEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    const steps = await screen.findAllByText('review');
    await userEvent.click(steps[steps.length - 1]);
    await screen.findByTestId(`group-frame-${roundKey(3)}`);
    expect(screen.getByTestId('step-activity-60')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('groups the timeline by event group, indented, rounds collapsed', async () => {
    await render(loopGraph);
    await userEvent.click(await screen.findByRole('tab', { name: 'Timeline' }));
    const loop = await screen.findByTestId(
      'timeline-group-label:loop:draft-review',
    );
    expect(within(loop).getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(loop).toHaveTextContent('Loop draft-review ×3');
    const round = screen.getByTestId(`timeline-group-${roundKey(1)}`);
    expect(within(round).getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(round).toHaveTextContent('draft-review · round 1 · 3 steps');
    expect(screen.queryByTestId('timeline-bar-activity-5')).toBeNull();
    await userEvent.click(within(round).getByRole('button'));
    expect(screen.getByTestId('timeline-bar-activity-5')).toBeInTheDocument();
    // Collapse all, expand all.
    await userEvent.click(
      screen.getByRole('button', { name: 'Collapse groups' }),
    );
    expect(screen.queryByTestId(`timeline-group-${roundKey(1)}`)).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Expand groups' }),
    );
    expect(screen.getByTestId('timeline-bar-activity-60')).toBeInTheDocument();
  });

  it('shows the groups in the new frontend system too', async () => {
    for (const id of ['entity-content:temporal', 'page:temporal']) {
      const element = createExtensionTester(
        temporalPlugin.getExtension(id as 'page:temporal'),
      ).get(coreExtensionData.reactElement);
      const { unmount } = renderInNewApp(
        <EntityProvider entity={entity}>{element}</EntityProvider>,
        {
          apis: [
            [temporalApiRef, groupApi(loopGraph)],
            [permissionApiRef, mockApis.permission()],
          ],
          initialRouteEntries: ['/namespaces/default/workflows/groups-1'],
        },
      );
      expect(
        await screen.findByTestId(
          'group-frame-label:loop:draft-review',
          {},
          { timeout: 10_000 },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Event Groups' }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
