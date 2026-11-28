/* eslint-disable */
// Temporary: writes the markup of the refactored views to DOM_DUMP_DIR, to
// compare before and after. Not part of the repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import {
  act,
  fireEvent,
  render as plainRender,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { identityApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { Entity } from '@backstage/catalog-model';
import type { WorkflowDetail, WorkflowGraphResponse } from './common';
import { temporalApiRef } from './extensions';
import { agentGraph } from './testGraphs/agentGraph';
import { ambiguousGraph } from './testGraphs/ambiguousGraph';
import { codecLoopGraph } from './testGraphs/codecLoopGraph';
import { loopGraph } from './testGraphs/loopGraph';
import { parallelGraph } from './testGraphs/parallelGraph';
import {
  entity,
  failedWorkflow,
  graphResponse,
  llmGraphResponse,
  mockTemporalApi,
  timelineNodes,
  TIMELINE_T0 as T0,
  workflowEntity as testWorkflowEntity,
} from './testData';
import { EntityTemporalContentPage } from './components/EntityTemporalContent';
import { TemporalPageContent } from './components/TemporalPage';
import { TemporalWorkflowSummaryCard } from './components/TemporalWorkflowSummaryCard';
import { WorkflowTimeline } from './components/timeline/WorkflowTimeline';

const DIR = process.env.DOM_DUMP_DIR!;
mkdirSync(DIR, { recursive: true });

const FIXED = Date.UTC(2026, 0, 1, 12, 0, 0);
jest.setTimeout(300000);

function dump(name: string) {
  const html = document.body.innerHTML
    .replace(/react-aria\d+-/g, 'react-aria-')
    .replace(/></g, '>\n<');
  writeFileSync(join(DIR, `${name}.html`), html);
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise(r => setTimeout(r, 30));
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers({
    now: FIXED,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
});
afterEach(() => {
  jest.useRealTimers();
});

// ---- Workflows tab -------------------------------------------------------

function wfEntity(name: string, i: number): Entity {
  return {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: {
      name,
      namespace: 'default',
      title: i % 2 ? `Title of ${name}` : undefined,
      description: i % 3 ? `Description of ${name}` : undefined,
      tags: i % 2 ? ['a', 'b'] : undefined,
    },
    spec: {
      owner: 'group:default/team-a',
      workflowType: `${name}Type`,
      taskQueue: i % 2 ? 'orders' : undefined,
      namespace: i % 3 ? 'other' : undefined,
      lifecycle: 'production',
    },
    relations: [
      { type: 'ownedBy', targetRef: 'group:default/team-a' },
      ...(i % 2
        ? [{ type: 'partOf', targetRef: 'system:default/shop' }]
        : []),
      ...(i % 3
        ? [{ type: 'dependencyOf', targetRef: 'component:default/web' }]
        : []),
    ],
  };
}

function catalog(entities: Entity[]) {
  return {
    queryEntities: jest.fn(async (request: any) => {
      const start = request.cursor ? Number(request.cursor) : 0;
      const items = entities.slice(start, start + request.limit);
      const next = start + request.limit;
      return {
        items,
        totalItems: entities.length,
        pageInfo: {
          nextCursor: next < entities.length ? String(next) : undefined,
        },
      };
    }),
    getEntityFacets: jest.fn(async () => ({
      facets: {
        'relations.ownedBy': [
          { value: 'group:default/team-a', count: 1 },
          { value: 'group:default/team-b', count: 1 },
        ],
        'relations.partOf': [
          { value: 'system:default/shop', count: 1 },
          { value: 'domain:default/x', count: 1 },
        ],
        'spec.lifecycle': [{ value: 'production', count: 1 }],
      },
    })),
  };
}

function typesApi(variant: string) {
  const api = mockTemporalApi();
  api.getWorkflowTypeOverview.mockImplementation(async (refs: string[]) => {
    if (variant === 'fail') throw new Error('Temporal is down');
    return {
      items: refs
        .filter((_, i) => !(variant === 'mixed' && i === 3))
        .map((entityRef, i) => ({
          entityRef,
          running: i,
          completed: i * 10,
          failed: i % 2,
          windowDays: 7,
          sampleSize: 50,
          averageDurationMs: i ? 4500 * i : undefined,
          latestRun: i
            ? {
                namespace: 'default',
                workflowId: `wf-${i}`,
                runId: 'run-1',
                status: i % 2 ? ('Completed' as const) : ('Failed' as const),
                startTime: i === 4 ? 'not a date' : '2026-01-01T10:00:00Z',
                closeTime: '2026-01-01T10:00:04Z',
              }
            : undefined,
          lastFailure:
            i % 2 === 0 && i
              ? {
                  namespace: 'default',
                  workflowId: `wf-failed-${i}`,
                  runId: 'run-9',
                  status: 'Failed' as const,
                  startTime: '2026-01-01T09:00:00Z',
                  closeTime: '2026-01-01T09:00:04Z',
                }
              : undefined,
          error:
            variant === 'mixed' && i === 1
              ? { message: 'Rate limited', rateLimited: true }
              : variant === 'mixed' && i === 2
              ? { message: 'Query failed' }
              : undefined,
          updatedAt: new Date(FIXED - 42_000 - i * 1000).toISOString(),
        })),
    };
  });
  return api;
}

async function renderTypes(variant: string, path: string, groups = true) {
  const entities = Array.from({ length: 60 }, (_, i) =>
    wfEntity(`wf-${String(i).padStart(2, '0')}`, i),
  );
  const cat = catalog(variant === 'empty' ? [] : entities);
  if (variant === 'catalog-error') {
    cat.queryEntities.mockRejectedValue(new Error('Catalog is down'));
  }
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, typesApi(variant)],
        [catalogApiRef, cat],
        [
          identityApiRef,
          mockApis.identity({
            userEntityRef: 'user:default/guest',
            ownershipEntityRefs: groups
              ? ['user:default/guest', 'group:default/team-a']
              : ['user:default/guest'],
          }),
        ],
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

describe('Workflows tab', () => {
  it.each([
    ['ok', '/', true],
    ['ok', '/', false],
    ['ok', '/?q=wf&owner=all&system=system:default/shop&lifecycle=production', true],
    ['ok', '/?owner=group:default/team-b', true],
    ['mixed', '/', true],
    ['fail', '/', true],
    ['empty', '/', true],
    ['catalog-error', '/', true],
  ])('%s %s %s', async (variant, path, groups) => {
    await renderTypes(variant as string, path as string, groups as boolean);
    await settle();
    dump(`types-${variant}-${groups}-${encodeURIComponent(path as string)}`);
  });

  it('columns, sort, next page, retry', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTypes('mixed', '/');
    await settle();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    for (const name of ['Lifecycle', 'Namespace / Task queue', 'Used by', 'Tags']) {
      await user.click(await screen.findByRole('menuitemcheckbox', { name }));
    }
    await user.keyboard('{Escape}');
    await settle();
    dump('types-columns');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await settle();
    dump('types-page2');
    await user.click(screen.getByRole('columnheader', { name: /Workflow/ }));
    await settle();
    dump('types-sorted');
    const retry = screen.queryAllByRole('button', { name: /^Retry/ });
    if (retry.length) await user.click(retry[0]);
    await settle();
    dump('types-retried');
  });
});

// ---- Details page --------------------------------------------------------

const RUN = '/namespaces/default/workflows/payment-1/runs/run-2';

function detailApi(
  graph: WorkflowGraphResponse,
  workflow: Partial<WorkflowDetail> = {},
) {
  const api = mockTemporalApi();
  api.getWorkflowGraph.mockResolvedValue(graph);
  api.getWorkflow.mockResolvedValue({ ...failedWorkflow, ...workflow });
  return api;
}

async function renderDetail(
  api: ReturnType<typeof mockTemporalApi>,
  path: string,
  inEntity: boolean,
) {
  const content = inEntity ? (
    <EntityProvider entity={entity}>
      <EntityTemporalContentPage />
    </EntityProvider>
  ) : (
    <TemporalPageContent
      workflowActions={[
        { id: 'one', component: () => <button type="button">One</button> },
        {
          id: 'hidden',
          component: () => <button type="button">Hidden</button>,
          filter: () => false,
        },
      ]}
      workflowSections={[
        { id: 'extra', title: 'Extra', component: () => <p>Extra section</p> },
      ]}
    />
  );
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      {content}
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

const graphs: Record<string, WorkflowGraphResponse> = {
  basic: graphResponse,
  llm: llmGraphResponse,
  loop: loopGraph,
  agent: agentGraph,
  parallel: parallelGraph,
  codec: codecLoopGraph,
  ambiguous: ambiguousGraph,
};

const firstStep = (g: WorkflowGraphResponse) =>
  g.nodes.find(n => !n.internal && n.kind === 'activity')?.id ??
  g.nodes[1]?.id;

describe('details page', () => {
  for (const [name, graph] of Object.entries(graphs)) {
    const step = firstStep(graph);
    const queries = [
      '',
      '?tab=timeline',
      '?tab=event-groups',
      '?tab=events',
      '?tab=details',
      '?tab=section-extra',
      `?step=${step}`,
      `?tab=timeline&step=${step}`,
    ];
    it.each(queries)(`${name} %s`, async query => {
      for (const inEntity of [false, true]) {
        const { unmount } = await renderDetail(
          detailApi(graph),
          `${RUN}${query}`,
          inEntity,
        );
        await settle();
        dump(`detail-${name}-${inEntity ? 'entity' : 'page'}-${encodeURIComponent(query)}`);
        unmount();
      }
    });
  }

  const variants: Record<string, [WorkflowGraphResponse, Partial<WorkflowDetail>]> = {
    running: [
      {
        ...graphResponse,
        status: 'Running',
        current: 'Waiting for the signal approve, which is a rather long text',
        currentDeadline: { time: '2026-01-01T13:00:00Z', kind: 'timer' } as any,
        runChain: { index: 2, total: 3, previousRunId: 'run-1', nextRunId: 'run-3' },
      },
      { status: 'Running', closeTime: undefined, failure: undefined },
    ],
    'chain-unknown': [
      { ...graphResponse, current: 'Done', runChain: { previousRunId: 'run-1' } as any },
      { status: 'Completed', failure: undefined, pendingActivities: [] },
    ],
    'chain-alone': [
      { ...graphResponse, runChain: {} as any, truncated: true, eventGroupsTruncated: true },
      {
        status: 'Completed',
        searchAttributes: { CustomKeywordField: 'x' } as any,
        memo: { note: { value: 'hello' } } as any,
        parent: { namespace: 'default', workflowId: 'parent-1', runId: 'p-run' } as any,
        entityRef: 'component:default/orders',
        workflowTypeEntityRef: 'temporalworkflow:default/payment',
        webUiUrl: undefined,
      },
    ],
    continued: [
      { ...graphResponse, status: 'ContinuedAsNew', runChain: { index: 1, total: 2, nextRunId: 'run-3' } },
      { status: 'ContinuedAsNew', failure: undefined },
    ],
    'continued-own': [
      { ...graphResponse, status: 'ContinuedAsNew' },
      { status: 'ContinuedAsNew', continuedAsNewRunId: 'run-next', failure: undefined },
    ],
  };
  it.each(Object.keys(variants))('variant %s', async key => {
    const [graph, workflow] = variants[key];
    for (const query of ['', '?tab=details', '?tab=timeline']) {
      const { unmount } = await renderDetail(
        detailApi(graph, workflow),
        `${RUN}${query}`,
        false,
      );
      await settle();
      dump(`detail-variant-${key}-${encodeURIComponent(query)}`);
      unmount();
    }
  });

  it('not latest run, errors and loading', async () => {
    let api = detailApi(graphResponse, { status: 'Completed', failure: undefined });
    api.listWorkflowRuns.mockResolvedValue({
      namespace: 'default',
      items: [{ ...failedWorkflow, runId: 'run-newer' }],
    } as any);
    let r = await renderDetail(api, RUN, false);
    await settle();
    dump('detail-not-latest');
    r.unmount();

    api = detailApi(graphResponse);
    api.getWorkflowGraph.mockRejectedValue(new Error('No graph'));
    for (const query of ['', '?tab=timeline', '?tab=events']) {
      r = await renderDetail(api, `${RUN}${query}`, false);
      await settle();
      dump(`detail-graph-error-${encodeURIComponent(query)}`);
      r.unmount();
    }

    api = detailApi(graphResponse);
    api.getWorkflow.mockRejectedValue(new Error('No workflow'));
    r = await renderDetail(api, RUN, true);
    await settle();
    dump('detail-workflow-error');
    r.unmount();

    api = detailApi(graphResponse);
    api.getWorkflow.mockReturnValue(new Promise(() => {}));
    r = await renderDetail(api, RUN, true);
    await settle();
    dump('detail-loading');
    r.unmount();
  });

  it('interactions', async () => {
    const user = userEvent.setup({ delay: null });
    await renderDetail(detailApi(loopGraph), RUN, false);
    await settle();
    const graph = screen.getByTestId('workflow-graph');
    const boxes = graph.querySelectorAll<HTMLElement>('[role="button"], button');
    await user.click(boxes[2]);
    await settle();
    dump('detail-interact-1-selected');
    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    await settle();
    dump('detail-interact-2-timeline');
    const bars = document.querySelectorAll<HTMLElement>('[data-testid^="timeline-bar-"]');
    await user.click(bars[1]);
    await settle();
    dump('detail-interact-3-timeline-selected');
    await user.click(screen.getByRole('tab', { name: 'Event Groups' }));
    await settle();
    dump('detail-interact-4-event-groups');
    const show = screen.queryAllByRole('button', { name: /Show/ });
    if (show.length) await user.click(show[0]);
    await settle();
    dump('detail-interact-5-group-shown');
    await user.click(screen.getByRole('tab', { name: 'Steps' }));
    await settle();
    const rows = screen.getAllByRole('row');
    await user.click(rows[3]);
    await settle();
    dump('detail-interact-6-steps-row');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    dump('detail-interact-7-refreshed');
  });
});

// ---- Timeline ------------------------------------------------------------

function mockRect(el: HTMLElement, left: number, width: number, height = 28) {
  el.getBoundingClientRect = () =>
    ({ left, right: left + width, width, top: 0, bottom: height, height, x: left, y: 0, toJSON: () => ({}) } as DOMRect);
}

function TimelineHarness(props: { graph: WorkflowGraphResponse; showMarkers?: boolean }) {
  const [selected, setSelected] = useState<string | undefined>();
  return (
    <WorkflowTimeline
      graph={props.graph}
      workflow={{ runId: 'run-1', status: 'Running', startTime: new Date(T0).toISOString() }}
      now={T0 + 40_000}
      showMarkers={props.showMarkers}
      selectedId={selected}
      onSelect={setSelected}
    />
  );
}

describe('timeline', () => {
  const tl: WorkflowGraphResponse = {
    status: 'Running',
    nodes: timelineNodes,
    edges: [],
    completedSteps: 3,
    totalSteps: 5,
    truncated: false,
  };
  it('zoom, pan, drag, hover, select', () => {
    plainRender(<TimelineHarness graph={tl} />);
    dump('timeline-0');
    const axis = screen.getByTestId('timeline-axis');
    mockRect(axis, 300, 1000);
    const chart = screen.getByRole('group', { name: 'Workflow timeline' });
    mockRect(chart, 0, 1300, 400);
    const bars = document.querySelectorAll<HTMLElement>('[data-testid^="timeline-bar-"]');
    fireEvent.mouseEnter(bars[1], { clientX: 500, clientY: 50 });
    dump('timeline-1-hover-top');
    fireEvent.mouseMove(bars[2], { clientX: 1290, clientY: 350 });
    dump('timeline-2-hover-bottom');
    fireEvent.focus(bars[0]);
    dump('timeline-3-focus');
    fireEvent.mouseLeave(bars[0]);
    fireEvent.click(bars[1]);
    dump('timeline-4-selected');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    dump('timeline-5-zoom-in');
    fireEvent.wheel(chart, { clientX: 800, deltaY: -100, ctrlKey: true });
    dump('timeline-6-wheel-zoom');
    fireEvent.wheel(chart, { clientX: 800, deltaY: 200, shiftKey: true });
    dump('timeline-7-wheel-pan-shift');
    fireEvent.wheel(chart, { clientX: 800, deltaX: -300 });
    dump('timeline-8-wheel-pan-sideways');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    dump('timeline-9-zoom-out');
    fireEvent.click(screen.getByRole('button', { name: 'Whole run' }));
    dump('timeline-10-whole');
    fireEvent.pointerDown(chart, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(chart, { clientX: 502, pointerId: 1 });
    dump('timeline-11-drag-small');
    fireEvent.pointerMove(chart, { clientX: 700, pointerId: 1 });
    dump('timeline-12-dragging');
    fireEvent.click(bars[2]);
    fireEvent.pointerUp(chart, { clientX: 700, pointerId: 1 });
    dump('timeline-13-dragged');
    fireEvent.pointerDown(chart, { button: 0, clientX: 500, pointerId: 2 });
    fireEvent.pointerMove(chart, { clientX: 900, pointerId: 2 });
    fireEvent.pointerCancel(chart, { pointerId: 2 });
    dump('timeline-14-cancelled');
    fireEvent.pointerDown(chart, { button: 2, clientX: 500, pointerId: 3 });
    fireEvent.pointerMove(chart, { clientX: 900, pointerId: 3 });
    fireEvent.pointerDown(chart, { button: 0, clientX: 100, pointerId: 4 });
    fireEvent.pointerMove(chart, { clientX: 900, pointerId: 4 });
    dump('timeline-15-ignored');
  });

  it.each(Object.keys(graphs))('groups of %s', name => {
    for (const showMarkers of [false, true]) {
      const { unmount } = plainRender(
        <TimelineHarness graph={graphs[name]} showMarkers={showMarkers} />,
      );
      dump(`timeline-groups-${name}-${showMarkers}-0`);
      const toggles = screen.queryAllByRole('button', { expanded: false });
      if (toggles.length) fireEvent.click(toggles[0]);
      dump(`timeline-groups-${name}-${showMarkers}-1-toggled`);
      const all = screen.queryByRole('button', { name: 'Expand groups' });
      if (all) {
        fireEvent.click(all);
        dump(`timeline-groups-${name}-${showMarkers}-2-expanded`);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse groups' }));
        dump(`timeline-groups-${name}-${showMarkers}-3-collapsed`);
      }
      unmount();
    }
  });
});

// ---- The definition list and the confirm dialogs -------------------------

describe('shared components', () => {
  it('summary card', async () => {
    await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, mockTemporalApi()], [permissionApiRef, mockApis.permission()]]}>
        <EntityProvider entity={testWorkflowEntity}>
          <TemporalWorkflowSummaryCard />
        </EntityProvider>
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );
    await settle();
    dump('summary-card');
  });
});
