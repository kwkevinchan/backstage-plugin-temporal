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

import { buildWorkflowGraph } from '../graph';
import { canonicalJson, MAX_CANONICAL_JSON_DEPTH } from './json';
import { summarizeModelCall } from './llm';

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
  const inputPayloads = (end: { input?: unknown; rawInput?: unknown }) => {
    if (end.rawInput !== undefined) return { payloads: [end.rawInput] };
    return end.input === undefined ? undefined : payloads(end.input);
  };
  const resultPayloads = (end: { result?: unknown; rawResult?: unknown }) => {
    if (end.rawResult !== undefined) return { payloads: [end.rawResult] };
    return end.result === undefined ? undefined : payloads(end.result);
  };
  const activity = (
    type: string,
    activityId: string,
    end: {
      input?: unknown;
      rawInput?: unknown;
      result?: unknown;
      rawResult?: unknown;
      failure?: unknown;
      open?: boolean;
    },
  ) => {
    const id = add('ActivityTaskScheduled', {
      activityId,
      activityType: { name: type },
      input: inputPayloads(end),
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
      result: resultPayloads(end),
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

/** The reference payload a worker with External Storage leaves in the history. */
const storedElsewhere = {
  metadata: {
    encoding: b64('json/protobuf'),
    messageType: b64('temporal.api.sdk.v1.ExternalStorageReference'),
  },
  data: b64(
    JSON.stringify({
      driverName: 'aws.s3driver',
      claimData: {
        bucket: 'payloads',
        key: 'v0/d/sha256/abc',
        hash_algorithm: 'sha256',
        hash_value: 'a'.repeat(64),
      },
    }),
  ),
  externalPayloads: [{ sizeBytes: '4096' }],
};

describe('tool calls whose arguments are in External Storage', () => {
  const run = (second: { input?: unknown; rawInput?: unknown }) => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const call = h.activity('invokeModel', 'model-1', {
      input: vercelInput,
      result: {
        ...vercelResult,
        content: [
          {
            type: 'tool-call',
            toolName: 'search',
            input: { query: 'second' },
          },
        ],
      },
    });
    const first = h.activity('search', 'search-1', {
      input: { query: 'first' },
      result: 'a',
    });
    const other = h.activity('search', 'search-2', { ...second, result: 'b' });
    const graph = buildWorkflowGraph(h.events, options);
    return {
      call,
      first,
      other,
      tool: graph.nodes.find(n => n.id === `activity-${call}`)!.llm!
        .toolCalls![0],
    };
  };

  it('are matched by name and arguments when they are in the history', () => {
    const { other, tool } = run({ input: { query: 'second' } });
    expect(tool.nodeId).toBe(`activity-${other}`);
  });

  it('are matched by name alone, to the first step of that name, when they are not readable', () => {
    const { first, tool } = run({ rawInput: storedElsewhere });
    expect(tool.nodeId).toBe(`activity-${first}`);
    expect(tool.inferred).toBe(true);
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
    const read = { framework: 'x', call: {} };
    const record = (status: string, decoded: unknown) =>
      summarizeModelCall({ status } as any, read, decoded).summary.record;
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

describe('graph building limits (deep payloads and many tool requests)', () => {
  const makeNested = (depth: number): Record<string, unknown> => {
    let v: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < depth; i += 1) v = { a: v };
    return v;
  };

  // JSON.stringify overflows the stack at this depth, so the payload text is
  // written by hand.
  const nestedPayload = (depth: number) => ({
    metadata: { encoding: b64('json/plain') },
    data: b64(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`),
  });

  it('treats payloads deeper than 64 levels as non-comparable without overflowing the stack', () => {
    expect(canonicalJson(makeNested(MAX_CANONICAL_JSON_DEPTH - 1))).toEqual(
      expect.any(String),
    );
    expect(canonicalJson(makeNested(MAX_CANONICAL_JSON_DEPTH))).toBeUndefined();
    expect(canonicalJson(makeNested(5000))).toBeUndefined();

    // A graph with a 5000-level tool payload and tool request builds without throwing.
    const depth = 5000;
    const nested = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('invokeModel', 'm-1', {
      input: vercelInput,
      rawResult: {
        metadata: { encoding: b64('json/plain') },
        data: b64(
          `{"content":[{"type":"tool-call","toolCallId":"c-1","toolName":"lookup","input":${nested}}]}`,
        ),
      },
    });
    const toolId = h.activity('lookup', 't-1', {
      rawInput: nestedPayload(depth),
      result: { ok: true },
    });
    const graph = buildWorkflowGraph(h.events, options);
    expect(graph.nodes.find(n => n.id === `activity-${toolId}`)).toBeDefined();
  });

  /** A model call result that asks for `requests` tools, without call IDs. */
  const asking = (requests: number) => ({
    content: Array.from({ length: requests }, (_, i) => ({
      type: 'tool-call',
      toolName: 'lookup',
      input: { idx: i },
    })),
  });

  /** Model calls that each ask for `requests` tools; the tool node that follows each. */
  const toolNodesAfterModelCalls = (calls: number, requests: number) => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const tools: number[] = [];
    for (let i = 0; i < calls; i += 1) {
      h.activity('invokeModel', `m-${i}`, {
        input: vercelInput,
        result: asking(requests),
      });
      tools.push(
        h.activity('lookup', `t-${i}`, {
          input: { idx: 0 },
          result: { ok: true },
        }),
      );
    }
    const graph = buildWorkflowGraph(h.events, options);
    return tools.map(id => graph.nodes.find(n => n.id === `activity-${id}`)!);
  };

  it('infers the tool calls of a model call with exactly 500 unlinked requests', () => {
    const [tool] = toolNodesAfterModelCalls(1, 500);
    expect(tool.tool).toMatchObject({ name: 'lookup', inferred: true });
  });

  it('infers the tool calls of a run with exactly 2000 unlinked requests', () => {
    const nodes = toolNodesAfterModelCalls(4, 500);
    expect(nodes.every(n => n.tool?.inferred)).toBe(true);
  });

  it('skips inference for the whole run when it has more than 2000 unlinked requests', () => {
    // Each model call is within the limit of 500; together they are not.
    const nodes = toolNodesAfterModelCalls(5, 401);
    expect(nodes).toHaveLength(5);
    expect(nodes.every(n => n.tool === undefined)).toBe(true);
  });

  it('skips inference and keeps steps plain when unlinked tool requests exceed 500', () => {
    const [tool] = toolNodesAfterModelCalls(1, 501);
    expect(tool).toBeDefined();
    expect(tool.tool).toBeUndefined();
  });
});
