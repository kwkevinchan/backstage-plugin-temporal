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

function countToolResults(prompt) {
  let count = 0;
  for (const msg of prompt ?? []) {
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-result') count += 1;
    }
  }
  return count;
}

function roundOfPrompt(prompt) {
  for (const msg of prompt ?? []) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part.text === 'string' && part.text.includes('第 2 輪')) {
          return 2;
        }
      }
    }
  }
  return 1;
}

function usage({ inputTotal, cacheRead = 0, outputText, outputReasoning = 0 }) {
  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal - cacheRead,
      cacheRead,
    },
    outputTokens: {
      total: outputText + outputReasoning,
      text: outputText,
      reasoning: outputReasoning,
    },
  };
}

function generateResponse({ content, finishReason, usageArgs, id }) {
  return {
    content,
    finishReason: finishReason ?? {
      unified: content.some(c => c.type === 'tool-call')
        ? 'tool-calls'
        : 'stop',
      raw: content.some(c => c.type === 'tool-call') ? 'tool_calls' : 'stop',
    },
    usage: usage(usageArgs),
    warnings: [],
    response: {
      id,
      timestamp: new Date(0),
      modelId: 'fake-model-2026-11',
    },
  };
}

/**
 * Offline LanguageModelV4 / ProviderV4 implementation for recording Vercel AI
 * SDK fixtures without contacting an external model API.
 */
export function createFakeVercelModelProvider() {
  return {
    specificationVersion: 'v4',
    languageModel(modelId) {
      return {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId,
        supportedUrls: {},
        async doGenerate(options) {
          const prompt = options.prompt ?? [];
          const toolResults = countToolResults(prompt);
          const round = roundOfPrompt(prompt);
          const isParallel = modelId === 'fake-parallel';

          if (isParallel) {
            if (toolResults === 0) {
              return generateResponse({
                id: 'resp_v_p1',
                usageArgs: {
                  inputTotal: 101,
                  cacheRead: 20,
                  outputText: 32,
                  outputReasoning: 9,
                },
                content: [
                  { type: 'reasoning', text: '平行查兩份文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p1_s1',
                    toolName: 'search_docs',
                    input: JSON.stringify({ query: 'event groups' }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p1_s2',
                    toolName: 'search_docs',
                    input: JSON.stringify({ query: 'event groups' }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p1_r1',
                    toolName: 'read_file',
                    input: JSON.stringify({
                      path: 'docs/temporal-primer/README.md',
                    }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p1_r2',
                    toolName: 'read_file',
                    input: JSON.stringify({
                      path: 'docs/temporal-primer/README.md',
                    }),
                  },
                ],
              });
            }
            if (toolResults === 4) {
              return generateResponse({
                id: 'resp_v_p2',
                usageArgs: {
                  inputTotal: 202,
                  cacheRead: 20,
                  outputText: 52,
                },
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p2_s1',
                    toolName: 'search_docs',
                    input: JSON.stringify({ query: 'event groups round 1' }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p2_s2',
                    toolName: 'search_docs',
                    input: JSON.stringify({ query: 'event groups round 2' }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p2_r1',
                    toolName: 'read_file',
                    input: JSON.stringify({
                      path: 'docs/event-groups-round-1.md',
                    }),
                  },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_p2_r2',
                    toolName: 'read_file',
                    input: JSON.stringify({
                      path: 'docs/event-groups-round-2.md',
                    }),
                  },
                ],
              });
            }
            return generateResponse({
              id: 'resp_v_p3',
              usageArgs: { inputTotal: 303, cacheRead: 20, outputText: 13 },
              content: [{ type: 'text', text: '平行工具查詢完成。' }],
            });
          }

          // Agent / summary / codec scenario:
          // call 1 -> search_docs; call 2 -> read_file; call 3 -> final answer.
          if (toolResults === 0) {
            const firstInputs = round === 1 ? 121 : 122;
            return generateResponse({
              id: `resp_r${round}_1`,
              usageArgs: {
                inputTotal: firstInputs,
                cacheRead: 20,
                outputText: 18,
                outputReasoning: 12,
              },
              content: [
                {
                  type: 'reasoning',
                  text: `第 ${round} 輪：先查文件。`,
                },
                {
                  type: 'tool-call',
                  toolCallId: `call_r${round}_search`,
                  toolName: 'search_docs',
                  input: JSON.stringify({
                    query: `event groups round ${round}`,
                  }),
                },
              ],
            });
          }
          if (toolResults === 1) {
            const secondInputs = round === 1 ? 201 : 202;
            const docPath =
              modelId === 'fake-flaky'
                ? 'docs/flaky-1.md'
                : 'docs/temporal-primer/README.md';
            return generateResponse({
              id: `resp_r${round}_2`,
              usageArgs: {
                inputTotal: secondInputs,
                cacheRead: 20,
                outputText: 18,
              },
              content: [
                {
                  type: 'tool-call',
                  toolCallId: `call_r${round}_read`,
                  toolName: 'read_file',
                  input: JSON.stringify({ path: docPath }),
                },
              ],
            });
          }
          const finalInputs = round === 1 ? 321 : 322;
          return generateResponse({
            id: `resp_r${round}_3`,
            usageArgs: {
              inputTotal: finalInputs,
              cacheRead: 20,
              outputText: 42,
            },
            content: [
              {
                type: 'text',
                text: `第 ${round} 輪的回答：Event Groups 可以把一輪的步驟收在一起。`,
              },
            ],
          });
        },

        async doStream() {
          const parts = [
            { type: 'stream-start', warnings: [] },
            {
              type: 'response-metadata',
              id: 'resp_stream_1',
              modelId,
              timestamp: new Date(0),
            },
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: '先想一下。' },
            { type: 'reasoning-end', id: 'r1' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: '串流回答：' },
            { type: 'text-delta', id: 't1', delta: 'Event Groups ' },
            { type: 'text-delta', id: 't1', delta: '可以分組。' },
            { type: 'text-end', id: 't1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: usage({
                inputTotal: 77,
                cacheRead: 20,
                outputText: 17,
                outputReasoning: 5,
              }),
            },
          ];
          const stream = new ReadableStream({
            async start(controller) {
              for (const part of parts) {
                controller.enqueue(part);
                await new Promise(r => setTimeout(r, 15));
              }
              controller.close();
            },
          });
          return { stream };
        },
      };
    },
  };
}

/**
 * In-process MCP client factory (`docs`) with `read_file`. With
 * `failFirstCall`, the first `read_file` call for each tool call ID and path
 * fails once when the ID starts with `call_r`, so Temporal's activity retry
 * records an attempt failure with a stack trace.
 */
export function createFakeMcpFactories({ z, failFirstCall = true }) {
  const failedOnce = new Set();
  return {
    docs: async () => ({
      async tools() {
        return {
          read_file: {
            description: '讀一個文件檔',
            inputSchema: z.object({ path: z.string() }),
            async execute({ path }, options) {
              const callId = String(options?.toolCallId ?? '');
              const callKey = `${callId}:${path}`;
              if (
                failFirstCall &&
                callId.startsWith('call_r') &&
                !failedOnce.has(callKey)
              ) {
                failedOnce.add(callKey);
                throw new Error(`暫時讀不到 ${path}`);
              }
              return {
                path,
                content: `# ${path}\n\nEvent Groups 是實驗性功能。`,
              };
            },
          },
        };
      },
      async close() {},
    }),
  };
}
