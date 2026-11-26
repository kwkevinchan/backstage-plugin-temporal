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
import { StrictMode } from 'react';
import { useLocation } from 'react-router-dom';
import type { Entity } from '@backstage/catalog-model';
import { identityApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type { WorkflowTypeOverview } from '../common';
import { temporalApiRef } from '../extensions';
import { mockTemporalApi } from '../testData';
import { TemporalPageContent } from './TemporalPage';

function workflowEntity(name: string, owner = 'group:default/team-a'): Entity {
  return {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: {
      name,
      namespace: 'default',
      title: `Title of ${name}`,
      description: `Description of ${name}`,
    },
    spec: { owner, workflowType: `${name}Type`, taskQueue: 'orders' },
    relations: [
      { type: 'ownedBy', targetRef: owner },
      { type: 'partOf', targetRef: 'system:default/shop' },
    ],
  };
}

const refOf = (e: Entity) => `temporalworkflow:default/${e.metadata.name}`;

function overview(
  entityRef: string,
  overrides: Partial<WorkflowTypeOverview> = {},
): WorkflowTypeOverview {
  return {
    entityRef,
    running: 3,
    completed: 120,
    failed: 2,
    windowDays: 7,
    sampleSize: 50,
    averageDurationMs: 4500,
    latestRun: {
      namespace: 'default',
      workflowId: `${entityRef.split('/')[1]}-latest`,
      runId: 'run-1',
      status: 'Completed',
      startTime: '2026-11-20T10:00:00Z',
      closeTime: '2026-11-20T10:00:04Z',
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A catalog that answers `queryEntities` from `entities`, a page at a time. */
function mockCatalog(entities: Entity[]) {
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
        'relations.partOf': [{ value: 'system:default/shop', count: 1 }],
        'spec.lifecycle': [{ value: 'production', count: 1 }],
      },
    })),
  };
}

function Location() {
  const location = useLocation();
  return (
    <span data-testid="location">{location.pathname + location.search}</span>
  );
}

function render(options: {
  api: ReturnType<typeof mockTemporalApi>;
  catalog: ReturnType<typeof mockCatalog>;
  ownership?: string[];
  path?: string;
  strict?: boolean;
}) {
  const Wrapper = options.strict ? StrictMode : 'div';
  return renderInTestApp(
    <Wrapper>
      <TestApiProvider
        apis={[
          [temporalApiRef, options.api],
          [catalogApiRef, options.catalog],
          [
            identityApiRef,
            mockApis.identity({
              userEntityRef: 'user:default/guest',
              ownershipEntityRefs: options.ownership ?? [
                'user:default/guest',
                'group:default/team-a',
              ],
            }),
          ],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
        <TemporalPageContent />
        <Location />
      </TestApiProvider>
    </Wrapper>,
    {
      routeEntries: [options.path ?? '/'],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

const grid = () => screen.findByRole('grid', { name: 'Workflows' });

describe('Workflows tab of the Temporal page', () => {
  it('is the default tab, lists the entities of my teams and adds their numbers', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockImplementation(async refs => ({
      items: refs.map(ref => overview(ref)),
    }));
    const entities = [workflowEntity('orders')];
    const catalog = mockCatalog(entities);
    await render({ api, catalog });
    const table = await grid();
    expect(screen.getByRole('tab', { name: 'Workflows' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await within(table).findByTestId('overview-counts'),
    ).toHaveTextContent('3 / 120 / 2');
    expect(
      within(table).getByRole('link', { name: 'Title of orders' }),
    ).toHaveAttribute('href', '/catalog/default/temporalworkflow/orders');
    expect(within(table).getByText('Description of orders')).toBeVisible();
    expect(within(table).getByText('4.5s')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /2026/ })).toHaveAttribute(
      'href',
      '/namespaces/default/workflows/orders-latest/runs/run-1',
    );
    // "My teams": the groups of the signed-in user.
    expect(catalog.queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          kind: 'TemporalWorkflow',
          'relations.ownedBy': ['group:default/team-a'],
        },
        limit: 25,
        orderFields: { field: 'metadata.name', order: 'asc' },
      }),
    );
    expect(api.getWorkflowTypeOverview).toHaveBeenCalledWith([
      'temporalworkflow:default/orders',
    ]);
    expect(screen.getByTestId('overview-updated')).toHaveTextContent(
      /Updated \d+ seconds? ago/,
    );
    // The executions are not read on this tab.
    expect(api.listWorkflows).not.toHaveBeenCalled();
  });

  it('lists every owner for a user of no group', async () => {
    const api = mockTemporalApi();
    const catalog = mockCatalog([workflowEntity('orders')]);
    await render({ api, catalog, ownership: ['user:default/guest'] });
    await grid();
    await waitFor(() =>
      expect(catalog.queryEntities).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { kind: 'TemporalWorkflow' } }),
      ),
    );
  });

  it('reads the numbers of one page at a time', async () => {
    const api = mockTemporalApi();
    const entities = Array.from({ length: 30 }, (_, i) =>
      workflowEntity(`type-${String(i).padStart(2, '0')}`),
    );
    const catalog = mockCatalog(entities);
    await render({ api, catalog });
    const table = await grid();
    await waitFor(() =>
      expect(api.getWorkflowTypeOverview).toHaveBeenCalledTimes(1),
    );
    expect(api.getWorkflowTypeOverview).toHaveBeenLastCalledWith(
      entities.slice(0, 25).map(refOf),
    );
    expect(await within(table).findAllByTestId('overview-counts')).toHaveLength(
      25,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(api.getWorkflowTypeOverview).toHaveBeenCalledTimes(2),
    );
    expect(api.getWorkflowTypeOverview).toHaveBeenLastCalledWith(
      entities.slice(25).map(refOf),
    );
    expect(catalog.queryEntities).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: '25', limit: 25 }),
    );
    expect(
      await within(await grid()).findAllByTestId('overview-counts'),
    ).toHaveLength(5);
  });

  it('leaves out the rows the backend does not answer for', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockImplementation(async refs => ({
      items: refs
        .filter(ref => !ref.endsWith('/secret'))
        .map(ref => overview(ref)),
    }));
    const catalog = mockCatalog([
      workflowEntity('orders'),
      workflowEntity('secret'),
    ]);
    await render({ api, catalog });
    const table = await grid();
    await within(table).findByTestId('overview-counts');
    await waitFor(() =>
      expect(within(table).queryByText('Title of secret')).toBeNull(),
    );
    expect(within(table).getByText('Title of orders')).toBeInTheDocument();
  });

  it('shows — with the reason and a retry button for a row that failed', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockResolvedValueOnce({
      items: [
        overview('temporalworkflow:default/orders', {
          running: 0,
          completed: 0,
          failed: 0,
          error: {
            message: 'Temporal is rate limiting the backend: slow down',
            rateLimited: true,
          },
        }),
      ],
    });
    api.getWorkflowTypeOverview.mockImplementation(async refs => ({
      items: refs.map(ref => overview(ref, { failed: 0 })),
    }));
    const catalog = mockCatalog([workflowEntity('orders')]);
    await render({ api, catalog });
    const table = await grid();
    const failed = await within(table).findByTestId('overview-error');
    expect(failed).toHaveTextContent('—');
    expect(failed).toHaveAttribute(
      'title',
      'Temporal is rate limiting the backend: slow down',
    );
    expect(screen.getByTestId('overview-rate-limited')).toHaveTextContent(
      'Temporal is rate limiting the backend',
    );
    await userEvent.click(
      within(table).getByRole('button', { name: 'Retry orders' }),
    );
    expect(
      await within(table).findByTestId('overview-counts'),
    ).toHaveTextContent('3 / 120 / 0');
    expect(api.getWorkflowTypeOverview).toHaveBeenLastCalledWith([
      'temporalworkflow:default/orders',
    ]);
    expect(screen.queryByTestId('overview-rate-limited')).toBeNull();
  });

  it('shows the error when the numbers cannot be read at all', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockRejectedValue(new Error('No backend'));
    const catalog = mockCatalog([workflowEntity('orders')]);
    await render({ api, catalog });
    expect(await screen.findByTestId('temporal-error')).toHaveTextContent(
      'No backend',
    );
  });

  it('sorts by the latest run with 50 rows or fewer, after reading every row', async () => {
    const api = mockTemporalApi();
    const entities = Array.from({ length: 30 }, (_, i) =>
      workflowEntity(`type-${String(i).padStart(2, '0')}`),
    );
    // type-07 ran last, type-00 first.
    api.getWorkflowTypeOverview.mockImplementation(async refs => ({
      items: refs.map(ref => {
        const n = Number(ref.slice(-2));
        const hour = String(n === 7 ? 23 : n % 20).padStart(2, '0');
        return overview(ref, {
          latestRun: {
            namespace: 'default',
            workflowId: `wf-${n}`,
            runId: 'r',
            status: 'Completed',
            startTime: `2026-11-20T${hour}:00:00Z`,
          },
        });
      }),
    }));
    const catalog = mockCatalog(entities);
    await render({ api, catalog });
    await grid();
    const header = screen.getByRole('columnheader', { name: 'Latest run' });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(header);
    await waitFor(() =>
      expect(catalog.queryEntities).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 50 }),
      ),
    );
    // Two batches of the backend's limit: 25, then 5.
    await waitFor(() =>
      expect(
        api.getWorkflowTypeOverview.mock.calls.map(c => c[0].length),
      ).toEqual([25, 5]),
    );
    const table = await grid();
    await waitFor(() =>
      expect(within(table).getAllByRole('row')).toHaveLength(26),
    );
    const firstRow = within(table).getAllByRole('row')[1];
    expect(firstRow).toHaveTextContent('Title of type-00');
    await userEvent.click(header);
    await waitFor(() =>
      expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
        'Title of type-07',
      ),
    );
  });

  it('goes back to the name order when the filters bring more than 50 rows', async () => {
    const api = mockTemporalApi();
    const few = Array.from({ length: 30 }, (_, i) =>
      workflowEntity(`few-${i}`),
    );
    const many = Array.from({ length: 60 }, (_, i) =>
      workflowEntity(`many-${String(i).padStart(2, '0')}`),
    );
    const catalog = mockCatalog(few);
    catalog.queryEntities.mockImplementation(async (request: any) => {
      const entities = request.fullTextFilter ? many : few;
      const start = request.cursor ? Number(request.cursor) : 0;
      const next = start + request.limit;
      return {
        items: entities.slice(start, next),
        totalItems: entities.length,
        pageInfo: {
          nextCursor: next < entities.length ? String(next) : undefined,
        },
      };
    });
    await render({ api, catalog });
    await grid();
    await userEvent.click(
      screen.getByRole('columnheader', { name: 'Latest run' }),
    );
    await waitFor(() =>
      expect(catalog.queryEntities).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 50 }),
      ),
    );
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Name' }),
      'many{Enter}',
    );
    // Back to pages of 25 by name, with a next page for the rest.
    await waitFor(() =>
      expect(catalog.queryEntities).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: 25,
          orderFields: { field: 'metadata.name', order: 'asc' },
          fullTextFilter: expect.objectContaining({ term: 'many' }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Latest run' }),
      ).not.toHaveAttribute('aria-sort'),
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('adds the numbers in StrictMode', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockImplementation(async refs => ({
      items: refs.map(ref => overview(ref)),
    }));
    await render({
      api,
      catalog: mockCatalog([workflowEntity('orders')]),
      strict: true,
    });
    const table = await grid();
    expect(
      await within(table).findByTestId('overview-counts'),
    ).toHaveTextContent('3 / 120 / 2');
  });

  it('cannot sort by the latest run with more than 50 rows', async () => {
    const api = mockTemporalApi();
    const entities = Array.from({ length: 51 }, (_, i) =>
      workflowEntity(`type-${i}`),
    );
    await render({ api, catalog: mockCatalog(entities) });
    await grid();
    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Latest run' }),
      ).not.toHaveAttribute('aria-sort'),
    );
    expect(screen.getByText('Latest run')).toHaveAttribute(
      'title',
      expect.stringContaining('50 workflows or fewer'),
    );
  });

  it('opens the entity when a row is clicked', async () => {
    const api = mockTemporalApi();
    const catalog = mockCatalog([workflowEntity('orders')]);
    await render({ api, catalog });
    const table = await grid();
    await within(table).findByTestId('overview-counts');
    await userEvent.click(within(table).getByText('Description of orders'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/catalog/default/temporalworkflow/orders',
      ),
    );
  });

  it('keeps the Executions tab in the URL', async () => {
    const api = mockTemporalApi();
    const catalog = mockCatalog([workflowEntity('orders')]);
    await render({ api, catalog });
    await grid();
    await userEvent.click(screen.getByRole('tab', { name: 'Executions' }));
    expect(
      await screen.findByRole('grid', { name: 'Workflow executions' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/?tab=executions',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Workflows' }));
    await grid();
    expect(screen.getByTestId('location').textContent).toBe('/');
  });
});
