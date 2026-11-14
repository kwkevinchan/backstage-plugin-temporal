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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { WorkflowGraphNode, WorkflowLlmRecord } from '../../common';
import type { TemporalLlmAdapter } from '../../node/alpha';
import { toWorkflowSteps } from '../convert';
import { buildWorkflowGraph, buildWorkflowGraphWithLlm } from '../graph';
import { LlmAdapters } from './LlmAdapters';

/** A history of `test-fixtures/llm-integrations`. */
function fixture(name: string): any[] {
  return JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        `../../../../../test-fixtures/llm-integrations/${name}.json`,
      ),
      'utf8',
    ),
  ).events;
}

const options = {
  namespace: 'default',
  workflowId: 'wf',
  status: 'Completed' as const,
  truncated: false,
  includePayloads: false,
};

function read(name: string, adapters?: LlmAdapters) {
  const events = fixture(name);
  const { graph, llm } = buildWorkflowGraphWithLlm(events, {
    ...options,
    llmAdapters: adapters,
  });
  const node = (id: number) =>
    graph.nodes.find(n => n.id === `activity-${id}`)!;
  const calls = graph.nodes.filter(n => n.llm);
  const record = (id: number, index = 0): WorkflowLlmRecord =>
    llm.calls.get(`activity-${id}`)!.calls[index].record!;
  return { events, graph, node, calls, record };
}

const tokens = (calls: WorkflowGraphNode[]) =>
  calls.map(c => [c.llm!.usage?.inputTokens, c.llm!.usage?.outputTokens]);

describe('Vercel AI SDK adapter', () => {
  it('reads the model calls of an agent', () => {
    const { calls, node, record } = read('vercel-ai-sdk-agent');
    expect(calls.map(c => c.id)).toEqual(
      [11, 23, 35, 47, 59, 71].map(id => `activity-${id}`),
    );
    expect(tokens(calls)).toEqual([
      [121, 30],
      [201, 18],
      [321, 42],
      [122, 30],
      [202, 18],
      [322, 42],
    ]);
    expect(calls.map(c => c.llm!.usage?.reasoningTokens)).toEqual([
      12, 0, 0, 12, 0, 0,
    ]);
    expect(calls.map(c => c.llm!.usage?.cacheReadInputTokens)).toEqual([
      20, 20, 20, 20, 20, 20,
    ]);
    expect(node(11).llm).toMatchObject({
      framework: 'vercel-ai-sdk',
      record: 'available',
      operation: 'chat',
      model: 'fake-model-2026-11',
      reasoning: true,
      finishReasons: ['tool-calls'],
    });
    // No call name and no provider in the history.
    expect(node(11).llm!.call).toBeUndefined();
    expect(node(11).llm!.provider).toBeUndefined();
    expect(node(35).llm).toMatchObject({
      reasoning: false,
      finishReasons: ['stop'],
      toolCalls: [],
    });
    // The MCP tools list is a plain step.
    expect(node(5).llm).toBeUndefined();
    expect(node(5).tool).toBeUndefined();

    const second = record(23);
    expect(second.requestModel).toBe('fake-model');
    expect(second.responseModel).toBe('fake-model-2026-11');
    expect(second.responseId).toBe('resp_aisdk_1_1');
    expect(second.systemInstructions).toEqual([
      { type: 'text', content: expect.any(String) },
    ]);
    expect(second.inputMessages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ]);
    expect(second.inputMessages[1].parts.map(p => p.type)).toEqual([
      'reasoning',
      'tool_call',
    ]);
    expect(second.inputMessages[2].parts[0]).toEqual({
      type: 'tool_call_response',
      id: 'call_r1_search',
      name: 'search_docs',
      response: {
        hits: [
          'docs/event-groups-round-1.md',
          'docs/temporal-primer/README.md',
        ],
      },
    });
    expect(second.outputMessages).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            id: 'call_r1_read',
            name: 'read_file',
            arguments: { path: 'docs/temporal-primer/README.md' },
          },
        ],
      },
    ]);
    expect(
      (second.toolDefinitions as { name: string }[]).map(t => t.name),
    ).toEqual(['search_docs', 'read_file']);
    expect(second.parameters).toEqual({ toolChoice: { type: 'auto' } });
    expect(record(11).outputMessages[0].parts.map(p => p.type)).toEqual([
      'reasoning',
      'tool_call',
    ]);
  });

  it('links an MCP tool by its tool call ID and a workflow tool by inference', () => {
    const { node } = read('vercel-ai-sdk-agent');
    // `search_docs` runs the `searchDocs` activity: no tool call ID.
    expect(node(11).llm!.toolCalls).toEqual([
      {
        id: 'call_r1_search',
        name: 'search_docs',
        nodeId: 'activity-17',
        status: 'Completed',
        inferred: true,
      },
    ]);
    expect(node(17).tool).toEqual({
      toolCallId: 'call_r1_search',
      llmNodeId: 'activity-11',
      name: 'search_docs',
      inferred: true,
    });
    // The MCP tool records the ID; it failed once and was retried.
    expect(node(23).llm!.toolCalls).toEqual([
      {
        id: 'call_r1_read',
        name: 'read_file',
        nodeId: 'activity-29',
        status: 'Completed',
      },
    ]);
    expect(node(29).tool).toEqual({
      toolCallId: 'call_r1_read',
      llmNodeId: 'activity-23',
      name: 'read_file',
    });
    expect(node(29).attempt).toBe(2);
    // The second round links to its own calls.
    expect(node(53).tool).toMatchObject({
      llmNodeId: 'activity-47',
      inferred: true,
    });
    expect(node(65).tool).toMatchObject({ llmNodeId: 'activity-59' });
  });

  it('pairs parallel tool calls with the same arguments in order', () => {
    const { calls, node } = read('vercel-ai-sdk-parallel-tools');
    expect(tokens(calls)).toEqual([
      [101, 41],
      [202, 52],
      [303, 13],
    ]);
    expect(calls[0].llm!.usage?.reasoningTokens).toBe(9);
    const links = (id: number) =>
      node(id).llm!.toolCalls.map(c => [c.id, c.nodeId, c.inferred ?? false]);
    // The same arguments twice: the steps are paired in the order they
    // were scheduled, and the links say they are inferred. The MCP tools
    // record their IDs.
    expect(links(11)).toEqual([
      ['call_same_search_1', 'activity-17', true],
      ['call_same_search_2', 'activity-18', true],
      ['call_same_read_1', 'activity-19', false],
      ['call_same_read_2', 'activity-20', false],
    ]);
    // Different arguments: the arguments decide, not the order.
    expect(links(32)).toEqual([
      ['call_diff_search_b', 'activity-38', true],
      ['call_diff_search_a', 'activity-39', true],
      ['call_diff_read_b', 'activity-40', false],
      ['call_diff_read_a', 'activity-41', false],
    ]);
    expect(node(38).tool).toMatchObject({
      toolCallId: 'call_diff_search_b',
      inferred: true,
    });
  });

  it('reads a streamed call and leaves its stream signals as they are', () => {
    const { calls, graph, record } = read('vercel-ai-sdk-streaming');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 'activity-5',
      name: 'invokeModelStreaming',
      summary: 'streamed call',
      llm: {
        framework: 'vercel-ai-sdk',
        usage: {
          inputTokens: 77,
          outputTokens: 22,
          reasoningTokens: 5,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['stop'],
        reasoning: true,
      },
    });
    expect(record(5).outputMessages[0].parts.map(p => p.type)).toEqual([
      'reasoning',
      'text',
    ]);
    expect(graph.nodes.filter(n => n.kind === 'signal')).toHaveLength(11);
  });

  it('keeps the summary of a call for its title', () => {
    const { calls } = read('vercel-ai-sdk-summary');
    expect(tokens(calls)).toEqual([
      [121, 30],
      [201, 18],
      [321, 42],
    ]);
    for (const c of calls) {
      expect(c.summary).toBe('plan call');
      expect(c.llm!.call).toBeUndefined();
    }
  });

  it('shows the calls of an encrypted history as plain steps', () => {
    const { graph } = read('codec-vercel-ai-sdk-agent');
    const invokes = graph.nodes.filter(n => n.name === 'invokeModel');
    expect(invokes).toHaveLength(3);
    for (const n of graph.nodes) {
      expect(n.llm).toBeUndefined();
      expect(n.tool).toBeUndefined();
    }
  });
});

describe('OpenAI Agents adapter', () => {
  it('reads the model calls of an agent and infers its tool calls', () => {
    const { calls, node, record } = read('openai-agents-agent');
    expect(calls.map(c => c.id)).toEqual(
      [5, 17, 23, 35].map(id => `activity-${id}`),
    );
    expect(tokens(calls)).toEqual([
      [111, 25],
      [261, 40],
      [112, 25],
      [262, 40],
    ]);
    expect(node(5).llm).toMatchObject({
      framework: 'openai-agents',
      model: 'fake-model',
      finishReasons: ['tool-calls'],
      reasoning: false,
    });
    expect(node(17).llm!.finishReasons).toEqual(['stop']);
    expect(node(5).llm!.toolCalls).toEqual([
      {
        id: 'call_oa_r1_search',
        name: 'searchDocs',
        nodeId: 'activity-11',
        status: 'Completed',
        inferred: true,
      },
    ]);
    expect(node(29).tool).toEqual({
      toolCallId: 'call_oa_r2_search',
      llmNodeId: 'activity-23',
      name: 'searchDocs',
      inferred: true,
    });
    const second = record(17);
    expect(second.responseId).toBe('resp_oa_1_1');
    expect(second.systemInstructions).toHaveLength(1);
    expect(second.inputMessages.map(m => [m.role, m.parts[0].type])).toEqual([
      ['user', 'text'],
      ['assistant', 'tool_call'],
      ['tool', 'tool_call_response'],
    ]);
    expect(second.inputMessages[2].parts[0]).toMatchObject({
      id: 'call_oa_r1_search',
      response: {
        hits: [
          'docs/event-groups-round-1.md',
          'docs/temporal-primer/README.md',
        ],
      },
    });
    expect(second.outputMessages[0].parts).toEqual([
      { type: 'text', content: expect.any(String) },
    ]);
    expect(
      (second.toolDefinitions as { name: string }[]).map(t => t.name),
    ).toEqual(['searchDocs']);
  });

  it('pairs parallel tool calls with the same arguments in order', () => {
    const { calls, node } = read('openai-agents-parallel-tools');
    expect(tokens(calls)).toEqual([
      [101, 21],
      [202, 22],
      [303, 23],
    ]);
    const links = (id: number) =>
      node(id).llm!.toolCalls.map(c => [c.id, c.nodeId, c.inferred]);
    expect(links(5)).toEqual([
      ['call_same_1', 'activity-11', true],
      ['call_same_2', 'activity-12', true],
    ]);
    expect(links(20)).toEqual([
      ['call_diff_b', 'activity-26', true],
      ['call_diff_a', 'activity-27', true],
    ]);
  });

  it('reads reasoning and the token details of a response (lists)', () => {
    const { calls, record } = read('openai-agents-reasoning');
    expect(calls).toHaveLength(1);
    expect(calls[0].llm).toMatchObject({
      usage: {
        inputTokens: 150,
        outputTokens: 60,
        reasoningTokens: 12,
        cacheReadInputTokens: 20,
      },
      reasoning: true,
      finishReasons: ['stop'],
    });
    const [message] = record(5).outputMessages;
    expect(message.parts.map(p => p.type)).toEqual(['reasoning', 'text']);
    // The raw reasoning text, not its summary.
    expect(message.parts[0].content).toBe('完整的思考內容。');
  });

  it('reads a streamed call and the token details of a stream event (records)', () => {
    const { calls, record } = read('openai-agents-streaming');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'invokeModelStreamActivity',
      summary: 'streamed call',
      llm: {
        framework: 'openai-agents',
        usage: {
          inputTokens: 70,
          outputTokens: 6,
          reasoningTokens: 0,
          cacheReadInputTokens: 10,
        },
        finishReasons: ['stop'],
      },
    });
    expect(record(5).responseId).toBe('resp_stream_1');
    expect(record(5).outputMessages[0].parts).toEqual([
      { type: 'text', content: '串流的回答。' },
    ]);
  });

  it('keeps the summaries of the calls', () => {
    const { calls } = read('openai-agents-summary');
    expect(tokens(calls)).toEqual([
      [111, 25],
      [261, 40],
      [112, 25],
      [262, 40],
    ]);
    expect(calls.map(c => c.summary)).toEqual([
      'plan call',
      'plan call',
      'model call for DocsAgent (object)',
      'model call for DocsAgent (object)',
    ]);
  });
});

describe('Steps response', () => {
  it('has the same model calls and links as the graph', () => {
    const steps = toWorkflowSteps(fixture('vercel-ai-sdk-agent'), false);
    const step = (id: number) =>
      steps.activities.find(a => a.scheduledEventId === String(id))!;
    expect(step(11).llm).toMatchObject({
      framework: 'vercel-ai-sdk',
      usage: { inputTokens: 121, outputTokens: 30 },
    });
    expect(step(17).tool).toMatchObject({
      llmNodeId: 'activity-11',
      inferred: true,
    });
    expect(step(29).tool).toEqual({
      toolCallId: 'call_r1_read',
      llmNodeId: 'activity-23',
      name: 'read_file',
    });
  });
});

/* Synthetic histories for the checks the recorded ones do not cover. */

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payloads = (value: unknown) => ({
  payloads: [
    {
      metadata: { encoding: b64('json/plain') },
      data: b64(JSON.stringify(value)),
    },
  ],
});

/** One completed activity per entry, in order. */
function history(
  steps: { type: string; input?: unknown; result?: unknown; id?: string }[],
) {
  const events: any[] = [
    { eventId: '1', workflowExecutionStartedEventAttributes: {} },
  ];
  for (const [i, s] of steps.entries()) {
    const id = events.length + 1;
    events.push({
      eventId: String(id),
      activityTaskScheduledEventAttributes: {
        activityId: s.id ?? String(i + 1),
        activityType: { name: s.type },
        input: s.input === undefined ? undefined : payloads(s.input),
      },
    });
    events.push({
      eventId: String(id + 1),
      activityTaskStartedEventAttributes: { scheduledEventId: String(id) },
    });
    events.push({
      eventId: String(id + 2),
      activityTaskCompletedEventAttributes: {
        scheduledEventId: String(id),
        result: s.result === undefined ? undefined : payloads(s.result),
      },
    });
  }
  return events;
}

const vercelCall = {
  type: 'invokeModel',
  input: { modelId: 'm', options: { prompt: [] } },
  result: {
    content: [{ type: 'text', text: 'hi' }],
    usage: { inputTokens: { total: 3 }, outputTokens: { total: 1 } },
  },
};

describe('LLM adapters', () => {
  it('does not take steps of the same names with another shape', () => {
    const graph = buildWorkflowGraph(
      history([
        { type: 'invokeModel', input: { prompt: 'x' }, result: { text: 1 } },
        { type: 'invokeModel', input: vercelCall.input, result: 'done' },
        { type: 'invokeModelActivity', input: { modelName: 3 } },
        {
          type: 'invokeModelStreamActivity',
          input: { modelName: 'm', request: { input: [] } },
          result: [{ type: 'output_text_delta', delta: 'x' }],
        },
        { type: 'docs-callTool', input: { name: 'read_file' } },
      ]),
      options,
    );
    for (const node of graph.nodes) {
      expect(node.llm).toBeUndefined();
      expect(node.tool).toBeUndefined();
    }
  });

  it('shows a step as a plain step when an adapter fails, and warns once', () => {
    const logger = mockServices.logger.mock();
    const adapters = new LlmAdapters(logger);
    adapters.add({
      id: 'throws',
      isModelCall: step => step.activityType === 'invokeModel',
      readModelCalls() {
        throw new Error('secret detail');
      },
    });
    adapters.add({
      id: 'invalid',
      isModelCall: step => step.activityType === 'runAgent',
      readModelCalls: () => [{ record: { usage: 'many' } } as any],
    });
    adapters.addBuiltIns();
    const graph = buildWorkflowGraph(
      history([vercelCall, vercelCall, { type: 'runAgent', result: {} }]),
      { ...options, llmAdapters: adapters },
    );
    for (const node of graph.nodes) expect(node.llm).toBeUndefined();
    expect(JSON.stringify(graph)).not.toContain('secret detail');
    // Once per adapter, with the event ID and the error name only.
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'LLM adapter throws: readModelCalls threw Error; the step is shown as a plain step (activity type invokeModel, event 2)',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^LLM adapter invalid: readModelCalls returned a value of the wrong shape/,
      ),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'secret detail',
    );
  });

  it('asks the adapters that modules add before the built-in ones', () => {
    const adapters = new LlmAdapters();
    const mine: TemporalLlmAdapter = {
      id: 'mine',
      isModelCall: step => step.activityType === 'invokeModel',
      readModelCalls: () => [
        {
          name: 'my call',
          record: {
            requestModel: 'my-model',
            usage: { inputTokens: 1 },
            systemInstructions: [],
            inputMessages: [],
            outputMessages: [],
            toolExecutions: [],
          },
        },
      ],
    };
    adapters.add(mine);
    adapters.addBuiltIns();
    expect(adapters.all().map(a => a.id)).toEqual([
      'mine',
      'vercel-ai-sdk',
      'openai-agents',
      'temporal-workflow-kit',
    ]);
    const graph = buildWorkflowGraph(history([vercelCall]), {
      ...options,
      llmAdapters: adapters,
    });
    expect(graph.nodes.find(n => n.llm)!.llm).toMatchObject({
      framework: 'mine',
      call: 'my call',
      model: 'my-model',
    });
    // An adapter that returns no calls passes the step on.
    const empty = new LlmAdapters();
    empty.add({ ...mine, readModelCalls: () => [] });
    empty.addBuiltIns();
    const passed = buildWorkflowGraph(history([vercelCall]), {
      ...options,
      llmAdapters: empty,
    });
    expect(passed.nodes.find(n => n.llm)!.llm!.framework).toBe('vercel-ai-sdk');
  });

  it('rejects a taken ID', () => {
    const adapters = LlmAdapters.builtIn();
    expect(() =>
      adapters.add({
        id: 'vercel-ai-sdk',
        isModelCall: () => false,
        readModelCalls: () => [],
      }),
    ).toThrow('Duplicate LLM adapter id: vercel-ai-sdk');
  });

  it('sums the calls of a step that makes several', () => {
    const adapters = new LlmAdapters();
    const record = (model: string, input: number, tool?: string) => ({
      requestModel: model,
      usage: { inputTokens: input, outputTokens: 1 },
      systemInstructions: [],
      inputMessages: [],
      outputMessages: tool
        ? [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'tool_call',
                  id: `${tool}-1`,
                  name: tool,
                  arguments: {},
                },
              ],
            },
          ]
        : [],
      toolExecutions: [],
    });
    adapters.add({
      id: 'whole-agent',
      isModelCall: step => step.activityType === 'runAgent',
      readModelCalls: () => [
        { record: record('a', 10, 'grep') },
        { record: record('b', 20) },
      ],
    });
    const { graph, llm } = buildWorkflowGraphWithLlm(
      history([{ type: 'runAgent', result: {} }]),
      { ...options, llmAdapters: adapters },
    );
    const node = graph.nodes.find(n => n.llm)!;
    expect(node.llm).toMatchObject({
      framework: 'whole-agent',
      callCount: 2,
      model: 'b',
      usage: { inputTokens: 30, outputTokens: 2 },
      toolCalls: [{ id: 'grep-1', name: 'grep' }],
    });
    expect(llm.calls.get(node.id)!.calls).toHaveLength(2);
  });
});

describe('LLM adapter results', () => {
  const plainRecord = () => ({
    usage: {},
    systemInstructions: [],
    inputMessages: [],
    outputMessages: [] as any[],
    toolExecutions: [],
  });
  const graphWith = (
    adapter: TemporalLlmAdapter,
    events = history([vercelCall]),
  ) => {
    const logger = mockServices.logger.mock();
    const adapters = new LlmAdapters(logger);
    adapters.add(adapter);
    adapters.addBuiltIns();
    return {
      graph: buildWorkflowGraph(events, { ...options, llmAdapters: adapters }),
      logger,
    };
  };

  it('takes values that are not plain JSON as a failure', () => {
    const args: any = { q: 'x' };
    args.self = args;
    const withArgs = graphWith({
      id: 'cyclic-arguments',
      isModelCall: step => step.activityType === 'invokeModel',
      readModelCalls: () => {
        const record = plainRecord();
        record.outputMessages = [
          {
            role: 'assistant',
            parts: [{ type: 'tool_call', name: 't', arguments: args }],
          },
        ];
        return [{ record }];
      },
    });
    const raw: any = {};
    raw.raw = raw;
    const withRaw = graphWith({
      id: 'cyclic-raw',
      isModelCall: step => step.activityType === 'invokeModel',
      readModelCalls: () => [{ record: plainRecord(), raw }],
    });
    const withFunction = graphWith({
      id: 'function',
      isModelCall: step => step.activityType === 'invokeModel',
      readModelCalls: () => [
        { record: plainRecord(), raw: { f: () => 1 } as any },
      ],
    });
    for (const { graph, logger } of [withArgs, withRaw, withFunction]) {
      // The step is a plain step, not the built-in adapter's call.
      expect(graph.nodes.find(n => n.llm)).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not plain JSON'),
      );
    }
  });

  it('takes more than 100 calls of one step as a failure', () => {
    const calls = (n: number) => ({
      id: `calls-${n}`,
      isModelCall: (step: { activityType: string }) =>
        step.activityType === 'invokeModel',
      readModelCalls: () =>
        Array.from({ length: n }, () => ({ record: plainRecord() })),
    });
    expect(
      graphWith(calls(100)).graph.nodes.find(n => n.llm)!.llm!.callCount,
    ).toBe(100);
    expect(graphWith(calls(101)).graph.nodes.find(n => n.llm)).toBeUndefined();
  });

  it('reads model calls of activities only, and says so for a local activity', () => {
    const events: any[] = [
      { eventId: '1', workflowExecutionStartedEventAttributes: {} },
      {
        eventId: '2',
        markerRecordedEventAttributes: {
          markerName: 'core_local_activity',
          details: {
            data: payloads({ activity_id: '1', activity_type: 'callLocal' }),
            result: payloads({ text: 'hi' }),
          },
        },
      },
    ];
    const readCalls = jest.fn(() => [{ record: plainRecord() }]);
    const { graph, logger } = graphWith(
      {
        id: 'local',
        isModelCall: step => step.activityType === 'callLocal',
        readModelCalls: readCalls,
      },
      events,
    );
    expect(graph.nodes.find(n => n.kind === 'marker')!.llm).toBeUndefined();
    expect(readCalls).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('isModelCall is true for a local activity'),
    );
  });

  it('links the workflow kit tool calls by their markers only', () => {
    const kitRecord = {
      'temporal.llm': {
        v: 1,
        attributes: {
          'gen_ai.output.messages': [
            {
              role: 'assistant',
              parts: [
                { type: 'tool_call', id: 'c1', name: 'search', arguments: {} },
              ],
            },
          ],
        },
      },
    };
    // A plain activity named like the tool, without a tool marker.
    const graph = buildWorkflowGraph(
      history([
        { type: 'callModel', id: 'llm/a', result: kitRecord },
        { type: 'search', id: 'plain-search', input: {} },
      ]),
      options,
    );
    const call = graph.nodes.find(n => n.llm)!;
    expect(call.llm!.toolCalls).toEqual([{ id: 'c1', name: 'search' }]);
    expect(graph.nodes.find(n => n.name === 'search')!.tool).toBeUndefined();
  });
});
