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

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import type {
  WorkflowHistoryEvent,
  WorkflowHistoryResponse,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '../extensions';
import { mockTemporalApi } from '../testData';
import { WorkflowHistory } from './WorkflowHistory';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function event(eventId: string, eventType: string): WorkflowHistoryEvent {
  return { eventId, eventTime: '2026-01-01T11:00:00.000Z', eventType };
}

function page(
  type: string,
  ids: string[],
  nextPageToken?: string,
): WorkflowHistoryResponse {
  return { events: ids.map(id => event(id, `${type}${id}`)), nextPageToken };
}

const runA: WorkflowRef = { namespace: 'ns', workflowId: 'wf', runId: 'a' };
const runB: WorkflowRef = { namespace: 'ns', workflowId: 'wf', runId: 'b' };

type Call = {
  ref: WorkflowRef;
  pageToken?: string;
  response: Deferred<WorkflowHistoryResponse>;
};

/** An API whose history responses are answered by the test, in any order. */
function setup() {
  const api = mockTemporalApi();
  const calls: Call[] = [];
  api.getWorkflowHistory.mockImplementation((ref, options) => {
    const response = deferred<WorkflowHistoryResponse>();
    calls.push({ ref, pageToken: options?.pageToken, response });
    return response.promise;
  });
  const ui = (ref: WorkflowRef, entityRef?: string) => (
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <WorkflowHistory workflowRef={ref} entityRef={entityRef} />
    </TestApiProvider>
  );
  return { api, calls, ui };
}

const loadMore = () => screen.getByRole('button', { name: /Load more events/ });

describe('WorkflowHistory', () => {
  it('keeps the loaded pages when the parent renders with an equal workflowRef', async () => {
    const { api, calls, ui } = setup();
    const { rerender } = await renderInTestApp(ui({ ...runA }));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'p2')));
    await userEvent.click(loadMore());
    await act(async () => calls[1].response.resolve(page('A', ['2'])));
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();

    rerender(ui({ ...runA }));
    rerender(ui({ ...runA }));

    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(2);
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.getByText('All events loaded')).toBeInTheDocument();
  });

  it('goes back to the first page of a new workflow and clears the old list', async () => {
    const { calls, ui } = setup();
    const { rerender } = await renderInTestApp(ui(runA));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));
    expect(screen.getByText('A1')).toBeInTheDocument();

    rerender(ui(runB));
    expect(screen.queryByText('A1')).not.toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1].ref).toEqual(runB);
    expect(calls[1].pageToken).toBeUndefined();
    await act(async () => calls[1].response.resolve(page('B', ['1'], 'b2')));
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).not.toBeInTheDocument();

    // Another identifying field starts over as well.
    rerender(ui({ ...runB, namespace: 'other' }));
    expect(screen.queryByText('B1')).not.toBeInTheDocument();
    expect(calls).toHaveLength(3);
    rerender(ui(runB, 'component:default/x'));
    expect(calls).toHaveLength(4);
    expect(calls[3].ref).toEqual(runB);
  });

  it('drops the first page of the old workflow that arrives late', async () => {
    const { calls, ui } = setup();
    const { rerender } = await renderInTestApp(ui(runA));
    rerender(ui(runB));
    await act(async () => calls[1].response.resolve(page('B', ['1'], 'b2')));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));

    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A1')).not.toBeInTheDocument();
    await userEvent.click(loadMore());
    expect(calls[2].ref).toEqual(runB);
    expect(calls[2].pageToken).toBe('b2');
  });

  it('drops the next page of the old workflow that arrives late', async () => {
    const { calls, ui } = setup();
    const { rerender } = await renderInTestApp(ui(runA));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));
    await userEvent.click(loadMore());
    expect(calls[1].pageToken).toBe('a2');

    rerender(ui(runB));
    await act(async () => calls[2].response.resolve(page('B', ['1'], 'b2')));
    await act(async () => calls[1].response.resolve(page('A', ['2'], 'a3')));

    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText('A2')).not.toBeInTheDocument();
    expect(loadMore()).toBeEnabled();
    await userEvent.click(loadMore());
    expect(calls[3].ref).toEqual(runB);
    expect(calls[3].pageToken).toBe('b2');
  });

  it('sends one request when Load more is pressed while a page is loading', async () => {
    const { api, calls, ui } = setup();
    await renderInTestApp(ui(runA));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));
    const button = loadMore();
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(2);

    await act(async () => calls[1].response.resolve(page('A', ['2'])));
    expect(screen.getAllByText('A2')).toHaveLength(1);
    expect(api.getWorkflowHistory).toHaveBeenCalledTimes(2);
  });

  it('keeps the loaded pages when the next page fails', async () => {
    const { calls, ui } = setup();
    await renderInTestApp(ui(runA));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));
    await userEvent.click(loadMore());
    await act(async () => calls[1].response.reject(new Error('page down')));

    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText(/page down/)).toBeInTheDocument();
    // The same token is tried again.
    await userEvent.click(loadMore());
    expect(calls[2].pageToken).toBe('a2');
    await act(async () => calls[2].response.resolve(page('A', ['2'])));
    await waitFor(() => expect(screen.getByText('A2')).toBeInTheDocument());
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.queryByText(/page down/)).not.toBeInTheDocument();
  });

  it('does not show an error of the old workflow that arrives late', async () => {
    const { calls, ui } = setup();
    const { rerender } = await renderInTestApp(ui(runA));
    await act(async () => calls[0].response.resolve(page('A', ['1'], 'a2')));
    await userEvent.click(loadMore());
    rerender(ui(runB));
    await act(async () => calls[2].response.resolve(page('B', ['1'], 'b2')));
    await act(async () => calls[1].response.reject(new Error('old failure')));

    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.queryByText(/old failure/)).not.toBeInTheDocument();

    // Same for a first page that fails after the workflow changed.
    rerender(ui({ ...runB, runId: 'c' }));
    rerender(ui({ ...runB, runId: 'd' }));
    await act(async () => calls[4].response.resolve(page('D', ['1'])));
    await act(async () => calls[3].response.reject(new Error('c failure')));
    expect(screen.getByText('D1')).toBeInTheDocument();
    expect(screen.queryByText(/c failure/)).not.toBeInTheDocument();
  });
});
