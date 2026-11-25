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

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import {
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { WorkflowGraphNode, WorkflowGraphResponse } from '../common';
import { temporalApiRef, TemporalWorkflowSectionDef } from '../extensions';
import { agentGraph } from '../testGraphs/agentGraph';
import { loopGraph } from '../testGraphs/loopGraph';
import {
  entity,
  failedWorkflow,
  graphResponse,
  listResponse,
  mockTemporalApi,
} from '../testData';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { TemporalPageContent } from './TemporalPage';
import { AUTO_REFRESH_MS } from './useWorkflowData';
import {
  DEFAULT_DETAIL_TAB,
  isLinkableStep,
  resolveDetailStep,
  resolveDetailTab,
  withDetailStep,
  withDetailTab,
} from './detailState';

function Location() {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="location">{`${location.pathname}${location.search}`}</span>
      <span data-testid="navigation">{type}</span>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

const location = () => screen.getByTestId('location').textContent;
const navigation = () => screen.getByTestId('navigation').textContent;

function renderEntity(
  api: ReturnType<typeof mockTemporalApi>,
  path: string,
  workflowSections?: TemporalWorkflowSectionDef[],
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityTemporalContentPage workflowSections={workflowSections} />
      </EntityProvider>
      <Location />
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

function renderStandalone(
  api: ReturnType<typeof mockTemporalApi>,
  path: string,
  workflowSections?: TemporalWorkflowSectionDef[],
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <TemporalPageContent workflowSections={workflowSections} />
      <Location />
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

const makeNode = (
  id: string,
  kind: WorkflowGraphNode['kind'],
  extra: Partial<WorkflowGraphNode> = {},
): WorkflowGraphNode => ({
  id,
  kind,
  name: id,
  status: 'Completed',
  events: [],
  ...extra,
});

describe('detail query helpers', () => {
  it('marks all visible history-backed kinds as linkable and excludes waiting and internal nodes', () => {
    const linkableKinds: WorkflowGraphNode['kind'][] = [
      'workflowStarted',
      'workflowClosed',
      'activity',
      'timer',
      'signal',
      'signalSent',
      'update',
      'childWorkflow',
      'marker',
      'cancelRequest',
      'workflowTask',
    ];
    for (const kind of linkableKinds) {
      expect(isLinkableStep(makeNode(`node-${kind}`, kind))).toBe(true);
    }
    expect(isLinkableStep(makeNode('waiting', 'waiting'))).toBe(false);
    expect(
      isLinkableStep(
        makeNode('workflowTask-2', 'workflowTask', { internal: true }),
      ),
    ).toBe(false);
    expect(
      isLinkableStep(makeNode('event-9', 'event', { internal: true })),
    ).toBe(false);
  });

  it('resolves valid, missing, and unknown tabs', () => {
    const base = new Set(['steps', 'timeline', 'events', 'details']);
    expect(resolveDetailTab(new URLSearchParams(''), base)).toBe(
      DEFAULT_DETAIL_TAB,
    );
    expect(resolveDetailTab(new URLSearchParams('tab=events'), base)).toBe(
      'events',
    );
    expect(resolveDetailTab(new URLSearchParams('tab=nope'), base)).toBe(
      DEFAULT_DETAIL_TAB,
    );
    expect(
      resolveDetailTab(new URLSearchParams('tab=event-groups'), base),
    ).toBe(DEFAULT_DETAIL_TAB);

    const withExtras = new Set([...base, 'event-groups', 'section-approvals']);
    expect(
      resolveDetailTab(new URLSearchParams('tab=event-groups'), withExtras),
    ).toBe('event-groups');
    expect(
      resolveDetailTab(
        new URLSearchParams('tab=section-approvals'),
        withExtras,
      ),
    ).toBe('section-approvals');
  });

  it('resolves linkable steps and ignores missing, internal, and waiting steps', () => {
    const nodes = [
      makeNode('activity-11', 'activity'),
      makeNode('waiting', 'waiting'),
      makeNode('workflowTask-2', 'workflowTask', { internal: true }),
    ];
    expect(
      resolveDetailStep(new URLSearchParams('step=activity-11'), undefined),
    ).toBeUndefined();
    expect(resolveDetailStep(new URLSearchParams(''), nodes)).toBeUndefined();
    expect(
      resolveDetailStep(new URLSearchParams('step=missing'), nodes),
    ).toBeUndefined();
    expect(
      resolveDetailStep(new URLSearchParams('step=waiting'), nodes),
    ).toBeUndefined();
    expect(
      resolveDetailStep(new URLSearchParams('step=workflowTask-2'), nodes),
    ).toBeUndefined();
    expect(
      resolveDetailStep(new URLSearchParams('step=activity-11'), nodes)?.id,
    ).toBe('activity-11');
  });

  it('updates tab and step query params while preserving unrelated params', () => {
    const initial = new URLSearchParams('foo=bar&tab=events&step=activity-5');
    expect(withDetailTab(initial, 'details').toString()).toBe(
      'foo=bar&tab=details&step=activity-5',
    );
    expect(withDetailTab(initial, 'steps').toString()).toBe(
      'foo=bar&step=activity-5',
    );
    expect(withDetailStep(initial, 'activity-11').toString()).toBe(
      'foo=bar&tab=events&step=activity-11',
    );
    expect(withDetailStep(initial, undefined).toString()).toBe(
      'foo=bar&tab=events',
    );
  });
});

describe('WorkflowDetailPage URL query state', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('opens with ?tab and ?step on both EntityTemporalContent and TemporalPage', async () => {
    for (const renderFn of [renderEntity, renderStandalone]) {
      const api = mockTemporalApi();
      const { unmount } = await renderFn(
        api,
        '/namespaces/default/workflows/payment-1/runs/run-2?tab=events&step=activity-11',
      );
      expect(
        await screen.findByRole('tab', { name: 'Events' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('grouped-events')).toHaveTextContent(
        'chargeCard',
      );
      const drawers = screen.getAllByTestId('step-drawer');
      expect(drawers).toHaveLength(1);
      expect(drawers[0]).toHaveTextContent('Card declined');
      unmount();
    }
  });

  it('opens a single drawer in Timeline when initialized with ?tab=timeline&step=activity-11', async () => {
    const api = mockTemporalApi();
    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline&step=activity-11',
    );
    expect(
      await screen.findByRole('tab', { name: 'Timeline' }),
    ).toHaveAttribute('aria-selected', 'true');
    const timeline = await screen.findByTestId('workflow-timeline');
    const panel = timeline.closest('[role="tabpanel"]') as HTMLElement;
    expect(panel).toBeInTheDocument();
    const drawers = screen.getAllByTestId('step-drawer');
    expect(drawers).toHaveLength(1);
    expect(within(panel).getByTestId('step-drawer')).toHaveTextContent(
      'Card declined',
    );

    // The step belongs to the timeline: leaving the tab unselects it.
    await userEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2',
    );
    expect(screen.queryByTestId('step-drawer')).not.toBeInTheDocument();
  });

  it('keeps the drawer of a step opened from the URL next to the graph in Timeline', async () => {
    const api = mockTemporalApi();
    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-11',
    );
    const graphLayout = await screen.findByTestId('workflow-graph-layout');
    expect(
      await within(graphLayout).findByTestId('step-drawer'),
    ).toHaveTextContent('Card declined');

    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-11&tab=timeline',
    );
    const timeline = await screen.findByTestId('workflow-timeline');
    const panel = timeline.closest('[role="tabpanel"]') as HTMLElement;
    expect(screen.getAllByTestId('step-drawer')).toHaveLength(1);
    expect(within(graphLayout).getByTestId('step-drawer')).toHaveTextContent(
      'Card declined',
    );
    expect(within(panel).queryByTestId('step-drawer')).not.toBeInTheDocument();
    expect(
      within(timeline).getByTestId('timeline-bar-activity-11'),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('unselects a step picked in the timeline when another tab is opened', async () => {
    for (const tabName of ['Steps', 'Events']) {
      const api = mockTemporalApi();
      const { unmount } = await renderEntity(
        api,
        '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline',
      );
      const timeline = await screen.findByTestId('workflow-timeline');
      fireEvent.click(within(timeline).getByTestId('timeline-bar-activity-11'));
      expect(location()).toBe(
        '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline&step=activity-11',
      );
      expect(screen.getAllByTestId('step-drawer')).toHaveLength(1);
      expect(screen.getByTestId('step-activity-11')).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      await userEvent.click(screen.getByRole('tab', { name: tabName }));
      expect(location()).toBe(
        `/namespaces/default/workflows/payment-1/runs/run-2${
          tabName === 'Events' ? '?tab=events' : ''
        }`,
      );
      expect(screen.queryByTestId('step-drawer')).not.toBeInTheDocument();
      expect(screen.getByTestId('step-activity-11')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      unmount();
    }
  });

  it('does not select or reveal in the graph a step picked in the timeline', async () => {
    const api = mockTemporalApi();
    api.getWorkflowGraph.mockResolvedValue(agentGraph);
    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline',
    );
    const timeline = await screen.findByTestId('workflow-timeline');
    const round = screen.getByTestId('group-label:loop:agent:1');
    expect(round).toHaveAttribute('data-selected', 'false');
    // Opens the groups of the timeline only.
    await userEvent.click(
      within(timeline).getByRole('button', { name: 'Expand groups' }),
    );

    // A tool call in a collapsed round of the graph.
    // The first one is in round 1.
    fireEvent.click(
      within(timeline).getAllByTitle('search_docs · Activity')[0],
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline&step=activity-17',
    );
    const panel = timeline.closest('[role="tabpanel"]') as HTMLElement;
    const drawer = within(panel).getByTestId('step-drawer');
    expect(screen.getAllByTestId('step-drawer')).toHaveLength(1);
    expect(round).toHaveAttribute('data-selected', 'false');

    // Its model call, picked from the timeline drawer.
    await userEvent.click(
      within(drawer).getByRole('button', { name: /^Model call/ }),
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline&step=activity-11',
    );
    expect(within(panel).getByTestId('step-drawer')).toBeInTheDocument();
    expect(
      screen.queryByTestId('group-frame-label:loop:agent:1'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('group-label:loop:agent:1')).toHaveAttribute(
      'data-selected',
      'false',
    );
  });

  it('supports details and extension section tabs from the URL', async () => {
    const sections: TemporalWorkflowSectionDef[] = [
      {
        id: 'approvals',
        title: 'Approvals',
        component: () => <div data-testid="approvals-body">Approved</div>,
      },
    ];
    const api1 = mockTemporalApi();
    const first = await renderEntity(
      api1,
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=details',
      sections,
    );
    expect(await screen.findByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByTestId('failure-level').length).toBeGreaterThan(0);
    first.unmount();

    const api2 = mockTemporalApi();
    await renderStandalone(
      api2,
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=section-approvals',
      sections,
    );
    expect(
      await screen.findByRole('tab', { name: 'Approvals' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('approvals-body')).toBeInTheDocument();
  });

  it('preserves ?tab=event-groups and ?step across async graph load and reveals collapsed group', async () => {
    const api = mockTemporalApi();
    let resolveGraph!: (value: WorkflowGraphResponse) => void;
    api.getWorkflowGraph.mockReturnValue(
      new Promise<WorkflowGraphResponse>(resolve => {
        resolveGraph = resolve;
      }),
    );

    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=event-groups&step=activity-33',
    );
    await waitFor(() => expect(api.getWorkflowGraph).toHaveBeenCalled());
    // Still holds the URL params while the graph is loading.
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=event-groups&step=activity-33',
    );

    await act(async () => {
      resolveGraph(loopGraph);
    });
    expect(
      await screen.findByRole('tab', { name: 'Event Groups' }),
    ).toHaveAttribute('aria-selected', 'true');
    const drawer = await screen.findByTestId('step-drawer');
    expect(drawer).toHaveTextContent('notify');
    // Collapsed group holding `activity-33` is expanded automatically.
    expect(
      await screen.findByTestId('group-frame-event:29'),
    ).toBeInTheDocument();
  });

  it('enables Show markers when initialized with a marker step ID', async () => {
    const api = mockTemporalApi();
    const markerNode: WorkflowGraphNode = {
      id: 'marker-9',
      kind: 'marker',
      name: 'SideEffect',
      status: 'Completed',
      startTime: '2026-01-01T11:00:00.200Z',
      endTime: '2026-01-01T11:00:00.200Z',
      details: { markerName: 'SideEffect' },
      events: [{ eventId: '9', eventType: 'MarkerRecorded' }],
    };
    api.getWorkflowGraph.mockResolvedValue({
      ...graphResponse,
      nodes: [
        graphResponse.nodes[0],
        markerNode,
        ...graphResponse.nodes.slice(1),
      ],
      edges: [
        { id: 'start->marker-9', source: 'start', target: 'marker-9' },
        {
          id: 'marker-9->activity-5',
          source: 'marker-9',
          target: 'activity-5',
        },
        ...graphResponse.edges.slice(1),
      ],
    });

    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?step=marker-9',
    );
    const drawer = await screen.findByTestId('step-drawer');
    expect(drawer).toHaveTextContent('SideEffect');
    expect(screen.getByRole('switch', { name: 'Show markers' })).toBeChecked();
  });

  it('updates URL with replace when switching tabs or picking/closing steps, without adding browser history', async () => {
    const api = mockTemporalApi();
    await renderStandalone(api, '/?status=Failed');
    await screen.findByRole('grid', { name: 'Workflow executions' });
    await userEvent.click(screen.getByRole('link', { name: 'payment-1' }));

    await screen.findByRole('grid', { name: 'Steps' });
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2',
    );

    // Switch tab -> REPLACE, sets ?tab=timeline.
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline',
    );
    expect(navigation()).toBe('REPLACE');

    // Click a bar in Timeline -> REPLACE, preserves tab and sets step.
    const bar = within(screen.getByTestId('workflow-timeline')).getByRole(
      'button',
      { name: /^chargeCard, Failed/ },
    );
    fireEvent.click(bar);
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=timeline&step=activity-11',
    );
    expect(navigation()).toBe('REPLACE');

    // Switch to Events (unselects the timeline step), pick another step via
    // "Show step" -> sets step, preserves tab=events.
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=events',
    );
    const grouped = screen.getByTestId('grouped-events');
    const reserveGroup = within(grouped)
      .getByText('reserveStock')
      .closest('details') as HTMLElement;
    await userEvent.click(
      within(reserveGroup).getByRole('button', { name: 'Show step' }),
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=events&step=activity-5',
    );
    expect(navigation()).toBe('REPLACE');
    expect(screen.getByTestId('step-drawer')).toHaveTextContent('BOOK-1');

    // Switch to Details, then back to Steps (omits tab), select row in Steps table, close drawer.
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?tab=details&step=activity-5',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-5',
    );
    await userEvent.click(
      within(screen.getByRole('grid', { name: 'Steps' })).getByText(
        'chargeCard',
      ),
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-11',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Close step details' }),
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2',
    );

    // Browser Back returns directly to the workflow list (one step back).
    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(location()).toBe('/?status=Failed');
    expect(listResponse.items[1].workflowId).toBe('payment-1');
  });

  it('preserves unrelated query params across tab and step updates', async () => {
    const api = mockTemporalApi();
    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?keep=1',
    );
    await screen.findByRole('grid', { name: 'Steps' });
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?keep=1&tab=events',
    );
    fireEvent.click(
      within(screen.getByTestId('workflow-graph')).getByRole('button', {
        name: 'reserveStock, Completed',
      }),
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?keep=1&tab=events&step=activity-5',
    );
  });

  it('does not persist ephemeral waiting steps in URL and ignores ?step=waiting', async () => {
    const waitingGraph: WorkflowGraphResponse = {
      status: 'Running',
      completedSteps: 1,
      totalSteps: 1,
      truncated: false,
      payloadsHidden: false,
      nodes: [
        graphResponse.nodes[0],
        graphResponse.nodes[2],
        {
          id: 'waiting',
          kind: 'waiting',
          name: 'Waiting',
          status: 'Waiting',
          waitingFor: 'Waiting for approval',
          events: [],
        },
      ],
      edges: [
        { id: 'start->activity-5', source: 'start', target: 'activity-5' },
        { id: 'activity-5->waiting', source: 'activity-5', target: 'waiting' },
      ],
    };
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue({ ...failedWorkflow, status: 'Running' });
    api.getWorkflowGraph.mockResolvedValue(waitingGraph);

    // 1. Opening ?step=waiting ignores it without error.
    const first = await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?step=waiting',
    );
    await screen.findByTestId('step-waiting');
    expect(screen.queryByTestId('step-drawer')).not.toBeInTheDocument();
    first.unmount();

    // 2. Clicking the waiting node opens its drawer locally without writing step=waiting to URL.
    await renderEntity(
      api,
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-5',
    );
    expect(await screen.findByTestId('step-drawer')).toHaveTextContent(
      'BOOK-1',
    );
    fireEvent.click(screen.getByTestId('step-waiting'));
    expect(screen.getByTestId('step-drawer')).toHaveTextContent(
      'Waiting for approval',
    );
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2',
    );

    // Selecting a stable step resumes writing ?step=... to the URL.
    fireEvent.click(screen.getByTestId('step-activity-5'));
    expect(location()).toBe(
      '/namespaces/default/workflows/payment-1/runs/run-2?step=activity-5',
    );
  });

  it('ignores unknown tab, unknown step, and internal step IDs without error', async () => {
    for (const query of [
      '?tab=nonexistent&step=does-not-exist',
      '?tab=event-groups',
      '?tab=steps&step=workflowTask-2',
    ]) {
      const api = mockTemporalApi();
      const { unmount } = await renderEntity(
        api,
        `/namespaces/default/workflows/payment-1/runs/run-2${query}`,
      );
      expect(await screen.findByRole('tab', { name: 'Steps' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.queryByTestId('step-drawer')).not.toBeInTheDocument();
      expect(screen.getByRole('grid', { name: 'Steps' })).toBeInTheDocument();
      unmount();
    }
  });

  it('keeps URL-selected step open across auto-refresh ticks', async () => {
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue({ ...failedWorkflow, status: 'Running' });
    const intervals: (() => void)[] = [];
    const setIntervalSpy = jest
      .spyOn(window, 'setInterval')
      .mockImplementation(((fn: () => void, ms: number) => {
        if (ms === AUTO_REFRESH_MS) intervals.push(fn);
        return intervals.length as any;
      }) as any);
    try {
      await renderEntity(
        api,
        '/namespaces/default/workflows/payment-1/runs/run-2?tab=events&step=activity-5',
      );
      expect(await screen.findByTestId('step-drawer')).toHaveTextContent(
        'BOOK-1',
      );
      expect(intervals.length).toBeGreaterThan(0);
      intervals[intervals.length - 1]();
      await waitFor(() => expect(api.getWorkflow).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('step-drawer')).toHaveTextContent('BOOK-1');
      expect(location()).toBe(
        '/namespaces/default/workflows/payment-1/runs/run-2?tab=events&step=activity-5',
      );
      expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
