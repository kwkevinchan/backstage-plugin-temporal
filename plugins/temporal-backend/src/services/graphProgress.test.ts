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

jest.mock('./convert', () => {
  const actual = jest.requireActual('./convert');
  return {
    __esModule: true,
    ...actual,
    decodePayloads: jest.fn(actual.decodePayloads),
    summaryOf: jest.fn(actual.summaryOf),
    toDisplayJson: jest.fn(actual.toDisplayJson),
  };
});
jest.mock('./llm/llm', () => {
  const actual = jest.requireActual('./llm/llm');
  return {
    __esModule: true,
    ...actual,
    readLlmSteps: jest.fn(actual.readLlmSteps),
  };
});

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PendingActivity, WorkflowProgressResponse } from '../common';
import { readHistoryFixture } from '../__testUtils__/fixtures';
import {
  agentToolCallIdHistory,
  plainParallelBatchHistory,
} from '../__testUtils__/syntheticHistory';
import { decodePayloads, summaryOf, toDisplayJson } from './convert';
import { buildWorkflowGraph } from './graph';
import { buildWorkflowProgress, ProgressOptions } from './graphProgress';
import { readLlmSteps } from './llm/llm';

const detailReads = [
  decodePayloads,
  summaryOf,
  toDisplayJson,
  readLlmSteps,
].map(fn => fn as unknown as jest.Mock);

/** The progress of a run as its graph tells it. */
function progressOfGraph(
  events: any[],
  options: ProgressOptions,
): WorkflowProgressResponse {
  const graph = buildWorkflowGraph(structuredClone(events), options);
  const progress: WorkflowProgressResponse = {
    status: graph.status,
    completedSteps: graph.completedSteps,
    totalSteps: graph.totalSteps,
    truncated: graph.truncated,
  };
  if (graph.current) progress.current = graph.current;
  if (graph.currentDeadline) progress.currentDeadline = graph.currentDeadline;
  return progress;
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payloads = (value: unknown) => ({
  payloads: [
    {
      metadata: { encoding: b64('json/plain') },
      data: b64(JSON.stringify(value)),
    },
  ],
});
const time = (seconds: number) => ({
  seconds: String(1_800_000_000 + seconds),
});

/** A run with one step of every kind, some of them open. */
const everyKind: any[] = [
  {
    eventId: '1',
    eventTime: time(0),
    workflowExecutionStartedEventAttributes: {
      workflowType: { name: 'orderWorkflow' },
      input: payloads({ order: 1 }),
    },
  },
  {
    eventId: '2',
    eventTime: time(1),
    activityTaskScheduledEventAttributes: {
      activityId: 'a1',
      activityType: { name: 'charge' },
      input: payloads([1]),
    },
    userMetadata: { summary: payloads('Charges the card').payloads[0] },
  },
  {
    eventId: '3',
    eventTime: time(2),
    activityTaskStartedEventAttributes: { scheduledEventId: '2', attempt: 1 },
  },
  {
    eventId: '4',
    eventTime: time(3),
    activityTaskCompletedEventAttributes: {
      scheduledEventId: '2',
      result: payloads('charged'),
    },
  },
  {
    eventId: '5',
    eventTime: time(4),
    activityTaskScheduledEventAttributes: {
      activityId: 'a2',
      activityType: { name: 'ship' },
    },
  },
  {
    eventId: '6',
    eventTime: time(5),
    startChildWorkflowExecutionInitiatedEventAttributes: {
      workflowId: 'child-1',
      workflowType: { name: 'notify' },
    },
  },
  {
    eventId: '7',
    eventTime: time(6),
    childWorkflowExecutionFailedEventAttributes: {
      initiatedEventId: '6',
      failure: { message: 'no address' },
    },
  },
  {
    eventId: '8',
    eventTime: time(7),
    workflowExecutionSignaledEventAttributes: {
      signalName: 'approve',
      input: payloads(['yes']),
    },
  },
  {
    eventId: '9',
    eventTime: time(8),
    markerRecordedEventAttributes: {
      markerName: 'Version',
      details: { data: payloads({ version: 2 }) },
    },
  },
  {
    eventId: '10',
    eventTime: time(9),
    workflowExecutionUpdateAcceptedEventAttributes: {
      protocolInstanceId: 'u1',
      acceptedRequest: {
        meta: { updateId: 'u1' },
        input: { name: 'setLimit', args: payloads([5]) },
      },
    },
  },
  {
    eventId: '11',
    eventTime: time(10),
    workflowExecutionUpdateCompletedEventAttributes: {
      meta: { updateId: 'u1' },
      outcome: { success: payloads('ok') },
    },
  },
  {
    eventId: '12',
    eventTime: time(11),
    upsertWorkflowSearchAttributesEventAttributes: {
      searchAttributes: {
        indexedFields: { Stage: payloads('ship').payloads[0] },
      },
    },
  },
  {
    eventId: '13',
    eventTime: time(12),
    timerStartedEventAttributes: {
      timerId: 't1',
      startToFireTimeout: { seconds: '3600' },
    },
  },
];

const failedClose = {
  eventId: '14',
  eventTime: time(13),
  workflowExecutionFailedEventAttributes: {
    failure: {
      message: 'Activity task failed',
      cause: {
        message: 'declined',
        activityFailureInfo: {
          scheduledEventId: '2',
          activityType: { name: 'charge' },
        },
      },
    },
  },
};

const pending: PendingActivity[] = [
  {
    activityId: 'a2',
    activityType: 'ship',
    state: 'Scheduled',
    attempt: 3,
    lastFailure: { message: 'warehouse closed' },
  },
];

const base = { namespace: 'default', workflowId: 'wf' };

/** Histories and options that reach every text of `current`. */
const cases: [string, any[], ProgressOptions][] = [
  [
    'a running run',
    everyKind,
    { ...base, status: 'Running', truncated: false },
  ],
  [
    'a running run with pending activities',
    everyKind,
    {
      ...base,
      status: 'Running',
      truncated: false,
      pendingActivities: pending,
    },
  ],
  [
    'a lone timer with a waiting hint',
    [everyKind[0], everyKind[12]],
    {
      ...base,
      status: 'Running',
      truncated: false,
      searchAttributes: { ApprovalPending: true },
    },
  ],
  [
    'a running run with nothing open',
    everyKind.slice(0, 4),
    { ...base, status: 'Running', truncated: false },
  ],
  [
    'a running run with a cut history',
    everyKind,
    { ...base, status: 'Running', truncated: true, pendingActivities: pending },
  ],
  [
    'a failed run with its close event',
    [...everyKind, failedClose],
    { ...base, status: 'Failed', truncated: false },
  ],
  [
    'a failed run with a cut history and the close event of describe',
    everyKind.slice(0, 6),
    { ...base, status: 'Failed', truncated: true, closeEvent: failedClose },
  ],
  [
    'a failed run with a cut history and the failure of describe',
    everyKind.slice(0, 3),
    {
      ...base,
      status: 'Failed',
      truncated: true,
      failure: { message: 'from describe' },
    },
  ],
  [
    'a run that continued as new',
    everyKind,
    { ...base, status: 'ContinuedAsNew', truncated: false },
  ],
  [
    'a completed run',
    everyKind.slice(0, 4),
    { ...base, status: 'Completed', truncated: false },
  ],
];

const fixturesRoot = resolve(__dirname, '../../../../test-fixtures');
for (const dir of ['event-groups', 'llm-integrations']) {
  for (const file of readdirSync(resolve(fixturesRoot, dir)).sort()) {
    if (!file.endsWith('.json')) continue;
    const { events } = readHistoryFixture(dir, file.replace(/\.json$/, ''));
    cases.push(
      [
        `${dir}/${file}`,
        events,
        { ...base, status: 'Completed', truncated: false },
      ],
      [
        `the first half of ${dir}/${file}, running`,
        events.slice(0, Math.ceil(events.length / 2)),
        { ...base, status: 'Running', truncated: false },
      ],
    );
  }
}
cases.push(
  [
    'many parallel activities',
    plainParallelBatchHistory(20, 10),
    { ...base, status: 'Completed', truncated: false },
  ],
  [
    'an agent with tool calls',
    agentToolCallIdHistory(10, 3),
    { ...base, status: 'Running', truncated: true },
  ],
);

describe('buildWorkflowProgress', () => {
  it.each(cases)(
    'tells the numbers and the current step of the graph: %s',
    (_name, events, options) => {
      expect(buildWorkflowProgress(structuredClone(events), options)).toEqual(
        progressOfGraph(events, options),
      );
    },
  );

  it('covers the texts of the current step', () => {
    const texts = cases.map(
      ([, events, options]) =>
        buildWorkflowProgress(structuredClone(events), options).current,
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        'ship: Waiting for a worker; Timer 1h',
        'ship: Retrying after attempt 2 failed: warehouse closed; Timer 1h',
        'Waiting for approval',
        'Waiting for an external event (signal or update)',
        'Failed at charge',
        'from describe',
        'Continued as new',
        undefined,
      ]),
    );
  });

  it('gives the deadline of the one open step', () => {
    expect(
      buildWorkflowProgress([everyKind[0], everyKind[12]], {
        ...base,
        status: 'Running',
        truncated: false,
        searchAttributes: { ApprovalPending: true },
      }),
    ).toEqual({
      status: 'Running',
      completedSteps: 0,
      totalSteps: 1,
      truncated: false,
      current: 'Waiting for approval',
      currentDeadline: { time: '2027-01-15T09:00:12.000Z', kind: 'timeout' },
    });
  });

  it('reads no payload, summary or model call', () => {
    detailReads.forEach(read => read.mockClear());
    buildWorkflowProgress(structuredClone([...everyKind, failedClose]), {
      ...base,
      status: 'Failed',
      truncated: false,
    });
    buildWorkflowProgress(agentToolCallIdHistory(10, 3), {
      ...base,
      status: 'Running',
      truncated: false,
    });
    for (const read of detailReads) expect(read).not.toHaveBeenCalled();

    // The graph of the same run reads them.
    buildWorkflowGraph(structuredClone([...everyKind, failedClose]), {
      ...base,
      status: 'Failed',
      truncated: false,
    });
    for (const read of detailReads) expect(read).toHaveBeenCalled();
  });
});
