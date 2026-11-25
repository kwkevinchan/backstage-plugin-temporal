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

import { Usage } from '@openai/agents-core';

function hasToolResult(input) {
  return (
    Array.isArray(input) &&
    input.some(item => item.type === 'function_call_result')
  );
}

function lastUserText(input) {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item.type === 'message' && item.role === 'user') {
      if (typeof item.content === 'string') return item.content;
      if (Array.isArray(item.content)) {
        return item.content.map(c => c.text ?? '').join(' ');
      }
    }
  }
  return '';
}

function makeUsage({ inputTokens, outputTokens, cached = 0, reasoning = 0 }) {
  return new Usage({
    requests: 1,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokensDetails: cached ? { cached_tokens: cached } : undefined,
    outputTokensDetails: reasoning
      ? { reasoning_tokens: reasoning }
      : undefined,
  });
}

function messageResponse(text, usageArgs, responseId) {
  return {
    usage: makeUsage(usageArgs),
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }],
      },
    ],
    responseId,
  };
}

function createFakeOpenAIModel() {
  return {
    async getResponse(request) {
      const instructions = request.systemInstructions ?? '';
      const input = request.input ?? [];
      const userText = lastUserText(input);
      const round = userText.includes('第 2 輪') ? 2 : 1;

      if (instructions.includes('[scenario:reasoning]')) {
        return {
          usage: makeUsage({
            inputTokens: 150,
            outputTokens: 60,
            cached: 20,
            reasoning: 12,
          }),
          output: [
            {
              type: 'reasoning',
              id: 'rs_1',
              content: [{ type: 'input_text', text: '先整理問題。' }],
              rawContent: [
                { type: 'reasoning_text', text: '完整的思考內容。' },
              ],
            },
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: '有 reasoning 的回答。' }],
            },
          ],
          responseId: 'resp_reasoning_1',
        };
      }

      if (instructions.includes('[scenario:parallel]')) {
        const toolResults = Array.isArray(input)
          ? input.filter(item => item.type === 'function_call_result')
          : [];
        if (toolResults.length === 0) {
          return {
            usage: makeUsage({ inputTokens: 101, outputTokens: 21 }),
            output: [
              {
                type: 'function_call',
                callId: 'call_p_1a',
                name: 'searchDocs',
                arguments: JSON.stringify({ query: 'event groups round 1' }),
                status: 'completed',
              },
              {
                type: 'function_call',
                callId: 'call_p_1b',
                name: 'searchDocs',
                arguments: JSON.stringify({ query: 'event groups round 1' }),
                status: 'completed',
              },
            ],
            responseId: 'resp_oa_p_1',
          };
        }
        if (toolResults.length === 2) {
          return {
            usage: makeUsage({ inputTokens: 202, outputTokens: 22 }),
            output: [
              {
                type: 'function_call',
                callId: 'call_p_2a',
                name: 'searchDocs',
                arguments: JSON.stringify({ query: 'event groups round 1' }),
                status: 'completed',
              },
              {
                type: 'function_call',
                callId: 'call_p_2b',
                name: 'searchDocs',
                arguments: JSON.stringify({ query: 'event groups round 2' }),
                status: 'completed',
              },
            ],
            responseId: 'resp_oa_p_2',
          };
        }
        return messageResponse(
          '平行工具查詢整理完成。',
          { inputTokens: 303, outputTokens: 23 },
          'resp_oa_p_3',
        );
      }

      // Default agent / summary scenario: one searchDocs call, then final answer.
      if (!hasToolResult(input)) {
        return {
          usage: makeUsage({
            inputTokens: round === 1 ? 111 : 112,
            outputTokens: 25,
          }),
          output: [
            {
              type: 'function_call',
              callId: `call_oa_r${round}_search`,
              name: 'searchDocs',
              arguments: JSON.stringify({
                query: `event groups round ${round}`,
              }),
              status: 'completed',
            },
          ],
          responseId: `resp_oa_${round}_0`,
        };
      }
      return messageResponse(
        `第 ${round} 輪的回答：Event Groups 可以把步驟分組。`,
        { inputTokens: round === 1 ? 261 : 262, outputTokens: 40 },
        `resp_oa_${round}_1`,
      );
    },

    async *getStreamedResponse() {
      yield { type: 'response_started' };
      for (const ch of ['串', '流', '的', '回', '答', '。']) {
        yield { type: 'output_text_delta', delta: ch };
      }
      yield {
        type: 'response_done',
        response: {
          id: 'resp_stream_1',
          usage: {
            requests: 1,
            inputTokens: 70,
            outputTokens: 6,
            totalTokens: 76,
            inputTokensDetails: { cached_tokens: 10 },
            outputTokensDetails: { reasoning_tokens: 0 },
          },
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: '串流的回答。' }],
            },
          ],
        },
      };
    },
  };
}

/** Offline ModelProvider for recording OpenAI Agents fixtures without API calls. */
export function createFakeOpenAIModelProvider() {
  const model = createFakeOpenAIModel();
  return {
    async getModel() {
      return model;
    },
  };
}
