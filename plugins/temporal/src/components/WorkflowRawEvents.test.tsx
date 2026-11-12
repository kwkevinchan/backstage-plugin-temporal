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

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderInTestApp,
  TestApiProvider,
  mockApis,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import type {
  WorkflowHistoryEvent,
  WorkflowHistoryResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef, useTemporalWorkflow } from '../extensions';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { AUTO_REFRESH_MS } from './useWorkflowData';
import { entity, failedWorkflow, mockTemporalApi } from '../testData';

const PATH = '/namespaces/default/workflows/payment-1/runs/run-2';

function event(eventId: string, eventType: string): WorkflowHistoryEvent {
  return { eventId, eventTime: '2026-01-01T11:00:00.000Z', eventType };
}

/** Two pages of history; the number in the event type counts the loads. */
function pagedHistory(api: ReturnType<typeof mockTemporalApi>) {
  const state = { generation: 0 };
  api.getWorkflowHistory.mockImplementation(async (_ref, options) => {
    const token = options?.pageToken;
    if (!token) state.generation++;
    const g = state.generation;
    const response: WorkflowHistoryResponse = token
      ? { events: [event('2', `Second${g}`)] }
      : { events: [event('1', `First${g}`)], nextPageToken: 'p2' };
    return response;
  });
  return state;
}

function ReloadAction() {
  const { reload } = useTemporalWorkflow();
  return (
    <button type="button" onClick={reload}>
      Do something
    </button>
  );
}

function render(api: ReturnType<typeof mockTemporalApi>) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityTemporalContentPage
          workflowActions={[{ id: 'reload', component: ReloadAction }]}
        />
      </EntityProvider>
    </TestApiProvider>,
    { routeEntries: [PATH] },
  );
}

async function openRaw() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Events' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Raw' }));
  await screen.findByText('First1');
}

async function loadSecondPage() {
  await userEvent.click(
    screen.getByRole('button', { name: /Load more events/ }),
  );
  await screen.findByText(/Second/);
}

describe('Raw events of the workflow page', () => {
  it('loads the first page again when Refresh is pressed, once for repeated presses', async () => {
    const api = mockTemporalApi();
    pagedHistory(api);
    await render(api);
    await openRaw();
    await loadSecondPage();
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(2);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    expect(await screen.findByText('First2')).toBeInTheDocument();
    expect(screen.queryByText(/Second/)).not.toBeInTheDocument();
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(3);
    expect(api.getWorkflowHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ pageToken: undefined }),
    );
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
  });

  it('loads the raw events again after an action that reloads the workflow', async () => {
    const api = mockTemporalApi();
    pagedHistory(api);
    await render(api);
    await openRaw();
    await loadSecondPage();

    await userEvent.click(screen.getByRole('button', { name: 'Do something' }));

    expect(await screen.findByText('First2')).toBeInTheDocument();
    expect(screen.queryByText(/Second/)).not.toBeInTheDocument();
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(3);
  });

  it('does not touch the raw events when the page updates itself', async () => {
    const api = mockTemporalApi();
    api.getWorkflow.mockResolvedValue({ ...failedWorkflow, status: 'Running' });
    pagedHistory(api);
    const intervals: (() => void)[] = [];
    const setIntervalSpy = jest
      .spyOn(window, 'setInterval')
      .mockImplementation(((fn: () => void, ms: number) => {
        if (ms === AUTO_REFRESH_MS) intervals.push(fn);
        return intervals.length as any;
      }) as any);
    try {
      await render(api);
      await openRaw();
      await loadSecondPage();
      expect(intervals.length).toBeGreaterThan(0);

      for (let n = 2; n <= 3; n++) {
        act(() => intervals[intervals.length - 1]());
        await waitFor(() => expect(api.getWorkflow).toHaveBeenCalledTimes(n));
        await waitFor(() =>
          expect(api.getWorkflowGraph).toHaveBeenCalledTimes(n),
        );
      }

      expect(api.getWorkflowHistory).toHaveBeenCalledTimes(2);
      expect(screen.getByText('First1')).toBeInTheDocument();
      expect(screen.getByText('Second1')).toBeInTheDocument();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('does not read the history on Refresh while the raw events are not open', async () => {
    const api = mockTemporalApi();
    pagedHistory(api);
    await render(api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }));
    await screen.findByTestId('grouped-events');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getWorkflow).toHaveBeenCalledTimes(2));
    expect(api.getWorkflowHistory).not.toHaveBeenCalled();

    // Opening them later loads the first page.
    await userEvent.click(screen.getByRole('radio', { name: 'Raw' }));
    await screen.findByText('First1');
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(1);
  });

  it('drops the next page that arrives after Refresh', async () => {
    const api = mockTemporalApi();
    let release!: (r: WorkflowHistoryResponse) => void;
    api.getWorkflowHistory.mockImplementation(async (_ref, options) => {
      if (options?.pageToken) {
        return new Promise<WorkflowHistoryResponse>(res => {
          release = res;
        });
      }
      const n = api.getWorkflowHistory.mock.calls.length;
      return { events: [event('1', `First${n}`)], nextPageToken: 'p2' };
    });
    await render(api);
    await openRaw();
    await userEvent.click(
      screen.getByRole('button', { name: /Load more events/ }),
    );
    await waitFor(() => expect(release).toBeDefined());

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('First3');
    await act(async () =>
      release({ events: [event('2', 'LateSecond')], nextPageToken: 'p3' }),
    );

    expect(screen.queryByText('LateSecond')).not.toBeInTheDocument();
    expect(screen.getByText('First3')).toBeInTheDocument();
  });
});
