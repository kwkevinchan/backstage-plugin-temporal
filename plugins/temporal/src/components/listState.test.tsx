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
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { temporalApiRef } from '../extensions';
import { listResponse, mockTemporalApi } from '../testData';
import { listSearch, readListParams, savedListSearch } from './listState';
import { TemporalPageContent } from './TemporalPage';
import { pageSizeOptions } from './WorkflowRunsTable';

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

function render(api: ReturnType<typeof mockTemporalApi>, path = '/') {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <TemporalPageContent />
      <Location />
    </TestApiProvider>,
    {
      routeEntries: [path],
      mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
    },
  );
}

const location = () => screen.getByTestId('location').textContent;
const navigation = () => screen.getByTestId('navigation').textContent;

describe('list parameters', () => {
  it('reads and writes filters, page and page size', () => {
    const search = listSearch(
      {
        status: 'Running',
        allRuns: true,
        workflowId: 'order-',
        workflowType: '',
      },
      2,
      10,
      new URLSearchParams('tab=x&page=9'),
    );
    expect(search.toString()).toBe(
      'tab=x&status=Running&allRuns=true&workflowId=order-&page=2&pageSize=10',
    );
    expect(readListParams(search)).toEqual({
      filters: {
        status: 'Running',
        allRuns: true,
        workflowId: 'order-',
        workflowType: '',
      },
      page: 2,
      pageSize: 10,
    });
    expect(
      readListParams(new URLSearchParams('status=Nope&page=-1&pageSize=1000')),
    ).toEqual({
      filters: { status: '', allRuns: false, workflowId: '', workflowType: '' },
      page: 1,
      pageSize: 20,
    });
  });
});

describe('workflow list state', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('comes back to the same page, filters and page size from a workflow', async () => {
    const api = mockTemporalApi();
    api.listWorkflows.mockImplementation(async options => ({
      ...listResponse,
      nextPageToken: options?.pageToken ? undefined : 'token-2',
    }));
    await render(api, '/?status=Completed&pageSize=10');
    await screen.findByRole('grid', { name: 'Workflow executions' });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(location()).toBe('/?status=Completed&page=2&pageSize=10'),
    );
    expect(api.listWorkflows).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'Completed',
        pageSize: 10,
        pageToken: 'token-2',
      }),
    );
    expect(screen.getByTestId('list-page')).toHaveTextContent('Page 2');

    // Open a workflow, then use the link back to the list.
    await userEvent.click(await screen.findByRole('link', { name: 'order-1' }));
    const back = await screen.findByTestId('back-to-list');
    expect(back).toHaveAttribute(
      'href',
      '/?status=Completed&page=2&pageSize=10',
    );
    api.listWorkflows.mockClear();
    await userEvent.click(back);
    await screen.findByRole('grid', { name: 'Workflow executions' });
    expect(location()).toBe('/?status=Completed&page=2&pageSize=10');
    await waitFor(() =>
      expect(api.listWorkflows).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: 'token-2', pageSize: 10 }),
      ),
    );
    expect(screen.getByTestId('list-page')).toHaveTextContent('Page 2');

    // Previous page, and a new filter starts on page 1.
    await userEvent.click(
      screen.getByRole('button', { name: 'Previous page' }),
    );
    await waitFor(() =>
      expect(location()).toBe('/?status=Completed&pageSize=10'),
    );
    expect(savedListSearch('/')).toBe('?status=Completed&pageSize=10');
  });

  it('replaces the history entry when the page or the filters change', async () => {
    const api = mockTemporalApi();
    api.listWorkflows.mockImplementation(async options => ({
      ...listResponse,
      nextPageToken: options?.pageToken ? undefined : 'token-2',
    }));
    // A page before the list, to see where back goes.
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
        <TemporalPageContent />
        <Location />
      </TestApiProvider>,
      {
        routeEntries: ['/before', '/?pageSize=10'],
        mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef },
      },
    );
    await screen.findByRole('grid', { name: 'Workflow executions' });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(location()).toBe('/?page=2&pageSize=10'));
    expect(navigation()).toBe('REPLACE');
    await userEvent.click(
      screen.getByRole('switch', { name: 'Show all runs' }),
    );
    await waitFor(() => expect(location()).toBe('/?allRuns=true&pageSize=10'));
    expect(navigation()).toBe('REPLACE');

    // Opening a workflow adds an entry; back returns to the list as it was.
    await userEvent.click(await screen.findByRole('link', { name: 'order-1' }));
    await screen.findByTestId('back-to-list');
    expect(navigation()).toBe('PUSH');
    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await screen.findByRole('grid', { name: 'Workflow executions' });
    expect(location()).toBe('/?allRuns=true&pageSize=10');
    expect(screen.getByRole('switch', { name: 'Show all runs' })).toBeChecked();

    // One more back leaves the list: paging added no entries.
    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() => expect(location()).toBe('/before'));
  });

  it('opens the first page when the page tokens are gone', async () => {
    const api = mockTemporalApi();
    await render(api, '/?page=3');
    expect(await screen.findByTestId('list-lost-page')).toHaveTextContent(
      'Page 3 could not be opened again',
    );
    await waitFor(() => expect(location()).toBe('/'));
    expect(api.listWorkflows).not.toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: expect.anything() }),
    );
  });

  it('reads the filters from the URL', async () => {
    const api = mockTemporalApi();
    await render(api, '/?allRuns=true&workflowId=order-');
    const table = await screen.findByRole('grid', {
      name: 'Workflow executions',
    });
    expect(
      within(table).getByRole('link', { name: 'order-1' }),
    ).toBeInTheDocument();
    expect(api.listWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({ allRuns: true, workflowIdPrefix: 'order-' }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Workflow ID starts with' }),
    ).toHaveValue('order-');
    expect(screen.getByRole('switch', { name: 'Show all runs' })).toBeChecked();
  });

  it('shows a page size from the URL that is not one of the options', async () => {
    const api = mockTemporalApi();
    await render(api, '/?pageSize=5');
    await screen.findByRole('grid', { name: 'Workflow executions' });
    expect(api.listWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 5 }),
    );
    const select = screen.getByRole('button', { name: /Per page/ });
    expect(select).toHaveTextContent('5');
    expect(select).not.toHaveTextContent('Select an option');
    // The select keeps its width instead of filling the row.
    const root = select.closest('.bui-Select') as HTMLElement;
    expect(root.style.flex).toBe('0 0 auto');
    expect(root.style.width).toBe('110px');
    await userEvent.click(select);
    const options = screen
      .getAllByRole('option')
      .map(option => option.textContent);
    expect(options).toEqual(['5', '10', '20', '50', '100']);
  });
});

describe('page size options', () => {
  it('adds the current size when it is not offered', () => {
    expect(pageSizeOptions(20)).toEqual([10, 20, 50, 100]);
    expect(pageSizeOptions(5)).toEqual([5, 10, 20, 50, 100]);
    expect(pageSizeOptions(30)).toEqual([10, 20, 30, 50, 100]);
  });
});
