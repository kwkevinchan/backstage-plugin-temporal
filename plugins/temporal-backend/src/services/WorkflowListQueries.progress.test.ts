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

jest.mock('./graph', () => {
  const actual = jest.requireActual('./graph');
  return {
    __esModule: true,
    ...actual,
    buildWorkflowGraph: jest.fn(actual.buildWorkflowGraph),
    buildWorkflowGraphWithLlm: jest.fn(actual.buildWorkflowGraphWithLlm),
  };
});
jest.mock('./convert', () => {
  const actual = jest.requireActual('./convert');
  return {
    __esModule: true,
    ...actual,
    decodePayloads: jest.fn(actual.decodePayloads),
  };
});

import { mockServices } from '@backstage/backend-test-utils';
import type { WorkflowDetail } from '../common';
import { readHistoryFixture } from '../__testUtils__/fixtures';
import { decodePayloads } from './convert';
import { buildWorkflowGraph, buildWorkflowGraphWithLlm } from './graph';
import {
  MAX_PROGRESS_EVENTS,
  WorkflowListQueries,
} from './WorkflowListQueries';

const actualGraph: typeof import('./graph') = jest.requireActual('./graph');

function listsWith(readStepEvents: jest.Mock) {
  return new WorkflowListQueries(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { readStepEvents } as any,
    mockServices.logger.mock(),
  );
}

const run = (more: Partial<WorkflowDetail>): WorkflowDetail =>
  ({
    namespace: 'default',
    workflowId: 'wf',
    runId: 'run',
    status: 'Running',
    ...more,
  } as WorkflowDetail);

const { events } = readHistoryFixture(
  'llm-integrations',
  'vercel-ai-sdk-agent',
);

describe('the progress of a run in a list', () => {
  beforeEach(() => {
    [buildWorkflowGraph, buildWorkflowGraphWithLlm, decodePayloads].forEach(
      fn => (fn as jest.Mock).mockClear(),
    );
  });

  it('has the numbers of the graph, without building the graph or decoding a payload', async () => {
    const workflow = run({ status: 'Completed' });
    const readStepEvents = jest.fn(async () => ({
      events: structuredClone(events),
      truncated: false,
    }));

    const progress = await listsWith(readStepEvents).progress(workflow);

    expect(readStepEvents).toHaveBeenCalledWith(workflow, MAX_PROGRESS_EVENTS);
    expect(buildWorkflowGraph).not.toHaveBeenCalled();
    expect(buildWorkflowGraphWithLlm).not.toHaveBeenCalled();
    expect(decodePayloads).not.toHaveBeenCalled();

    const graph = actualGraph.buildWorkflowGraph(structuredClone(events), {
      namespace: 'default',
      workflowId: 'wf',
      status: 'Completed',
      truncated: false,
    });
    expect(graph.totalSteps).toBeGreaterThan(0);
    expect(progress).toEqual({
      status: 'Completed',
      completedSteps: graph.completedSteps,
      totalSteps: graph.totalSteps,
      truncated: false,
    });
  });

  it('tells where a failed run failed from the close event read with a cut history', async () => {
    const workflow = run({ status: 'Failed' });
    const activity = events.find(
      (e: any) => e.activityTaskScheduledEventAttributes,
    );
    const closeEvent = {
      eventId: '9999',
      workflowExecutionFailedEventAttributes: {
        failure: {
          message: 'Activity task failed',
          cause: {
            activityFailureInfo: {
              scheduledEventId: activity.eventId,
              activityType:
                activity.activityTaskScheduledEventAttributes.activityType,
            },
          },
        },
      },
    };
    const cut = events.slice(0, events.indexOf(activity) + 1);
    const progress = await listsWith(
      jest.fn(async () => ({ events: cut, truncated: true, closeEvent })),
    ).progress(workflow);

    expect(progress).toEqual({
      status: 'Failed',
      completedSteps: 0,
      totalSteps: 1,
      truncated: true,
      current: `Failed at ${activity.activityTaskScheduledEventAttributes.activityType.name}`,
    });
  });

  it('uses the pending activities and the search attributes of the run', async () => {
    const start = events[0];
    const timer = {
      eventId: '2',
      eventTime: { seconds: '1800000000' },
      timerStartedEventAttributes: {
        timerId: 't',
        startToFireTimeout: { seconds: '60' },
      },
    };
    const progress = await listsWith(
      jest.fn(async () => ({ events: [start, timer], truncated: false })),
    ).progress(run({ searchAttributes: { ApprovalPending: true } }));

    expect(progress).toEqual({
      status: 'Running',
      completedSteps: 0,
      totalSteps: 1,
      truncated: false,
      current: 'Waiting for approval',
      currentDeadline: { time: '2027-01-15T08:01:00.000Z', kind: 'timeout' },
    });
  });
});
