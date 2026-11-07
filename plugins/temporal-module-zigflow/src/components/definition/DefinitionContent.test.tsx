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
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { mockTemporalApi } from '../../testData';

import {
  temporalApiRef,
  WorkflowGraphResponse,
} from '@kwkevinchan/backstage-plugin-temporal';
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
  payloadsHidden: false,
};

function render(
  entity: Entity,
  api: ReturnType<typeof mockTemporalApi>,
  path = '/',
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
    { routeEntries: [path] },
  );
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
    fireEvent.keyDown(yaml, { key: 'ArrowDown' });
    fireEvent.keyDown(yaml, { key: 'ArrowDown' });
    expect(
      screen.getByTestId('definition-node-/do/0/validate'),
    ).toHaveAttribute('aria-pressed', 'true');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(yaml, { key: 'ArrowDown' });
    expect(screen.getByTestId('definition-node-/do/1/route')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      '/temporal/namespaces/default/workflows/order-1/runs/run-1',
    );
  });

  it('shows the file and the error of a definition that cannot be parsed', async () => {
    const api = mockTemporalApi();
    api.getEntityDefinition.mockResolvedValue({
      ...definition,
      content: 'do:\n  - a: [\n',
      document: undefined,
      tasks: [],
      error: { kind: 'parse', message: 'Missing ]', line: 2, column: 8 },
    });
    await render(yamlEntity, api);
    expect(await screen.findByTestId('definition-error')).toHaveTextContent(
      'The definition is not valid YAML (line 2)',
    );
    expect(screen.getByTestId('definition-yaml')).toHaveTextContent('a: [');
    expect(screen.queryByTestId('definition-graph')).not.toBeInTheDocument();
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
    await render(yamlEntity, api);
    expect(await screen.findByTestId('definition-error')).toHaveTextContent(
      'The definition file is too large',
    );
  });
});
