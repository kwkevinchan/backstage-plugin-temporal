/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { TemporalLlmAdapter } from '../../node/alpha';
import { toWorkflowSteps } from '../convert';
import { buildWorkflowGraph } from '../graph';
import { LlmAdapters } from './LlmAdapters';
import { summarizeModelCalls } from './llm';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payload = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});
const payloads = (value: unknown) => ({ payloads: [payload(value)] });

const vercelInput = {
  modelId: 'fake-reasoner-1',
  options: {
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'Explain retries.' }] },
    ],
  },
};

const vercelResult = {
  content: [
    { type: 'reasoning', text: 'I should look this up.' },
    { type: 'text', text: 'Searching.' },
    {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'search',
      input: { query: 'retries' },
    },
  ],
  finishReason: { unified: 'tool-calls' },
  usage: {
    inputTokens: { total: 40, cacheRead: 8 },
    outputTokens: { total: 12, reasoning: 4 },
  },
  response: { id: 'resp-1', modelId: 'fake-reasoner-1-2026-11' },
};

/** History events in protobuf JSON form, one second apart. */
function history() {
  const events: any[] = [];
  const base = Date.parse('2026-11-03T00:00:00Z') / 1000;
  const add = (type: string, attributes: Record<string, unknown> = {}) => {
    const key = `${type.charAt(0).toLowerCase()}${type.slice(
      1,
    )}EventAttributes`;
    events.push({
      eventId: String(events.length + 1),
      eventTime: { seconds: String(base + events.length + 1) },
      [key]: attributes,
    });
    return events.length;
  };
  const activity = (
    type: string,
    activityId: string,
    end: {
      input?: unknown;
      result?: unknown;
      rawResult?: unknown;
      failure?: unknown;
      open?: boolean;
    },
  ) => {
    const id = add('ActivityTaskScheduled', {
      activityId,
      activityType: { name: type },
      input: end.input === undefined ? undefined : payloads(end.input),
    });
    add('ActivityTaskStarted', { scheduledEventId: String(id), attempt: 1 });
    if (end.open) return id;
    if (end.failure) {
      add('ActivityTaskFailed', {
        scheduledEventId: String(id),
        failure: end.failure,
      });
      return id;
    }
    add('ActivityTaskCompleted', {
      scheduledEventId: String(id),
      result:
        end.rawResult !== undefined
          ? { payloads: [end.rawResult] }
          : end.result === undefined
          ? undefined
          : payloads(end.result),
    });
    return id;
  };
  return { events, add, activity };
}

const options = {
  namespace: 'default',
  workflowId: 'agent-1',
  status: 'Completed' as const,
  truncated: false,
  includePayloads: false,
};

describe('LLM steps in the graph', () => {
  it('summarizes official model calls and infers their tool calls', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', { input: payloads({ task: 'x' }) });
    const prepare = h.activity('prepare', '1', { result: 'ok' });
    const call = h.activity('invokeModel', 'model-1', {
      input: vercelInput,
      result: vercelResult,
    });
    const tool = h.activity('search', 'search-1', {
      result: { hits: ['docs/retries.md'] },
    });
    h.add('WorkflowExecutionCompleted', { result: payloads('done') });
    const graph = buildWorkflowGraph(h.events, options);
    const node = (id: number) =>
      graph.nodes.find(n => n.id === `activity-${id}`)!;
    expect(node(prepare).llm).toBeUndefined();
    expect(node(call).llm).toMatchObject({
      framework: 'vercel-ai-sdk',
      record: 'available',
      model: 'fake-reasoner-1-2026-11',
      reasoning: true,
      usage: {
        inputTokens: 40,
        outputTokens: 12,
        reasoningTokens: 4,
        cacheReadInputTokens: 8,
      },
    });
    expect(node(call).llm!.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'search',
        nodeId: `activity-${tool}`,
        status: 'Completed',
        inferred: true,
      },
    ]);
    expect(node(tool).tool).toMatchObject({
      llmNodeId: `activity-${call}`,
      name: 'search',
      inferred: true,
    });
  });

  it('leaves workflows without matching payloads as they are', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('callModel', 'callModel-1', { result: { text: 'hi' } });
    h.add('MarkerRecorded', {
      markerName: 'core_local_activity',
      details: { data: payloads({ activity_type: 'search' }) },
    });
    const graph = buildWorkflowGraph(h.events, options);
    for (const n of graph.nodes) {
      expect(n.llm).toBeUndefined();
      expect(n.tool).toBeUndefined();
    }
    expect(graph.nodes.find(n => n.kind === 'marker')!.name).toBe(
      'Local activity',
    );
  });
});

describe('the state of a model call without a record', () => {
  const sealed = {
    metadata: { encoding: b64('binary/encrypted') },
    data: b64('sealed'),
  };

  it('is pending while the call is open, missing once it ended without a result, and unreadable when the result cannot be decoded', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const open = h.activity('invokeModel', 'open', {
      input: vercelInput,
      open: true,
    });
    const empty = h.activity('invokeModel', 'empty', { input: vercelInput });
    const hidden = h.activity('invokeModel', 'hidden', {
      input: vercelInput,
      rawResult: sealed,
    });
    const graph = buildWorkflowGraph(h.events, {
      ...options,
      status: 'Running',
    });
    const llm = (id: number) =>
      graph.nodes.find(n => n.id === `activity-${id}`)!.llm;
    expect(llm(open)).toEqual({
      framework: 'vercel-ai-sdk',
      record: 'pending',
      toolCalls: [],
      reasoning: false,
    });
    expect(llm(empty)).toMatchObject({ record: 'missing' });
    expect(llm(hidden)).toMatchObject({ record: 'unreadable' });
  });

  it('is decided by the status of the step and by the decoded result', () => {
    const read = { framework: 'x', calls: [{}] };
    const record = (status: string, decoded: unknown) =>
      summarizeModelCalls({ status } as any, read, decoded).summary.record;
    expect(record('Running', undefined)).toBe('pending');
    expect(record('Retrying', undefined)).toBe('pending');
    expect(record('Completed', undefined)).toBe('missing');
    expect(record('TimedOut', undefined)).toBe('missing');
    expect(record('Completed', { encoding: 'json/plain', value: 'text' })).toBe(
      'missing',
    );
    expect(
      record('Completed', {
        encoding: 'binary/encrypted',
        size: 9,
        undecodable: true,
      }),
    ).toBe('unreadable');
    expect(
      record('Completed', { encoding: 'json/protobuf', external: {} }),
    ).toBe('unreadable');
  });
});

describe('failure details of a model call', () => {
  /** An adapter that reads the record a failed call put in its failure. */
  const failureAdapter: TemporalLlmAdapter = {
    id: 'failure-details',
    isModelCall: step => step.activityType === 'callModel',
    readModelCalls: (_step, payloads) => {
      const details: any = payloads.failureDetails?.[0];
      if (!details) return [{}];
      return [
        {
          record: {
            requestModel: details.model,
            usage: {},
            systemInstructions: [],
            inputMessages: [],
            outputMessages: [],
            toolExecutions: [],
            error: details.error,
          },
        },
      ];
    },
  };

  it('gives the record of a failed call to the adapter', () => {
    const adapters = new LlmAdapters();
    adapters.add(failureAdapter);
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const id = h.activity('callModel', 'call-1', {
      failure: {
        message: 'wrapped',
        cause: {
          message: 'rate limited',
          applicationFailureInfo: {
            details: payloads({
              model: 'm',
              error: { type: 'RateLimit', message: 'rate limited' },
            }),
          },
        },
      },
    });
    const graph = buildWorkflowGraph(h.events, {
      ...options,
      status: 'Failed',
      llmAdapters: adapters,
    });
    expect(graph.nodes.find(n => n.id === `activity-${id}`)!.llm).toMatchObject(
      {
        framework: 'failure-details',
        record: 'available',
        model: 'm',
        error: 'RateLimit',
      },
    );
  });

  it('has no failure details for a step that completed', () => {
    const seen: unknown[] = [];
    const adapters = new LlmAdapters();
    adapters.add({
      ...failureAdapter,
      readModelCalls: (_step, payloads) => {
        seen.push(payloads.failureDetails);
        return [{}];
      },
    });
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('callModel', 'call-1', { result: { ok: true } });
    buildWorkflowGraph(h.events, { ...options, llmAdapters: adapters });
    expect(seen).toEqual([undefined]);
  });
});

describe('tool calls without a model call', () => {
  it('keeps the tool call ID of an MCP tool step that no model call asked for', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const tool = h.activity('files-callTool', 'tool-1', {
      input: { name: 'read', input: {}, options: { toolCallId: 'orphan' } },
      result: 'ok',
    });
    const graph = buildWorkflowGraph(h.events, options);
    expect(graph.nodes.find(n => n.id === `activity-${tool}`)!.tool).toEqual({
      name: 'read',
      toolCallId: 'orphan',
    });
  });
});

describe('LLM steps in the steps response', () => {
  it('adds summaries and tool links', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const call = h.activity('invokeModel', 'model-1', {
      input: vercelInput,
      result: vercelResult,
    });
    const tool = h.activity('search', 'search-1', { result: { hits: [] } });
    const steps = toWorkflowSteps(h.events, false);
    const byId = (id: number) =>
      steps.activities.find(a => a.scheduledEventId === String(id))!;
    expect(byId(call).llm).toMatchObject({
      model: 'fake-reasoner-1-2026-11',
      toolCalls: [{ id: 'call_1', nodeId: `activity-${tool}` }],
    });
    expect(byId(tool).tool).toMatchObject({ llmNodeId: `activity-${call}` });
  });
});
