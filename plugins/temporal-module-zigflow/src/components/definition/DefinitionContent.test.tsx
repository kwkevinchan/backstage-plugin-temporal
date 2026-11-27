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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { parse } from 'yaml';
import type { Entity } from '@backstage/catalog-model';
import {
  compatWrapper,
  convertLegacyRouteRef,
} from '@backstage/core-compat-api';
import { renderInTestApp as renderInFrontendTestApp } from '@backstage/frontend-test-utils';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { listResponse, mockTemporalApi } from '../../testData';

import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-frontend';
import { entityContentRouteRef } from '@kwkevinchan/backstage-plugin-temporal-frontend/ui';
import type { WorkflowGraphResponse } from '@kwkevinchan/backstage-plugin-temporal-frontend/common';
import type { WorkflowDefinitionResponse } from '../../common/definition';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { EntityTemporalDefinitionContentPage } from './DefinitionContent';

jest.mock('../../api', () => ({
  loadEntityDefinition: (_apis: unknown, entityRef: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testData').mockGetEntityDefinition(entityRef),
}));

const content = readFileSync(
  join(__dirname, '../../../../../test-fixtures/definitions/every-task.yaml'),
  'utf8',
);

const yamlEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-flow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'order-flow',
    definition: { format: 'serverless-workflow', target: './order.yaml' },
  },
};

const codeEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'order-workflow',
    namespace: 'default',
    annotations: {
      'backstage.io/source-location':
        'url:https://git.example.com/org/repo/tree/main/src/',
      'backstage.io/view-url':
        'https://git.example.com/org/repo/blob/main/src/workflows.ts',
    },
  },
  spec: { owner: 'group:default/team-a', workflowType: 'orderWorkflow' },
};

const definition: WorkflowDefinitionResponse = {
  entityRef: 'temporalworkflow:default/order-flow',
  format: 'serverless-workflow',
  target: './order.yaml',
  url: 'https://git.example.com/org/repo/blob/main/order.yaml',
  content,
  size: content.length,
  maxBytes: 1048576,
  document: parse(content),
  tasks: [
    { pointer: '/do/0/validate', name: 'validate', startLine: 10, endLine: 14 },
    { pointer: '/do/1/route', name: 'route', startLine: 15, endLine: 21 },
    {
      pointer: '/do/2/packItems',
      name: 'packItems',
      startLine: 22,
      endLine: 32,
    },
    {
      pointer: '/do/2/packItems/do/0/pack',
      name: 'pack',
      startLine: 28,
      endLine: 32,
    },
  ],
};

const runGraph: WorkflowGraphResponse = {
  status: 'Completed',
  nodes: [
    {
      id: 'activity-5',
      kind: 'activity',
      name: 'validateOrder',
      status: 'Completed',
      startTime: '2026-11-01T10:00:01Z',
      events: [],
    },
    {
      id: 'activity-9',
      kind: 'activity',
      name: 'order-flow.packItems.pack',
      status: 'Failed',
      startTime: '2026-11-01T10:00:02Z',
      events: [],
    },
  ],
  edges: [],
  completedSteps: 1,
  totalSteps: 2,
  truncated: false,
};

function render(
  entity: Entity,
  api: ReturnType<typeof mockTemporalApi>,
  path = '/',
  options?: {
    mountedRoutes?: Record<string, typeof entityContentRouteRef>;
  },
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api as any],
        // The definition route is mocked (jest.mock of ../../api).
        [discoveryApiRef, { getBaseUrl: async () => '/api/temporal' }],
        [fetchApiRef, { fetch: jest.fn() }],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityTemporalDefinitionContentPage />
      </EntityProvider>
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: options?.mountedRoutes ?? {
        '/temporal': entityContentRouteRef,
      },
    },
  );
}

/** The numbers of the rendered lines that carry a mark class. */
function markedLines(yaml: HTMLElement, mark: string): number[] {
  return [...yaml.querySelectorAll<HTMLElement>('[data-line]')]
    .filter(line => line.className.split(/\s+/).includes(mark))
    .map(line => Number(line.getAttribute('data-line')));
}

describe('Definition tab', () => {
  it('links to the source of a workflow written in code', async () => {
    const api = mockTemporalApi();
    await render(codeEntity, api);
    const card = await screen.findByTestId('definition-source-links');
    expect(
      within(card).getByRole('link', { name: /Source code/ }),
    ).toHaveAttribute(
      'href',
      'https://git.example.com/org/repo/tree/main/src/',
    );
    expect(
      within(card).getByRole('link', { name: /View the file/ }),
    ).toHaveAttribute(
      'href',
      'https://git.example.com/org/repo/blob/main/src/workflows.ts',
    );
    expect(api.getEntityDefinition).not.toHaveBeenCalled();
  });

  it.each([
    // eslint-disable-next-line no-script-url
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/relative/path',
    './src/workflows.ts',
  ])('hides View the file when backstage.io/view-url is %s', async viewUrl => {
    const api = mockTemporalApi();
    await render(
      {
        ...codeEntity,
        metadata: {
          ...codeEntity.metadata,
          annotations: {
            'backstage.io/source-location':
              'url:https://git.example.com/org/repo/tree/main/src/',
            'backstage.io/view-url': viewUrl,
          },
        },
      },
      api,
    );
    const card = await screen.findByTestId('definition-source-links');
    expect(
      within(card).getByRole('link', { name: /Source code/ }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole('link', { name: /View the file/ }),
    ).toBeNull();
  });

  it.each([
    'https://git.example.com/org/repo/blob/main/src/workflows.ts',
    'http://git.example.com/org/repo/blob/main/src/workflows.ts',
  ])('shows View the file when backstage.io/view-url is %s', async viewUrl => {
    const api = mockTemporalApi();
    await render(
      {
        ...codeEntity,
        metadata: {
          ...codeEntity.metadata,
          annotations: { 'backstage.io/view-url': viewUrl },
        },
      },
      api,
    );
    const card = await screen.findByTestId('definition-source-links');
    expect(
      within(card).getByRole('link', { name: /View the file/ }),
    ).toHaveAttribute('href', viewUrl);
  });

  it.each([
    'url:javascript:alert(1)',
    'url:data:text/html,x',
    'url:file:///tmp/x',
    'url:ftp://git.example.com/x',
  ])('hides Source code when backstage.io/source-location is %s', async loc => {
    const api = mockTemporalApi();
    await render(
      {
        ...codeEntity,
        metadata: {
          ...codeEntity.metadata,
          annotations: {
            'backstage.io/source-location': loc,
            'backstage.io/view-url':
              'https://git.example.com/org/repo/blob/main/src/workflows.ts',
          },
        },
      },
      api,
    );
    const card = await screen.findByTestId('definition-source-links');
    expect(
      within(card).getByRole('link', { name: /View the file/ }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole('link', { name: /Source code/ }),
    ).toBeNull();
  });

  it.each([
    [
      'url:https://git.example.com/org/repo/tree/main/src/',
      'https://git.example.com/org/repo/tree/main/src/',
    ],
    [
      'url:http://git.example.com/org/repo/tree/main/src/',
      'http://git.example.com/org/repo/tree/main/src/',
    ],
  ])(
    'shows Source code when backstage.io/source-location is %s',
    async (loc, expectedHref) => {
      const api = mockTemporalApi();
      await render(
        {
          ...codeEntity,
          metadata: {
            ...codeEntity.metadata,
            annotations: { 'backstage.io/source-location': loc },
          },
        },
        api,
      );
      const card = await screen.findByTestId('definition-source-links');
      expect(
        within(card).getByRole('link', { name: /Source code/ }),
      ).toHaveAttribute('href', expectedHref);
    },
  );

  it('shows the source of a workflow written in code, with its function marked', async () => {
    const api = mockTemporalApi();
    const source = [
      "import { sleep } from '@temporalio/workflow';",
      '',
      'export async function orderWorkflow(id: string) {',
      '  await sleep(1);',
      '  return id;',
      '}',
    ].join('\n');
    api.getEntityDefinition.mockResolvedValue({
      entityRef: 'temporalworkflow:default/order-workflow',
      format: 'source',
      target: './src/workflows.ts',
      content: source,
      size: source.length,
      maxBytes: 1048576,
      tasks: [],
      language: 'typescript',
      symbol: 'orderWorkflow',
      symbolLines: { startLine: 3, endLine: 6 },
    });
    await render(
      {
        ...codeEntity,
        spec: {
          ...codeEntity.spec,
          definition: { format: 'source', target: './src/workflows.ts' },
        },
      },
      api,
    );
    const card = await screen.findByTestId('definition-source');
    expect(card).toHaveTextContent(
      './src/workflows.ts · typescript · orderWorkflow, lines 3–6',
    );
    // The source links stay.
    expect(
      within(card).getByRole('link', { name: /View the file/ }),
    ).toBeInTheDocument();
    const code = screen.getByTestId('definition-yaml');
    expect(code).toHaveTextContent('export async function orderWorkflow');
    expect(
      screen.getByRole('textbox', { name: 'Workflow source' }),
    ).toBeInTheDocument();
    expect(markedLines(code, 'tp-yaml-band')).toEqual([3, 4, 5, 6]);
  });

  it('selects the task of a line, and the lines of a box', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    await render(yamlEntity, api);
    const yaml = await screen.findByTestId('definition-yaml');
    expect(yaml).toHaveTextContent('validateOrder');
    expect(api.getEntityDefinition).toHaveBeenCalledWith(
      'temporalworkflow:default/order-flow',
    );
    // The unknown task is drawn, marked unsupported.
    expect(
      screen.getByTestId('definition-node-/do/9/mystery'),
    ).toHaveAccessibleName('mystery, Unsupported task (teleport), unsupported');

    // A line of the YAML selects the innermost task around it.
    const line30 = yaml.querySelector('[data-line="30"]')!;
    fireEvent.click(line30);
    expect(
      screen.getByTestId('definition-node-/do/2/packItems/do/0/pack'),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('definition-yaml-band')).toHaveAttribute(
      'data-start',
      '28',
    );
    expect(screen.getByTestId('definition-task')).toHaveTextContent('28–32');
    // The marks are on the lines themselves, so they cannot drift from the
    // text: the band starts on line 28, covers 28–32 and nothing else, and
    // the cursor is on the line pressed.
    expect(screen.getByTestId('definition-yaml-band')).toHaveAttribute(
      'data-line',
      '28',
    );
    expect(markedLines(yaml, 'tp-yaml-band')).toEqual([28, 29, 30, 31, 32]);
    expect(markedLines(yaml, 'tp-yaml-cursor')).toEqual([30]);

    // A box selects its lines.
    fireEvent.click(screen.getByTestId('definition-node-/do/0/validate'));
    expect(screen.getByTestId('definition-yaml-band')).toHaveAttribute(
      'data-end',
      '14',
    );
    expect(
      screen.getByTestId('definition-node-/do/2/packItems/do/0/pack'),
    ).toHaveAttribute('aria-pressed', 'false');

    // The arrow keys move the cursor line, and the selection with it.
    fireEvent.keyDown(yaml.querySelector('.cm-content')!, { key: 'ArrowDown' });
    fireEvent.keyDown(yaml.querySelector('.cm-content')!, { key: 'ArrowDown' });
    expect(
      screen.getByTestId('definition-node-/do/0/validate'),
    ).toHaveAttribute('aria-pressed', 'true');
    for (let i = 0; i < 5; i++)
      fireEvent.keyDown(yaml.querySelector('.cm-content')!, {
        key: 'ArrowDown',
      });
    expect(screen.getByTestId('definition-node-/do/1/route')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows the YAML and the graph full screen', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    await render(yamlEntity, api);
    await screen.findByTestId('definition-yaml');
    const layout = screen.getByTestId('definition-layout');
    expect(layout).toHaveAttribute('data-fullscreen', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(layout).toHaveAttribute('data-fullscreen', 'true');
    expect(within(layout).getByTestId('definition-yaml')).toBeInTheDocument();
    expect(within(layout).getByTestId('definition-graph')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(layout).toHaveAttribute('data-fullscreen', 'false');
  });

  it('shows a run on top of the graph', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1');
    await waitFor(() =>
      expect(
        screen.getByTestId('definition-node-/do/0/validate'),
      ).toHaveAttribute('data-mark', 'Completed'),
    );
    expect(api.getWorkflowGraph).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'order-1', runId: 'run-1' },
      { entityRef: 'temporalworkflow:default/order-flow' },
    );
    expect(
      screen.getByTestId('definition-node-/do/2/packItems/do/0/pack'),
    ).toHaveAttribute('data-mark', 'Failed');
    expect(screen.getByTestId('definition-node-/do/7/notify')).toHaveAttribute(
      'data-mark',
      'NotReached',
    );
    expect(
      screen.getByTestId('definition-node-/do/6/cooldown'),
    ).not.toHaveAttribute('data-mark');
    expect(screen.getByTestId('definition-legend')).toHaveTextContent(
      'Not reached',
    );
    expect(screen.queryByTestId('definition-overlay-no-match')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/temporal/namespaces/default/workflows/order-1/runs/run-1',
    );
  });

  it('resolves Open the run to a custom Temporal tab path in the legacy frontend system', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    await render(
      yamlEntity,
      api,
      '/catalog/default/temporalworkflow/order-flow/definition?workflowId=order-1&runId=run-1',
      {
        mountedRoutes: {
          '/catalog/default/temporalworkflow/order-flow/workflows':
            entityContentRouteRef,
        },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('definition-node-/do/0/validate'),
      ).toHaveAttribute('data-mark', 'Completed'),
    );
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/catalog/default/temporalworkflow/order-flow/workflows/namespaces/default/workflows/order-1/runs/run-1',
    );
  });

  it('hides Open the run when the Temporal tab is not mounted in the legacy frontend system', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1', {
      mountedRoutes: {},
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('definition-node-/do/0/validate'),
      ).toHaveAttribute('data-mark', 'Completed'),
    );
    expect(screen.queryByRole('link', { name: 'Open the run' })).toBeNull();
  });

  it('resolves Open the run to the Temporal tab in the new frontend system', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    renderInFrontendTestApp(
      compatWrapper(
        <TestApiProvider
          apis={[
            [temporalApiRef, api as any],
            [discoveryApiRef, { getBaseUrl: async () => '/api/temporal' }],
            [fetchApiRef, { fetch: jest.fn() }],
            [permissionApiRef, mockApis.permission()],
          ]}
        >
          <EntityProvider entity={yamlEntity}>
            <EntityTemporalDefinitionContentPage />
          </EntityProvider>
        </TestApiProvider>,
      ),
      {
        initialRouteEntries: [
          '/catalog/default/temporalworkflow/order-flow/definition?workflowId=order-1&runId=run-1',
        ],
        mountedRoutes: {
          '/catalog/default/temporalworkflow/order-flow/workflows':
            convertLegacyRouteRef(entityContentRouteRef),
        },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('definition-node-/do/0/validate'),
      ).toHaveAttribute('data-mark', 'Completed'),
    );
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/catalog/default/temporalworkflow/order-flow/workflows/namespaces/default/workflows/order-1/runs/run-1',
    );
  });

  it('hides Open the run when the Temporal tab is not mounted in the new frontend system', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    renderInFrontendTestApp(
      compatWrapper(
        <TestApiProvider
          apis={[
            [temporalApiRef, api as any],
            [discoveryApiRef, { getBaseUrl: async () => '/api/temporal' }],
            [fetchApiRef, { fetch: jest.fn() }],
            [permissionApiRef, mockApis.permission()],
          ]}
        >
          <EntityProvider entity={yamlEntity}>
            <EntityTemporalDefinitionContentPage />
          </EntityProvider>
        </TestApiProvider>,
      ),
      {
        initialRouteEntries: ['/?workflowId=order-1&runId=run-1'],
      },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('definition-node-/do/0/validate'),
      ).toHaveAttribute('data-mark', 'Completed'),
    );
    expect(screen.queryByRole('link', { name: 'Open the run' })).toBeNull();
  });

  it('shows the latest run for a link with only a workflow ID', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    // Not among the runs of the entity's list: read from the run list.
    api.listWorkflowRuns.mockResolvedValue({
      namespace: 'default',
      items: [{ ...listResponse.items[0], workflowId: 'order-9', runId: 'r9' }],
    });
    await render(yamlEntity, api, '/?workflowId=order-9');
    await waitFor(() =>
      expect(api.getWorkflowGraph).toHaveBeenCalledWith(
        { namespace: 'default', workflowId: 'order-9', runId: 'r9' },
        { entityRef: 'temporalworkflow:default/order-flow' },
      ),
    );
    expect(api.listWorkflowRuns).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'order-9' },
      { entityRef: 'temporalworkflow:default/order-flow', pageSize: 1 },
    );
  });

  it('takes the run of a workflow ID in the list of the entity without reading the run list', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue(runGraph);
    await render(yamlEntity, api, '/?workflowId=order-1');
    await waitFor(() =>
      expect(api.getWorkflowGraph).toHaveBeenCalledWith(
        { namespace: 'default', workflowId: 'order-1', runId: 'run-1' },
        { entityRef: 'temporalworkflow:default/order-flow' },
      ),
    );
    expect(api.listWorkflowRuns).not.toHaveBeenCalled();
  });

  it('marks unfound tasks Unknown and warns when the run graph is truncated', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue({ ...runGraph, truncated: true });
    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1');

    const banner = await screen.findByTestId('definition-overlay-truncated');
    expect(banner).toHaveTextContent(
      'History truncated — only the start was matched',
    );
    expect(
      screen.getByTestId('definition-node-/do/0/validate'),
    ).toHaveAttribute('data-mark', 'Completed');
    expect(
      screen.getByTestId('definition-node-/do/2/packItems/do/0/pack'),
    ).toHaveAttribute('data-mark', 'Failed');

    const unknownNode = screen.getByTestId('definition-node-/do/7/notify');
    expect(unknownNode).toHaveAttribute('data-mark', 'Unknown');
    expect(unknownNode).toHaveAttribute('data-dashed', 'true');
    expect(unknownNode).toHaveAttribute('data-dimmed', 'false');
    expect(unknownNode).toHaveTextContent('Unknown');

    const legend = screen.getByTestId('definition-legend');
    expect(legend).toHaveTextContent('Unknown');
    expect(legend).not.toHaveTextContent('Not reached');
  });

  it('warns and marks tasks Unknown instead of Not reached when no task matches the run', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue({
      ...runGraph,
      nodes: [
        {
          id: 'activity-5',
          kind: 'activity',
          name: 'customWorkerStepA',
          status: 'Completed',
          startTime: '2026-11-01T10:00:01Z',
          events: [],
        },
        {
          id: 'activity-9',
          kind: 'activity',
          name: 'customWorkerStepB',
          status: 'Failed',
          startTime: '2026-11-01T10:00:02Z',
          events: [],
        },
      ],
      truncated: false,
    });
    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1');

    const banner = await screen.findByTestId('definition-overlay-no-match');
    expect(banner).toHaveTextContent('No tasks matched this run');
    expect(banner).toHaveTextContent(/activity names or workflow type/);
    expect(screen.queryByTestId('definition-overlay-truncated')).toBeNull();

    const validateNode = screen.getByTestId('definition-node-/do/0/validate');
    expect(validateNode).toHaveAttribute('data-mark', 'Unknown');
    expect(validateNode).toHaveAttribute('data-dashed', 'true');
    expect(validateNode).toHaveAttribute('data-dimmed', 'false');
    expect(
      screen.getByTestId('definition-node-/do/2/packItems/do/0/pack'),
    ).toHaveAttribute('data-mark', 'Unknown');
    expect(document.querySelectorAll('[data-mark="NotReached"]')).toHaveLength(
      0,
    );

    const legend = screen.getByTestId('definition-legend');
    expect(legend).toHaveTextContent('Unknown');
    expect(legend).not.toHaveTextContent('Not reached');
    expect(legend).toHaveTextContent('2 steps of the run match no task.');
  });

  it('shows a single combined warning when a truncated run matches no task', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    api.getWorkflowGraph.mockResolvedValue({
      ...runGraph,
      nodes: [
        {
          id: 'activity-5',
          kind: 'activity',
          name: 'unrecognizedActivity',
          status: 'Completed',
          startTime: '2026-11-01T10:00:01Z',
          events: [],
        },
      ],
      truncated: true,
    });
    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1');

    const banner = await screen.findByTestId('definition-overlay-no-match');
    expect(banner).toHaveTextContent(
      'No tasks matched this run (history truncated)',
    );
    expect(banner).toHaveTextContent(/unread part of the history/);
    expect(screen.queryByTestId('definition-overlay-truncated')).toBeNull();

    expect(
      screen.getByTestId('definition-node-/do/0/validate'),
    ).toHaveAttribute('data-mark', 'Unknown');
    expect(document.querySelectorAll('[data-mark="NotReached"]')).toHaveLength(
      0,
    );

    const legend = screen.getByTestId('definition-legend');
    expect(legend).toHaveTextContent('Unknown');
    expect(legend).not.toHaveTextContent('Not reached');
  });

  it('falls back to spec.namespace before default even when runs are empty or fail', async () => {
    const entityInBilling: Entity = {
      ...yamlEntity,
      spec: { ...yamlEntity.spec, namespace: 'billing' },
    };

    const emptyApi = mockTemporalApi();
    emptyApi.getEntityDefinition.mockResolvedValue(definition);
    emptyApi.listEntityWorkflows.mockResolvedValue({ items: [] });
    emptyApi.getWorkflowGraph.mockResolvedValue(runGraph);
    const emptyView = await render(
      entityInBilling,
      emptyApi,
      '/?workflowId=order-1&runId=run-1',
    );
    await waitFor(() =>
      expect(emptyApi.getWorkflowGraph).toHaveBeenCalledWith(
        { namespace: 'billing', workflowId: 'order-1', runId: 'run-1' },
        { entityRef: 'temporalworkflow:default/order-flow' },
      ),
    );
    emptyView.unmount();

    const failedApi = mockTemporalApi();
    failedApi.getEntityDefinition.mockResolvedValue(definition);
    failedApi.listEntityWorkflows.mockRejectedValue(new Error('list down'));
    failedApi.getWorkflowGraph.mockResolvedValue(runGraph);
    await render(
      entityInBilling,
      failedApi,
      '/?workflowId=order-1&runId=run-1',
    );
    await waitFor(() =>
      expect(failedApi.getWorkflowGraph).toHaveBeenCalledWith(
        { namespace: 'billing', workflowId: 'order-1', runId: 'run-1' },
        { entityRef: 'temporalworkflow:default/order-flow' },
      ),
    );
    expect(failedApi.getWorkflowGraph).not.toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'default' }),
      expect.anything(),
    );
  });

  it('waits to determine namespace before fetching run graph when URL has runId', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue(definition);
    let resolveRuns!: (value: { items: any[] }) => void;
    api.listEntityWorkflows.mockReturnValue(
      new Promise(resolve => {
        resolveRuns = resolve;
      }),
    );
    api.getWorkflowGraph.mockResolvedValue(runGraph);

    await render(yamlEntity, api, '/?workflowId=order-1&runId=run-1');
    await screen.findByTestId('definition-layout');
    // Must not fire a speculative request against 'default' before listEntityWorkflows settles.
    expect(api.getWorkflowGraph).not.toHaveBeenCalled();

    resolveRuns({
      items: [
        {
          ...listResponse.items[0],
          namespace: 'orders',
          workflowId: 'order-1',
          runId: 'run-1',
        },
      ],
    });
    await waitFor(() =>
      expect(api.getWorkflowGraph).toHaveBeenCalledWith(
        { namespace: 'orders', workflowId: 'order-1', runId: 'run-1' },
        { entityRef: 'temporalworkflow:default/order-flow' },
      ),
    );
    expect(api.getWorkflowGraph).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('The run could not be loaded'),
    ).not.toBeInTheDocument();
  });

  it('shows the error of a definition that cannot be parsed, without the file', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue({
      ...definition,
      content: undefined,
      document: undefined,
      tasks: [],
      error: { kind: 'parse', message: 'Missing ]', line: 2, column: 8 },
    });
    await render(yamlEntity, api);
    expect(await screen.findByTestId('definition-error')).toHaveTextContent(
      'The definition is not valid YAML (line 2)',
    );
    expect(screen.queryByTestId('definition-yaml')).not.toBeInTheDocument();
    expect(screen.getByText('No file to show.')).toBeInTheDocument();
    expect(screen.queryByTestId('definition-graph')).not.toBeInTheDocument();
  });

  it('stops the cursor at the first and the last line of the file', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue({
      ...definition,
      content: 'document: {dsl: 1.0.0}\ndo: []\n',
      document: { document: { dsl: '1.0.0' }, do: [] },
      tasks: [],
    });
    await render(yamlEntity, api);
    const yaml = await screen.findByTestId('definition-yaml');
    fireEvent.keyDown(yaml.querySelector('.cm-content')!, { key: 'ArrowUp' });
    fireEvent.keyDown(yaml.querySelector('.cm-content')!, { key: 'ArrowUp' });
    expect(markedLines(yaml, 'tp-yaml-cursor')).toEqual([1]);
    for (let i = 0; i < 5; i++)
      fireEvent.keyDown(yaml.querySelector('.cm-content')!, {
        key: 'ArrowDown',
      });
    expect(markedLines(yaml, 'tp-yaml-cursor')).toEqual([3]);
  });

  it('says why a file could not be read', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue({
      ...definition,
      content: undefined,
      document: undefined,
      tasks: [],
      error: {
        kind: 'tooLarge',
        message: 'The file is larger than 1048576 bytes',
      },
    });
    const tooLargeView = await render(yamlEntity, api);
    expect(await screen.findByTestId('definition-error')).toHaveTextContent(
      'The definition file is too large',
    );
    tooLargeView.unmount();

    const deniedMessage =
      'Absolute definition URLs from raw.example.com are not allowed; use a path relative to the entity, or add host: raw.example.com under temporal.definitions.allow';
    api.getEntityDefinition.mockResolvedValue({
      ...definition,
      content: undefined,
      document: undefined,
      tasks: [],
      error: {
        kind: 'read',
        message: deniedMessage,
      },
    });
    const yamlDeniedView = await render(yamlEntity, api);
    const yamlAlert = await screen.findByTestId('definition-error');
    expect(yamlAlert).toHaveTextContent('The definition could not be read');
    expect(yamlAlert).toHaveTextContent('temporal.definitions.allow');
    yamlDeniedView.unmount();

    api.getEntityDefinition.mockResolvedValue({
      entityRef: 'temporalworkflow:default/order-workflow',
      format: 'source',
      target: 'https://raw.example.com/workflows.ts',
      maxBytes: 1048576,
      tasks: [],
      error: {
        kind: 'read',
        message: deniedMessage,
      },
    });
    await render(
      {
        ...codeEntity,
        spec: {
          ...codeEntity.spec,
          definition: {
            format: 'source',
            target: 'https://raw.example.com/workflows.ts',
          },
        },
      },
      api,
    );
    const sourceAlert = await screen.findByTestId('definition-error');
    expect(sourceAlert).toHaveTextContent('The definition could not be read');
    expect(sourceAlert).toHaveTextContent('temporal.definitions.allow');
  });
});
