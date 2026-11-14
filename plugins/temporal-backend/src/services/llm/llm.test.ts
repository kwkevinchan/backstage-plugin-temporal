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

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseLlmMarker } from '../../common';
import { parseActivityLoopMarker } from '../loops';
import { toWorkflowSteps } from '../convert';
import { buildWorkflowGraph } from '../graph';
import type { WorkflowNodeStatus } from '../../common';
import { summarizeModelCalls } from './llm';
import { normalizeLlmRecord, workflowKitAdapter } from './workflowKit';

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../test-fixtures/llm-records.json'),
    'utf8',
  ),
);

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payload = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});
const payloads = (value: unknown) => ({ payloads: [payload(value)] });

/**
 * The summary of a step with the activity ID `llm/<call>`, read by the
 * workflow kit's adapter. `result` is the decoded result payload.
 */
function summarizeLlmCall(
  node: { status: WorkflowNodeStatus },
  call: string,
  result: any,
) {
  const step = {
    kind: 'activity' as const,
    activityType: 'callModel',
    activityId: `llm/${call}`,
  };
  const calls = workflowKitAdapter.readModelCalls(step, {
    ...(result && 'value' in result ? { result: result.value } : {}),
  });
  return summarizeModelCalls(
    node,
    { framework: 'temporal-workflow-kit', calls },
    result,
  ).summary;
}
const record = (attributes: object, extra: object = {}) => ({
  'temporal.llm': { v: 1, semconv: fixture.semconv, attributes, ...extra },
  value: { raw: true },
});

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
    end: { result?: unknown; failure?: unknown; open?: boolean },
  ) => {
    const id = add('ActivityTaskScheduled', {
      activityId,
      activityType: { name: type },
    });
    add('ActivityTaskStarted', { scheduledEventId: String(id), attempt: 1 });
    if (end.open) return id;
    if (end.failure) {
      add('ActivityTaskFailed', {
        scheduledEventId: String(id),
        failure: end.failure,
      });
    } else {
      add('ActivityTaskCompleted', {
        scheduledEventId: String(id),
        result: end.result === undefined ? undefined : payloads(end.result),
      });
    }
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

describe('LLM markers in the backend', () => {
  it.each(
    (fixture.markers as any[])
      .filter(m => m.loop)
      .map((m: any): [string, any] => [m.text, m.loop]),
  )('reads the loop marker after %s', (text, loop) => {
    expect(parseActivityLoopMarker(text)).toEqual(loop);
  });

  it.each(
    (fixture.markers as any[]).map((m: any): [string, any] => [m.text, m]),
  )('reads %s like the workflow kit', (text, example: any) => {
    expect(parseLlmMarker(text as string)).toEqual(example.marker ?? undefined);
  });
});

describe('LLM records', () => {
  it.each(
    (fixture.records as any[]).map((r: any): [string, any] => [r.name, r]),
  )('summarizes the %s record the converters write', (_name, example: any) => {
    const summary = summarizeLlmCall({ status: 'Completed' }, 'c1', {
      encoding: 'json/plain',
      value: record(example.attributes),
    });
    expect(summary).toEqual({
      call: 'c1',
      framework: 'temporal-workflow-kit',
      record: 'available',
      operation: 'chat',
      ...example.summary,
    });
  });

  it('reads attributes stored as JSON text, as OpenTelemetry exporters do', () => {
    const attributes = fixture.records[1].attributes;
    const normalized = normalizeLlmRecord(
      record({
        ...attributes,
        'gen_ai.input.messages': JSON.stringify(
          attributes['gen_ai.input.messages'],
        ),
        'gen_ai.output.messages': JSON.stringify(
          attributes['gen_ai.output.messages'],
        ),
        'gen_ai.response.finish_reasons': 'tool_call',
        'gen_ai.request.top_k': 5,
      })['temporal.llm'] as any,
    );
    expect(normalized.systemInstructions).toEqual([
      { type: 'text', content: 'You are a code reviewer.' },
    ]);
    expect(normalized.inputMessages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ]);
    expect(normalized.outputMessages[0].parts[0]).toEqual({
      type: 'reasoning',
      content: 'The file exports a constant; check its use.',
    });
    expect(normalized.finishReasons).toEqual(['tool_call']);
    expect(normalized.parameters).toEqual({
      max_tokens: 4096,
      'reasoning.level': 'enabled',
      top_k: 5,
    });
    expect(normalized.usage.cacheWriteInputTokens).toBe(100);
  });

  it('turns odd parts into text and keeps tool executions', () => {
    const normalized = normalizeLlmRecord(
      record(
        {
          'gen_ai.output.messages': [
            {
              role: 'assistant',
              parts: [
                'plain',
                3,
                { type: 'tool_call', name: 't', arguments: '{"a":1}' },
              ],
            },
            'oops',
          ],
        },
        {
          durationMs: 12.6,
          error: { type: 'Timeout', message: 'too slow' },
          toolExecutions: [
            {
              'gen_ai.tool.name': 'grep',
              'gen_ai.tool.call.id': 'x',
              'gen_ai.tool.call.result': '[1]',
              durationMs: 4,
            },
            {
              'gen_ai.tool.name': 'cat',
              error: { message: 'no file' },
              'error.type': 'ENOENT',
            },
            'bad',
          ],
        },
      )['temporal.llm'] as any,
    );
    expect(normalized.outputMessages[0].parts).toEqual([
      { type: 'text', content: 'plain' },
      { type: 'text', content: '3' },
      { type: 'tool_call', name: 't', arguments: { a: 1 } },
    ]);
    expect(normalized.outputMessages[1]).toEqual({
      role: 'user',
      parts: [{ type: 'text', content: 'oops' }],
    });
    expect(normalized.durationMs).toBe(13);
    expect(normalized.error).toEqual({ type: 'Timeout', message: 'too slow' });
    expect(normalized.toolExecutions).toEqual([
      { name: 'grep', id: 'x', result: [1], durationMs: 4 },
      { name: 'cat', error: { message: 'no file' } },
    ]);
    const summary = summarizeLlmCall({ status: 'Failed' }, 'c', {
      encoding: 'json/plain',
      value: record(
        {},
        {
          toolExecutions: [
            { 'gen_ai.tool.name': 'grep', 'gen_ai.tool.call.id': 'x' },
          ],
        },
      ),
    });
    expect(summary.toolCalls).toEqual([
      { id: 'x', name: 'grep', inActivity: true, status: 'Completed' },
    ]);
  });

  it('says why there is no record', () => {
    expect(summarizeLlmCall({ status: 'Running' }, 'c', undefined).record).toBe(
      'pending',
    );
    expect(
      summarizeLlmCall({ status: 'Completed' }, 'c', {
        encoding: 'json/plain',
        value: 'text',
      }).record,
    ).toBe('missing');
    expect(
      summarizeLlmCall({ status: 'TimedOut' }, 'c', undefined).record,
    ).toBe('missing');
    expect(
      summarizeLlmCall({ status: 'Completed' }, 'c', {
        encoding: 'binary/encrypted',
        size: 9,
        undecodable: true,
      }).record,
    ).toBe('unreadable');
    expect(
      summarizeLlmCall({ status: 'Completed' }, 'c', {
        encoding: 'json/protobuf',
        external: {},
      }).record,
    ).toBe('unreadable');
    expect(
      summarizeLlmCall({ status: 'Completed' }, 'c', {
        encoding: 'json/plain',
        value: { 'temporal.llm': { v: 2, attributes: {} } },
      }).record,
    ).toBe('missing');
  });
});

/** A two round agent: model call, two tools (one fails once), model call. */
function agentHistory() {
  const h = history();
  h.add('WorkflowExecutionStarted', { input: payloads({ task: 'x' }) });
  const prepare = h.activity('prepare', '1', { result: 'ok' });
  const first = h.activity('callModel', 'llm/agent-1/loop/agent/1/callModel', {
    result: record(fixture.records[0].attributes, { durationMs: 1500 }),
  });
  // Two tools in parallel; read_issue #15 failed once and was retried.
  const t1 = h.add('ActivityTaskScheduled', {
    activityId: 'tool/agent-1/call_b1/loop/agent/1/read_issue',
    activityType: { name: 'read_issue' },
  });
  const t2 = h.add('ActivityTaskScheduled', {
    activityId: 'tool/agent-1/call_b2/loop/agent/1/read_issue/2',
    activityType: { name: 'read_issue' },
  });
  h.add('ActivityTaskStarted', { scheduledEventId: String(t1), attempt: 1 });
  h.add('ActivityTaskStarted', {
    scheduledEventId: String(t2),
    attempt: 2,
    lastFailure: { message: 'flaky' },
  });
  h.add('ActivityTaskCompleted', {
    scheduledEventId: String(t1),
    result: payloads('#12'),
  });
  h.add('ActivityTaskCompleted', {
    scheduledEventId: String(t2),
    result: payloads('#15'),
  });
  // A tool run as a local activity, marked in its result.
  const marker = h.add('MarkerRecorded', {
    markerName: 'core_local_activity',
    details: {
      data: payloads({ seq: 3, activity_id: '3', activity_type: 'search' }),
      result: payloads({
        'temporal.llm.tool': { call: 'agent-1', toolCallId: 'call_x' },
        value: [],
      }),
    },
  });
  const second = h.activity('callModel', 'llm/agent-2/loop/agent/2/callModel', {
    result: record({
      'gen_ai.request.model': 'm',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 20,
      'gen_ai.output.messages': [
        { role: 'assistant', parts: [{ type: 'text', content: 'done' }] },
      ],
    }),
  });
  h.add('WorkflowExecutionCompleted', { result: payloads('done') });
  return { ...h, prepare, first, t1, t2, marker, second };
}

describe('LLM steps in the graph', () => {
  it('summarizes model calls and links their tool calls', () => {
    const h = agentHistory();
    const graph = buildWorkflowGraph(h.events, options);
    const node = (id: number, kind = 'activity') =>
      graph.nodes.find(n => n.id === `${kind}-${id}`)!;
    expect(node(h.prepare).llm).toBeUndefined();
    expect(node(h.prepare).tool).toBeUndefined();
    const first = node(h.first);
    expect(first.result).toBeUndefined(); // no payload permission
    expect(first.llm).toMatchObject({
      call: 'agent-1',
      record: 'available',
      model: 'deepseek-reasoner-0528',
      durationMs: 1500,
      reasoning: true,
      usage: { inputTokens: 812, outputTokens: 164 },
    });
    expect(first.llm!.toolCalls).toEqual([
      {
        id: 'call_b1',
        name: 'read_issue',
        nodeId: `activity-${h.t1}`,
        status: 'Completed',
      },
      {
        id: 'call_b2',
        name: 'read_issue',
        nodeId: `activity-${h.t2}`,
        status: 'Completed',
      },
      {
        id: 'call_x',
        name: 'search',
        nodeId: `marker-${h.marker}`,
        status: 'Completed',
      },
    ]);
    expect(node(h.t2).tool).toEqual({
      call: 'agent-1',
      toolCallId: 'call_b2',
      llmNodeId: `activity-${h.first}`,
      name: 'read_issue',
    });
    expect(node(h.t2).attempt).toBe(2);
    expect(node(h.marker, 'marker')).toMatchObject({
      name: 'search',
      tool: { call: 'agent-1', toolCallId: 'call_x' },
    });
    // The tools run in parallel after the first call, then the second call.
    const into = (id: string) =>
      graph.edges.filter(e => e.target === id).map(e => e.source);
    expect(into(`activity-${h.t1}`)).toEqual([`activity-${h.first}`]);
    expect(into(`activity-${h.t2}`)).toEqual([`activity-${h.first}`]);
    // A model call without tools and a duration from the activity.
    expect(node(h.second).llm).toMatchObject({
      call: 'agent-2',
      model: 'm',
      reasoning: false,
      toolCalls: [],
      durationMs: 1000,
    });
    // Rounds of the loop add up their tokens.
    const [loop] = graph.loops!;
    expect(loop.rounds.map(r => [r.iteration, r.llmCalls, r.usage])).toEqual([
      [
        1,
        1,
        {
          inputTokens: 812,
          outputTokens: 164,
          reasoningTokens: 96,
          cacheReadInputTokens: 256,
        },
      ],
      [2, 1, { inputTokens: 100, outputTokens: 20 }],
    ]);
    expect(loop.rounds[0].steps.map(s => [s.name, s.llm])).toEqual([
      ['callModel', 'llm'],
      ['read_issue', 'tool'],
      ['read_issue', 'tool'],
      ['search', 'tool'],
    ]);
  });

  it('reads the record of a failed call from the failure details', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const id = h.activity('callModel', 'llm/c', {
      failure: {
        message: 'wrapped',
        cause: {
          message: 'rate limited',
          applicationFailureInfo: {
            details: payloads(
              record(
                { 'gen_ai.request.model': 'm', 'error.type': 'RateLimit' },
                { error: { type: 'RateLimit', message: 'rate limited' } },
              ),
            ),
          },
        },
      },
    });
    const graph = buildWorkflowGraph(h.events, {
      ...options,
      status: 'Failed',
    });
    expect(graph.nodes.find(n => n.id === `activity-${id}`)!.llm).toMatchObject(
      {
        record: 'available',
        model: 'm',
        error: 'RateLimit',
      },
    );
  });

  it('shows an open call and a tool without its call', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    const tool = h.activity('search', 'tool/nowhere/1', { result: 1 });
    const open = h.activity('callModel', 'llm/c', { open: true });
    const graph = buildWorkflowGraph(h.events, {
      ...options,
      status: 'Running',
    });
    expect(graph.nodes.find(n => n.id === `activity-${tool}`)!.tool).toEqual({
      call: 'nowhere',
      toolCallId: '1',
    });
    expect(graph.nodes.find(n => n.id === `activity-${open}`)!.llm).toEqual({
      call: 'c',
      framework: 'temporal-workflow-kit',
      record: 'pending',
      toolCalls: [],
      reasoning: false,
    });
  });

  it('leaves workflows without markers as they are', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('callModel', 'callModel-1', {
      result: record(fixture.records[0].attributes),
    });
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
    expect(graph.loops).toBeUndefined();
  });
});

describe('LLM steps in the steps response', () => {
  it('adds summaries and tool links', () => {
    const h = agentHistory();
    const steps = toWorkflowSteps(h.events, false);
    const byId = (id: number) =>
      steps.activities.find(a => a.scheduledEventId === String(id))!;
    expect(byId(h.prepare).llm).toBeUndefined();
    expect(byId(h.first).llm).toMatchObject({
      model: 'deepseek-reasoner-0528',
      toolCalls: [
        { id: 'call_b1', nodeId: `activity-${h.t1}` },
        { id: 'call_b2', nodeId: `activity-${h.t2}` },
      ],
    });
    expect(byId(h.t1).tool).toMatchObject({ llmNodeId: `activity-${h.first}` });
  });
});
