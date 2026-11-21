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
import { WorkflowDetail } from '../common';
import { AiWorkflowQueries } from './AiWorkflowQueries';
import { buildWorkflowGraphWithLlm } from './graph';
import { LlmAdapters } from './llm/LlmAdapters';
import { MAX_STEP_EVENTS, WorkflowQueries } from './WorkflowQueries';

const workflow: WorkflowDetail = {
  namespace: 'default',
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowType: 'agentWorkflow',
  taskQueue: 'agents',
  status: 'Running',
  pendingActivities: [],
};

function makeQueries(
  readEvents: WorkflowQueries['readEvents'],
): WorkflowQueries {
  return {
    readEvents,
    llmAdapters: LlmAdapters.builtIn(),
  } as unknown as WorkflowQueries;
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
    const ai = new AiWorkflowQueries(makeQueries(readEvents));

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
    const ai = new AiWorkflowQueries(makeQueries(readEvents));

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
    const ai = new AiWorkflowQueries(makeQueries(readEvents));

    await expect(ai.llmCall(workflow, '1')).rejects.toThrow(
      new NotFoundError(
        `Model call 1 was not found within the first ${MAX_STEP_EVENTS} history events of this run; the history was truncated`,
      ),
    );
  });

  it('reports ordinary NotFoundError when history is not truncated', async () => {
    const readEvents = jest.fn(async () => ({
      events: [{ eventId: '1', workflowExecutionStartedEventAttributes: {} }],
      truncated: false,
    }));
    const ai = new AiWorkflowQueries(makeQueries(readEvents));

    await expect(ai.llmCall(workflow, '9999')).rejects.toThrow(
      new NotFoundError('No model call 9999 in this run'),
    );
    expect(buildWorkflowGraphWithLlm).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ truncated: false }),
    );
  });
});
