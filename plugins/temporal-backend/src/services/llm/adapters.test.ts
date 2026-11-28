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

import type { WorkflowGraphNode, WorkflowLlmRecord } from '../../common';
import { readHistoryFixture } from '../../__testUtils__/fixtures';
import { buildWorkflowGraph, buildWorkflowGraphWithLlm } from '../graph';

/** A history of `test-fixtures/llm-integrations`. */
function fixture(name: string): any[] {
  return readHistoryFixture('llm-integrations', name).events;
}

const options = {
  namespace: 'default',
  workflowId: 'wf',
  status: 'Completed' as const,
  truncated: false,
};

function read(name: string) {
  const events = fixture(name);
  const { graph, llm } = buildWorkflowGraphWithLlm(events, options);
  const node = (id: number) =>
    graph.nodes.find(n => n.id === `activity-${id}`)!;
  const calls = graph.nodes.filter(n => n.llm);
  const record = (id: number): WorkflowLlmRecord =>
    llm.calls.get(`activity-${id}`)!.call.record!;
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
    // The length of each call is read from the times of its activity.
    for (const c of calls) {
      expect(c.llm!.durationMs).toBeGreaterThan(0);
    }
    expect(calls.map(c => c.llm!.usage?.reasoningTokens)).toEqual([
      12, 0, 0, 12, 0, 0,
    ]);
    expect(calls.map(c => c.llm!.usage?.cacheReadInputTokens)).toEqual([
      20, 20, 20, 20, 20, 20,
    ]);
    expect(node(11).llm).toMatchObject({
      framework: 'vercel-ai-sdk',
      record: 'available',
      model: 'fake-model-2026-11',
      reasoning: true,
      finishReasons: ['tool-calls'],
    });
    // No provider in the history.
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

function vercelRecord(content: unknown[]) {
  const { llm } = buildWorkflowGraphWithLlm(
    history([
      {
        type: 'invokeModel',
        input: { modelId: 'm', options: { prompt: [] } },
        result: {
          content,
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 1 } },
        },
      },
    ]),
    options,
  );
  return [...llm.calls.values()][0].call.record!;
}

describe('Vercel AI SDK tool-result fields', () => {
  it('reads a provider-executed tool result from result', () => {
    const record = vercelRecord([
      {
        type: 'tool-result',
        toolCallId: 'call_web_1',
        toolName: 'web_search',
        result: { hits: ['https://example.com'] },
      },
    ]);
    expect(record.outputMessages[0].parts).toEqual([
      {
        type: 'tool_call_response',
        id: 'call_web_1',
        name: 'web_search',
        response: { hits: ['https://example.com'] },
      },
    ]);
  });

  it('falls back to output when result is absent', () => {
    const record = vercelRecord([
      {
        type: 'tool-result',
        toolCallId: 'call_search_1',
        toolName: 'search_docs',
        output: {
          type: 'json',
          value: { hits: ['docs/event-groups.md'] },
        },
      },
    ]);
    expect(record.outputMessages[0].parts).toEqual([
      {
        type: 'tool_call_response',
        id: 'call_search_1',
        name: 'search_docs',
        response: { hits: ['docs/event-groups.md'] },
      },
    ]);
  });

  it('keeps a result that looks like { type, value }', () => {
    const raw = {
      type: 'json',
      value: { hits: ['https://example.com'] },
    };
    const record = vercelRecord([
      {
        type: 'tool-result',
        toolCallId: 'call_web_2',
        toolName: 'web_search',
        result: raw,
      },
    ]);
    expect(record.outputMessages[0].parts).toEqual([
      {
        type: 'tool_call_response',
        id: 'call_web_2',
        name: 'web_search',
        response: raw,
      },
    ]);
  });

  it('uses a null, zero or empty-string result instead of output', () => {
    for (const result of [null, 0, '']) {
      const record = vercelRecord([
        {
          type: 'tool-result',
          toolCallId: 'call_web_3',
          toolName: 'web_search',
          result,
          output: {
            type: 'json',
            value: { hits: ['should-not-be-used'] },
          },
        },
      ]);
      expect(record.outputMessages[0].parts).toEqual([
        {
          type: 'tool_call_response',
          id: 'call_web_3',
          name: 'web_search',
          response: result,
        },
      ]);
    }
  });
});

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
});
