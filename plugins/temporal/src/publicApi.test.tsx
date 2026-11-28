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

import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { configApiRef } from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  entityRouteRef,
  EntityProvider,
} from '@backstage/plugin-catalog-react';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  mockApis,
  MockConfigApi,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import {
  EntityTemporalContent,
  EntityTemporalRelatedWorkflowsCard,
  EntityTemporalWorkflowSummaryCard,
  temporalApiRef,
  TemporalPage,
  temporalPlugin,
} from '@kwkevinchan/backstage-plugin-temporal';
import {
  DefinitionList,
  ErrorAlert,
  isActiveStatus,
  Loading,
  PanelCard,
  statusLabel,
  statusTone,
  workflowLink,
} from '@kwkevinchan/backstage-plugin-temporal/ui';
import { checkoutEntity, mockTemporalApi, workflowEntity } from './testData';

// Uses the package by name, as an extension author's tests do.

describe('legacy plugin extensions and ./ui sub-path', () => {
  it('mounts legacy cards and pages exported from the root entry point', async () => {
    const api = mockTemporalApi();
    const config = new MockConfigApi({
      temporal: { webUi: { baseUrl: 'http://temporal-ui/' } },
    });
    const catalog = catalogApiMock({ entities: [workflowEntity] });

    const cards = await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api],
          [permissionApiRef, mockApis.permission()],
          [configApiRef, config],
          [catalogApiRef, catalog],
        ]}
      >
        <>
          <EntityProvider entity={workflowEntity}>
            <EntityTemporalWorkflowSummaryCard />
          </EntityProvider>
          <EntityProvider entity={checkoutEntity}>
            <EntityTemporalRelatedWorkflowsCard />
          </EntityProvider>
        </>
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );

    expect(
      await screen.findByRole('heading', { name: 'Workflow type' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /order-workflow/i }),
    ).toBeInTheDocument();
    cards.unmount();

    const entityTab = await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api],
          [permissionApiRef, mockApis.permission()],
          [configApiRef, config],
          [catalogApiRef, catalog],
        ]}
      >
        <EntityProvider entity={workflowEntity}>
          <Routes>
            <Route path="/*" element={<EntityTemporalContent />} />
          </Routes>
        </EntityProvider>
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
          '/catalog/:namespace/:kind/:name/temporal':
            temporalPlugin.routes.entityContent,
          '/temporal': temporalPlugin.routes.root,
        },
      },
    );
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    entityTab.unmount();

    const rootPage = await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api],
          [permissionApiRef, mockApis.permission()],
          [configApiRef, config],
          [catalogApiRef, catalog],
        ]}
      >
        <Routes>
          <Route path="/temporal/*" element={<TemporalPage />} />
        </Routes>
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
          '/temporal': temporalPlugin.routes.root,
        },
        routeEntries: ['/temporal?tab=executions'],
      },
    );
    expect(await screen.findByText('order-1')).toBeInTheDocument();
    rootPage.unmount();
  });

  it('exports working UI helpers and components from ./ui', () => {
    expect(isActiveStatus('Running')).toBe(true);
    expect(isActiveStatus('Completed')).toBe(false);
    expect(statusLabel('Running')).toBe('Running');
    expect(statusTone('Failed')).toBe('danger');
    expect(workflowLink({ namespace: 'default', workflowId: 'wf/1' })).toBe(
      'namespaces/default/workflows/wf%2F1',
    );
    expect(
      workflowLink({ namespace: 'default', workflowId: 'wf/1', runId: 'r/1' }),
    ).toBe('namespaces/default/workflows/wf%2F1/runs/r%2F1');

    render(
      <PanelCard title="Status summary">
        <DefinitionList items={[['Status', statusLabel('Completed')]]} />
        <Loading />
        <ErrorAlert error={new Error('Sample boom')} />
      </PanelCard>,
    );
    expect(screen.getByText('Status summary')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Sample boom')).toBeInTheDocument();
  });
});
