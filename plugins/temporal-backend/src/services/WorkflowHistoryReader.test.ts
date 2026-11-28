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

import { mockServices } from '@backstage/backend-test-utils';
import { WorkflowHistoryReader } from './WorkflowHistoryReader';

const ref = { namespace: 'default', workflowId: 'wf', runId: 'run' };

function readerWith(historyPage: jest.Mock) {
  return new WorkflowHistoryReader(
    { checkNamespace: () => undefined } as any,
    { historyPage } as any,
    mockServices.logger.mock(),
  );
}

const events = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ eventId: from + i }));

describe('readEvents', () => {
  it('asks for no more events than are left, and returns at most max', async () => {
    const historyPage = jest.fn(async (_ref, { pageSize }) => ({
      // A server that returns a full page whatever is asked.
      items: events(1, 500),
      nextPageToken: pageSize > 0 ? Uint8Array.of(1) : undefined,
    }));
    const result = await readerWith(historyPage).readEvents(ref, 700);
    expect(historyPage.mock.calls.map(c => c[1].pageSize)).toEqual([500, 200]);
    expect(result.events).toHaveLength(700);
    expect(result.truncated).toBe(true);
  });

  it('is not truncated when the history ends within max', async () => {
    const historyPage = jest
      .fn()
      .mockResolvedValueOnce({
        items: events(1, 3),
        nextPageToken: Uint8Array.of(1),
      })
      .mockResolvedValueOnce({ items: events(4, 2), nextPageToken: undefined });
    const result = await readerWith(historyPage).readEvents(ref, 10);
    expect(result.events).toHaveLength(5);
    expect(result.truncated).toBe(false);
  });

  it('stops when the server keeps answering empty pages with a token', async () => {
    const historyPage = jest.fn(async () => ({
      items: [],
      nextPageToken: Uint8Array.of(1),
    }));
    const result = await readerWith(historyPage).readEvents(ref, 1000);
    expect(historyPage.mock.calls.length).toBeLessThanOrEqual(100);
    expect(result.events).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});
