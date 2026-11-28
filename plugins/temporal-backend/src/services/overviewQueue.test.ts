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
import type { TemporalEntityContext } from '../node/alpha';
import {
  OVERVIEW_ERROR_MESSAGES,
  OverviewRequestStats,
  WorkflowListQueries,
} from './WorkflowListQueries';

// The overview of many entities at a rate that cannot serve them all in the
// time of a call: the rows the queue does not reach.

const entity = (i: number): TemporalEntityContext =>
  ({
    entity: {},
    entityRef: `temporalworkflow:default/type-${i}`,
    namespace: 'default',
    relatedWorkflowEntities: [],
  } as unknown as TemporalEntityContext);

const temporal = {
  getSearchAttributeNames: () => ({}),
  getWebUiUrl: () => undefined,
} as any;

describe('the overview when its visibility calls wait in the queue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-27T00:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('shows the fixed timeout message for rows that no call was made for, and counts them', async () => {
    const listExecutions = jest.fn(async () => ({ items: [] }));
    const countExecutionsByStatus = jest.fn(async () => ({}));
    const countExecutions = jest.fn(async () => 0);
    const lists = new WorkflowListQueries(
      temporal,
      { listExecutions, countExecutionsByStatus, countExecutions } as any,
      {} as any,
      {
        filterOf: (context: TemporalEntityContext) => ({
          annotations: {
            taskQueue: 'orders',
            workflowTypes: [context.entityRef],
          },
          entityRef: context.entityRef,
        }),
      } as any,
      {} as any,
      mockServices.logger.mock(),
      // 1 call per second: the 15 seconds of a call allow about 15 calls,
      // and each of the 12 rows needs 2.
      { overviewRatePerSecond: 1 },
    );

    const request: OverviewRequestStats = { queueTimeouts: 0 };
    const rows: Array<ReturnType<typeof lists.overview>> = [];
    for (let i = 0; i < 12; i += 1) {
      rows.push(lists.overview(entity(i), request));
      // The rows start one after the other, so their deadlines differ.
      await jest.advanceTimersByTimeAsync(1);
    }
    await jest.advanceTimersByTimeAsync(20_000);
    const items = await Promise.all(rows);

    const failed = items.filter(item => item.error);
    const read = items.filter(item => !item.error);
    expect(read.length).toBeGreaterThan(0);
    expect(failed.length).toBeGreaterThan(0);
    expect(read.length + failed.length).toBe(12);
    for (const item of failed) {
      expect(item.error).toEqual({
        message: OVERVIEW_ERROR_MESSAGES.deadline,
      });
      expect(item.running + item.completed + item.failed).toBe(0);
    }
    expect(request.queueTimeouts).toBe(failed.length);
    // A row that timed out in the queue made no call to Temporal: only the
    // rows that were read called it, twice each.
    expect(
      listExecutions.mock.calls.length +
        countExecutionsByStatus.mock.calls.length,
    ).toBeLessThanOrEqual(read.length * 2 + 2);
    // The first rows are the ones that were read.
    expect(items.slice(0, read.length).every(item => !item.error)).toBe(true);
  });

  it('reads again with refresh, but the reads wait for the rate limit', async () => {
    const listExecutions = jest.fn(async () => ({ items: [] }));
    const countExecutionsByStatus = jest.fn(async () => ({}));
    const lists = new WorkflowListQueries(
      temporal,
      {
        listExecutions,
        countExecutionsByStatus,
        countExecutions: jest.fn(),
      } as any,
      {} as any,
      {
        filterOf: (context: TemporalEntityContext) => ({
          annotations: { taskQueue: 'orders', workflowTypes: ['a'] },
          entityRef: context.entityRef,
        }),
      } as any,
      {} as any,
      mockServices.logger.mock(),
      { overviewRatePerSecond: 1 },
    );
    const kept = lists.overview(entity(0));
    await jest.advanceTimersByTimeAsync(1_100);
    await kept;
    expect(countExecutionsByStatus).toHaveBeenCalledTimes(1);
    expect(listExecutions).toHaveBeenCalledTimes(1);

    // Kept numbers are used without a call.
    await lists.overview(entity(0));
    expect(countExecutionsByStatus).toHaveBeenCalledTimes(1);

    const again = lists.overview(entity(0), undefined, { refresh: true });
    await jest.advanceTimersByTimeAsync(0);
    // The token of the second is not back yet: the read waits.
    expect(
      countExecutionsByStatus.mock.calls.length +
        listExecutions.mock.calls.length,
    ).toBeLessThan(4);
    await jest.advanceTimersByTimeAsync(2_000);
    await again;
    expect(countExecutionsByStatus).toHaveBeenCalledTimes(2);
    expect(listExecutions).toHaveBeenCalledTimes(2);
  });
});
