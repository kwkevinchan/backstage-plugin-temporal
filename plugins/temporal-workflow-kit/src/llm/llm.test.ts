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
import { parseLoopMarker } from '../loop';
import {
  anthropicMessages,
  createLlmRecord,
  formatLlmActivityId,
  formatToolActivityId,
  llmCallOptions,
  llmRecordOf,
  LlmConverter,
  markToolResult,
  ollamaChat,
  openaiChat,
  outputTextOf,
  parseLlmMarker,
  reasoningOf,
  recordLlmCall,
  toolCallOptions,
  toolCallsOf,
  toolValueOf,
  LLM_SEMCONV_VERSION,
} from '.';

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../test-fixtures/llm-records.json'),
    'utf8',
  ),
);

const converters: Record<string, LlmConverter<any, any>> = {
  openai: openaiChat,
  anthropic: anthropicMessages,
  ollama: ollamaChat,
};

describe('LLM markers', () => {
  it.each(
    (fixture.markers as any[])
      .filter(m => m.loop)
      .map((m: any): [string, any] => [m.text, m.loop]),
  )('reads the loop marker after %s', (text, loop) => {
    expect(parseLoopMarker(text)).toEqual(loop);
  });

  it.each(
    (fixture.markers as any[]).map((m: any): [string, any] => [m.text, m]),
  )('reads %s', (text, example: any) => {
    expect(parseLlmMarker(text as string)).toEqual(example.marker ?? undefined);
  });

  it('writes markers that read back', () => {
    expect(formatLlmActivityId('plan/1', 'loop/agent/3/callModel')).toBe(
      'llm/plan%2F1/loop/agent/3/callModel',
    );
    expect(formatToolActivityId('r2', 'toolu_01')).toBe('tool/r2/toolu_01');
    expect(parseLlmMarker(formatToolActivityId('a b', 'x/y'))).toEqual({
      kind: 'tool',
      call: 'a b',
      toolCallId: 'x/y',
    });
    expect(() => formatLlmActivityId('')).toThrow(TypeError);
    expect(() => formatLlmActivityId('loop')).toThrow(TypeError);
    expect(() => formatToolActivityId('a', '')).toThrow(TypeError);
  });

  it('adds the marker in front of the activity ID of the options', () => {
    expect(
      llmCallOptions('agent-2', {
        startToCloseTimeout: '1 minute',
        activityId: 'loop/agent/2/callModel',
      }),
    ).toEqual({
      startToCloseTimeout: '1 minute',
      activityId: 'llm/agent-2/loop/agent/2/callModel',
    });
    expect(toolCallOptions('agent-2', 'call_1', {}).activityId).toBe(
      'tool/agent-2/call_1',
    );
  });

  it('marks and unwraps tool results', () => {
    const marked = markToolResult({ call: 'c', toolCallId: 'id' }, [1, 2]);
    expect(marked).toEqual({
      'temporal.llm.tool': { call: 'c', toolCallId: 'id' },
      value: [1, 2],
    });
    expect(toolValueOf(marked)).toEqual([1, 2]);
    expect(toolValueOf('plain')).toBe('plain');
  });
});

describe('converters', () => {
  it.each(
    (fixture.records as any[]).map((r: any): [string, any] => [r.name, r]),
  )('converts %s with reasoning and tool calls', (name, example: any) => {
    const convert = converters[name as string];
    expect({
      'gen_ai.provider.name': convert.provider,
      ...convert.request(example.request),
      ...convert.response(example.response),
    }).toEqual(example.attributes);
  });

  it('maps OpenAI images by URL, refusals and legacy function calls', () => {
    const attributes = openaiChat.request({
      model: 'gpt-4.1',
      stop: 'END',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'https://x/y.png' } },
          ],
        },
        {
          role: 'assistant',
          refusal: 'No.',
          function_call: { name: 'f', arguments: 'not json' },
        },
      ],
    });
    expect(attributes['gen_ai.request.stop_sequences']).toEqual(['END']);
    expect(attributes['gen_ai.input.messages']).toEqual([
      {
        role: 'user',
        parts: [{ type: 'uri', modality: 'image', uri: 'https://x/y.png' }],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'openai.refusal', content: 'No.' },
          { type: 'tool_call', name: 'f', arguments: 'not json' },
        ],
      },
    ]);
  });

  it('keeps redacted thinking and server tools of Anthropic', () => {
    const attributes = anthropicMessages.response({
      content: [
        { type: 'redacted_thinking', data: 'xyz' },
        {
          type: 'server_tool_use',
          id: 's1',
          name: 'web_search',
          input: { q: 'a' },
        },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    expect(attributes['gen_ai.usage.input_tokens']).toBe(5);
    expect(
      attributes['gen_ai.output.messages']![0].parts.map(p => p.type),
    ).toEqual([
      'anthropic.redacted_thinking',
      'server_tool_call',
      'server_tool_call_response',
    ]);
  });

  it('copes with empty and odd shapes', () => {
    for (const convert of Object.values(converters)) {
      expect(() => convert.request(undefined)).not.toThrow();
      expect(() => convert.response(null)).not.toThrow();
      expect(convert.request({ messages: 'x' })['gen_ai.input.messages']).toBe(
        undefined,
      );
    }
  });
});

describe('recordLlmCall', () => {
  const example = fixture.records[0];
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = Date.parse('2026-11-03T08:00:00.000Z');
  });

  it('records a model call with tools run in the activity', async () => {
    const result = await recordLlmCall({
      request: example.request,
      convert: openaiChat,
      attributes: { 'gen_ai.conversation.id': 'conv-1' },
      now,
      async call(_request, context) {
        clock += 1500;
        const found = await context.runTool(
          { id: 'call_x', name: 'lookup', arguments: { q: 1 } },
          () => {
            clock += 20;
            return { hits: 3 };
          },
        );
        expect(found).toEqual({ hits: 3 });
        await expect(
          context.runTool({ name: 'broken' }, () => {
            throw new TypeError('bad input');
          }),
        ).rejects.toThrow('bad input');
        return example.response;
      },
    });
    const record = llmRecordOf(result)!;
    expect(record).toMatchObject({
      v: 1,
      semconv: LLM_SEMCONV_VERSION,
      startTime: '2026-11-03T08:00:00.000Z',
      durationMs: 1520,
      attributes: {
        ...example.attributes,
        'gen_ai.conversation.id': 'conv-1',
      },
    });
    expect(record.error).toBeUndefined();
    expect(record.toolExecutions).toEqual([
      {
        'gen_ai.tool.call.id': 'call_x',
        'gen_ai.tool.name': 'lookup',
        'gen_ai.tool.type': 'function',
        'gen_ai.tool.call.arguments': { q: 1 },
        'gen_ai.tool.call.result': { hits: 3 },
        durationMs: 20,
      },
      {
        'gen_ai.tool.name': 'broken',
        'gen_ai.tool.type': 'function',
        error: { type: 'TypeError', message: 'bad input' },
        'error.type': 'TypeError',
        durationMs: 0,
      },
    ]);
    expect(result.value).toBe(example.response);
    expect(toolCallsOf(result).map(c => c.id)).toEqual(['call_b1', 'call_b2']);
    expect(outputTextOf(result)).toBe('Reading both issues.');
    expect(reasoningOf(record)).toBe(
      'Two issues match; I should read each one.',
    );
  });

  it('leaves the value out when asked to', async () => {
    const result = await recordLlmCall({
      request: example.request,
      convert: openaiChat,
      value: () => undefined,
      call: async () => example.response,
    });
    expect(Object.keys(result)).toEqual(['temporal.llm']);
  });

  it('records a failed call on the error', async () => {
    const error = Object.assign(new Error('rate limited'), {
      type: 'RateLimit',
    });
    const thrown = await recordLlmCall({
      request: example.request,
      convert: openaiChat,
      now,
      call: async () => {
        throw error;
      },
    }).catch(e => e);
    expect(thrown).toBe(error);
    expect(thrown.llm).toMatchObject({
      error: { type: 'RateLimit', message: 'rate limited' },
      attributes: {
        'gen_ai.request.model': 'deepseek-reasoner',
        'error.type': 'RateLimit',
      },
    });
    expect(thrown.llm.attributes['gen_ai.output.messages']).toBeUndefined();
  });

  it('throws what onError returns', async () => {
    const replaced = new Error('wrapped');
    const onError = jest.fn(() => replaced);
    await expect(
      recordLlmCall({
        request: {},
        call: async () => {
          // Not an Error on purpose.
          // eslint-disable-next-line no-throw-literal
          throw 'plain';
        },
        onError,
      }),
    ).rejects.toBe(replaced);
    expect(onError).toHaveBeenCalledWith('plain', {
      'temporal.llm': expect.objectContaining({
        error: { message: 'plain' },
      }),
    });
  });

  it('builds records by hand', () => {
    expect(
      createLlmRecord(
        { 'gen_ai.request.model': 'm', 'gen_ai.usage.input_tokens': undefined },
        { durationMs: 5 },
      ),
    ).toEqual({
      v: 1,
      semconv: LLM_SEMCONV_VERSION,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'm',
      },
      durationMs: 5,
    });
    expect(toolCallsOf(undefined)).toEqual([]);
    expect(llmRecordOf('x')).toBeUndefined();
  });
});
