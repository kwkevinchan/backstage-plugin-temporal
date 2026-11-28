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
    buildWorkflowGraphWithLlm: jest.fn(actual.buildWorkflowGraphWithLlm),
  };
});

import { NotFoundError } from '@backstage/errors';
import { memoryS3, storeExternally } from '../__testUtils__/externalStorage';
import { WorkflowDetail } from '../common';
import { AiWorkflowQueries } from './AiWorkflowQueries';
import { buildWorkflowGraphWithLlm } from './graph';
import {
  MAX_STEP_EVENTS,
  WorkflowHistoryReader,
} from './WorkflowHistoryReader';

const workflow: WorkflowDetail = {
  namespace: 'default',
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowType: 'agentWorkflow',
  taskQueue: 'agents',
  status: 'Running',
  pendingActivities: [],
};

function makeReader(
  readEvents: WorkflowHistoryReader['readEvents'],
): WorkflowHistoryReader {
  return { readEvents } as unknown as WorkflowHistoryReader;
}

describe('AiWorkflowQueries', () => {
  beforeEach(() => {
    (buildWorkflowGraphWithLlm as jest.Mock).mockClear();
  });

  it('forwards truncated to buildWorkflowGraphWithLlm and explains truncated history when eventId is beyond the read limit', async () => {
    const readEvents = jest.fn(async () => ({
      events: [
        { eventId: '1', workflowExecutionStartedEventAttributes: {} },
        {
          eventId: String(MAX_STEP_EVENTS),
          workflowTaskCompletedEventAttributes: {},
        },
      ],
      truncated: true,
    }));
    const ai = new AiWorkflowQueries(makeReader(readEvents));

    await expect(
      ai.llmCall(workflow, String(MAX_STEP_EVENTS + 1)),
    ).rejects.toThrow(
      new NotFoundError(
        `Model call ${
          MAX_STEP_EVENTS + 1
        } was not found within the first ${MAX_STEP_EVENTS} history events of this run; the history was truncated`,
      ),
    );
    expect(readEvents).toHaveBeenCalledWith(
      { namespace: 'default', workflowId: 'wf-1', runId: 'run-1' },
      MAX_STEP_EVENTS,
    );
    expect(buildWorkflowGraphWithLlm).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ truncated: true }),
    );
  });

  it('reports missing model call within truncated range without blaming truncation', async () => {
    const readEvents = jest.fn(async () => ({
      events: [
        { eventId: '1', workflowExecutionStartedEventAttributes: {} },
        {
          eventId: String(MAX_STEP_EVENTS),
          workflowTaskCompletedEventAttributes: {},
        },
      ],
      truncated: true,
    }));
    const ai = new AiWorkflowQueries(makeReader(readEvents));

    await expect(ai.llmCall(workflow, '42')).rejects.toThrow(
      new NotFoundError('No model call 42 in this run'),
    );
    expect(buildWorkflowGraphWithLlm).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ truncated: true }),
    );
  });

  it('reports truncation when truncated history returns empty events', async () => {
    const readEvents = jest.fn(async () => ({
      events: [],
      truncated: true,
    }));
    const ai = new AiWorkflowQueries(makeReader(readEvents));

    await expect(ai.llmCall(workflow, '1')).rejects.toThrow(
      new NotFoundError(
        `Model call 1 was not found within the first ${MAX_STEP_EVENTS} history events of this run; the history was truncated`,
      ),
    );
  });

  it('says where the failure of the latest attempt is stored, like the graph', async () => {
    const s3 = memoryS3();
    const earlier = await storeExternally(s3, { attempt: 1 });
    const latest = await storeExternally(s3, { attempt: 2 });
    const plain = (value: unknown) => ({
      metadata: { encoding: Buffer.from('json/plain').toString('base64') },
      data: Buffer.from(JSON.stringify(value)).toString('base64'),
    });
    const failure = (message: string, payload: unknown) => ({
      message,
      applicationFailureInfo: { details: { payloads: [payload] } },
    });
    const readEvents = jest.fn(async () => ({
      events: [
        { eventId: '1', workflowExecutionStartedEventAttributes: {} },
        {
          eventId: '2',
          activityTaskScheduledEventAttributes: {
            activityId: 'model',
            activityType: { name: 'invokeModel' },
            input: {
              payloads: [
                plain({
                  modelId: 'gpt-small',
                  options: { prompt: [{ role: 'user', content: [] }] },
                }),
              ],
            },
          },
        },
        {
          eventId: '3',
          activityTaskStartedEventAttributes: {
            scheduledEventId: '2',
            attempt: 2,
            lastFailure: failure('attempt 1', earlier.payload),
          },
        },
        {
          eventId: '4',
          activityTaskFailedEventAttributes: {
            scheduledEventId: '2',
            failure: failure('attempt 2', latest.payload),
          },
        },
      ],
      truncated: false,
    }));
    const ai = new AiWorkflowQueries(makeReader(readEvents));

    const response = await ai.llmCall({ ...workflow, status: 'Failed' }, '2');

    expect(response.record).toBeUndefined();
    expect(response.external).toMatchObject({ key: latest.key });
  });

  it('reports ordinary NotFoundError when history is not truncated', async () => {
    const readEvents = jest.fn(async () => ({
      events: [{ eventId: '1', workflowExecutionStartedEventAttributes: {} }],
      truncated: false,
    }));
    const ai = new AiWorkflowQueries(makeReader(readEvents));

    await expect(ai.llmCall(workflow, '9999')).rejects.toThrow(
      new NotFoundError('No model call 9999 in this run'),
    );
    expect(buildWorkflowGraphWithLlm).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ truncated: false }),
    );
  });
});
