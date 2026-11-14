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

// Written by scripts/event-group-graphs.mjs from test-fixtures/llm-integrations/vercel-ai-sdk-agent.json:
// an agent of the official Vercel AI SDK integration: two rounds, each a group with model calls and tool calls. Run `yarn sync:test-graphs` to write it again.

import type { WorkflowGraphResponse } from '../common';

export const agentGraph: WorkflowGraphResponse = {
  status: 'Completed',
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      input: { encoding: 'json/plain', value: { rounds: 2 } },
      details: {
        workflowType: 'aiSdkAgent',
        taskQueue: 'ai-sdk-agents',
        attempt: 1,
      },
      events: [
        {
          eventId: '1',
          eventType: 'WorkflowExecutionStarted',
          eventTime: '2026-11-14T06:34:18.904Z',
        },
      ],
      startTime: '2026-11-14T06:34:18.904Z',
      endTime: '2026-11-14T06:34:18.904Z',
    },
    {
      id: 'workflowTask-2',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:18.904Z',
      attempt: 1,
      events: [
        {
          eventId: '2',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:18.904Z',
        },
        {
          eventId: '3',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:18.917Z',
        },
        {
          eventId: '4',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:18.939Z',
        },
      ],
      endTime: '2026-11-14T06:34:18.939Z',
    },
    {
      kind: 'activity',
      name: 'docs-listTools',
      stepId: '1',
      status: 'Completed',
      startTime: '2026-11-14T06:34:18.939Z',
      input: { encoding: 'json/plain', value: {} },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-5',
      events: [
        {
          eventId: '5',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:18.939Z',
        },
        {
          eventId: '6',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:18.939Z',
        },
        {
          eventId: '7',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:18.951Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:18.939Z',
        },
      ],
      endTime: '2026-11-14T06:34:18.951Z',
      result: {
        encoding: 'json/plain',
        value: {
          read_file: {
            description: '讀一個文件檔',
            inputSchema: {
              jsonSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
                additionalProperties: false,
              },
            },
          },
        },
      },
    },
    {
      id: 'workflowTask-8',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:18.951Z',
      attempt: 1,
      events: [
        {
          eventId: '8',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:18.951Z',
        },
        {
          eventId: '9',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:18.962Z',
        },
        {
          eventId: '10',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:18.981Z',
        },
      ],
      endTime: '2026-11-14T06:34:18.981Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '2',
      status: 'Completed',
      startTime: '2026-11-14T06:34:18.981Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 1 輪：Event Groups 是什麼？' },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-11',
      events: [
        {
          eventId: '11',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:18.981Z',
        },
        {
          eventId: '12',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:18.981Z',
        },
        {
          eventId: '13',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:18.991Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:18.981Z',
        },
      ],
      endTime: '2026-11-14T06:34:18.991Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            { type: 'reasoning', text: '第 1 輪：先查文件。' },
            {
              type: 'tool-call',
              toolCallId: 'call_r1_search',
              toolName: 'search_docs',
              input: '{"query":"event groups round 1"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 121, noCache: 101, cacheRead: 20 },
            outputTokens: { total: 30, text: 18, reasoning: 12 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_1_0',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:18.990Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [
          {
            name: 'search_docs',
            id: 'call_r1_search',
            nodeId: 'activity-17',
            status: 'Completed',
            inferred: true,
          },
        ],
        reasoning: true,
        durationMs: 10,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 121,
          outputTokens: 30,
          reasoningTokens: 12,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['tool-calls'],
      },
    },
    {
      id: 'workflowTask-14',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:18.991Z',
      attempt: 1,
      events: [
        {
          eventId: '14',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:18.991Z',
        },
        {
          eventId: '15',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:18.999Z',
        },
        {
          eventId: '16',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:19.014Z',
        },
      ],
      endTime: '2026-11-14T06:34:19.014Z',
    },
    {
      kind: 'activity',
      name: 'searchDocs',
      stepId: '3',
      status: 'Completed',
      startTime: '2026-11-14T06:34:19.014Z',
      input: {
        encoding: 'json/plain',
        value: { query: 'event groups round 1' },
      },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-17',
      events: [
        {
          eventId: '17',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:19.014Z',
        },
        {
          eventId: '18',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:19.014Z',
        },
        {
          eventId: '19',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:19.023Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:19.014Z',
        },
      ],
      endTime: '2026-11-14T06:34:19.023Z',
      result: {
        encoding: 'json/plain',
        value: {
          hits: [
            'docs/event-groups-round-1.md',
            'docs/temporal-primer/README.md',
          ],
        },
      },
      tool: {
        toolCallId: 'call_r1_search',
        llmNodeId: 'activity-11',
        name: 'search_docs',
        inferred: true,
      },
    },
    {
      id: 'workflowTask-20',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:19.023Z',
      attempt: 1,
      events: [
        {
          eventId: '20',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:19.023Z',
        },
        {
          eventId: '21',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:19.030Z',
        },
        {
          eventId: '22',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:19.045Z',
        },
      ],
      endTime: '2026-11-14T06:34:19.045Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '4',
      status: 'Completed',
      startTime: '2026-11-14T06:34:19.045Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 1 輪：Event Groups 是什麼？' },
                ],
              },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 1 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 1' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-1.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-23',
      events: [
        {
          eventId: '23',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:19.045Z',
        },
        {
          eventId: '24',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:19.045Z',
        },
        {
          eventId: '25',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:19.054Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:19.045Z',
        },
      ],
      endTime: '2026-11-14T06:34:19.054Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_r1_read',
              toolName: 'read_file',
              input: '{"path":"docs/temporal-primer/README.md"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 201, noCache: 181, cacheRead: 20 },
            outputTokens: { total: 18, text: 18, reasoning: 0 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_1_1',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:19.053Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [
          {
            name: 'read_file',
            id: 'call_r1_read',
            nodeId: 'activity-29',
            status: 'Completed',
          },
        ],
        reasoning: false,
        durationMs: 9,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 201,
          outputTokens: 18,
          reasoningTokens: 0,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['tool-calls'],
      },
    },
    {
      id: 'workflowTask-26',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:19.054Z',
      attempt: 1,
      events: [
        {
          eventId: '26',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:19.054Z',
        },
        {
          eventId: '27',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:19.062Z',
        },
        {
          eventId: '28',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:19.075Z',
        },
      ],
      endTime: '2026-11-14T06:34:19.075Z',
    },
    {
      kind: 'activity',
      name: 'docs-callTool',
      stepId: '5',
      status: 'Completed',
      startTime: '2026-11-14T06:34:19.075Z',
      input: {
        encoding: 'json/plain',
        value: {
          name: 'read_file',
          input: { path: 'docs/temporal-primer/README.md' },
          options: {
            toolCallId: 'call_r1_read',
            messages: [
              { role: 'user', content: '第 1 輪：Event Groups 是什麼？' },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 1 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 1' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-1.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-29',
      events: [
        {
          eventId: '29',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:19.075Z',
        },
        {
          eventId: '30',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.094Z',
        },
        {
          eventId: '31',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.101Z',
        },
      ],
      summary: 'read_file',
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 2,
      attempts: [
        {
          attempt: 1,
          status: 'Failed',
          failure: {
            message: '暫時讀不到 docs/temporal-primer/README.md',
            kind: 'ApplicationFailure',
            type: 'Error',
            source: 'TypeScriptSDK',
            stackTrace: 'Error: 暫時讀不到 docs/temporal-primer/README.md',
            nonRetryable: false,
          },
        },
        {
          attempt: 2,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.094Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.101Z',
      result: {
        encoding: 'json/plain',
        value: {
          path: 'docs/temporal-primer/README.md',
          content:
            '# docs/temporal-primer/README.md\n\nEvent Groups 是實驗性功能。',
        },
      },
      tool: {
        toolCallId: 'call_r1_read',
        llmNodeId: 'activity-23',
        name: 'read_file',
      },
    },
    {
      id: 'workflowTask-32',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.101Z',
      attempt: 1,
      events: [
        {
          eventId: '32',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.101Z',
        },
        {
          eventId: '33',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.108Z',
        },
        {
          eventId: '34',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.122Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.122Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '6',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.122Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 1 輪：Event Groups 是什麼？' },
                ],
              },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 1 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 1' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r1_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-1.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r1_read',
                    toolName: 'read_file',
                    input: { path: 'docs/temporal-primer/README.md' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r1_read',
                    toolName: 'read_file',
                    output: {
                      type: 'json',
                      value: {
                        path: 'docs/temporal-primer/README.md',
                        content:
                          '# docs/temporal-primer/README.md\n\nEvent Groups 是實驗性功能。',
                      },
                    },
                  },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-35',
      events: [
        {
          eventId: '35',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.122Z',
        },
        {
          eventId: '36',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.122Z',
        },
        {
          eventId: '37',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.130Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:1'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.122Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.130Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            {
              type: 'text',
              text: '第 1 輪的回答：Event Groups 可以把一輪的步驟收在一起。',
            },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 321, noCache: 301, cacheRead: 20 },
            outputTokens: { total: 42, text: 42, reasoning: 0 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_1_2',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:20.129Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [],
        reasoning: false,
        durationMs: 8,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 321,
          outputTokens: 42,
          reasoningTokens: 0,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['stop'],
      },
    },
    {
      id: 'workflowTask-38',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.130Z',
      attempt: 1,
      events: [
        {
          eventId: '38',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.130Z',
        },
        {
          eventId: '39',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.137Z',
        },
        {
          eventId: '40',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.150Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.150Z',
    },
    {
      kind: 'activity',
      name: 'docs-listTools',
      stepId: '7',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.150Z',
      input: { encoding: 'json/plain', value: {} },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-41',
      events: [
        {
          eventId: '41',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.150Z',
        },
        {
          eventId: '42',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.150Z',
        },
        {
          eventId: '43',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.158Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.150Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.158Z',
      result: {
        encoding: 'json/plain',
        value: {
          read_file: {
            description: '讀一個文件檔',
            inputSchema: {
              jsonSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
                additionalProperties: false,
              },
            },
          },
        },
      },
    },
    {
      id: 'workflowTask-44',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.158Z',
      attempt: 1,
      events: [
        {
          eventId: '44',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.158Z',
        },
        {
          eventId: '45',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.165Z',
        },
        {
          eventId: '46',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.179Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.179Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '8',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.179Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 2 輪：Event Groups 是什麼？' },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-47',
      events: [
        {
          eventId: '47',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.179Z',
        },
        {
          eventId: '48',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.179Z',
        },
        {
          eventId: '49',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.187Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.179Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.187Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            { type: 'reasoning', text: '第 2 輪：先查文件。' },
            {
              type: 'tool-call',
              toolCallId: 'call_r2_search',
              toolName: 'search_docs',
              input: '{"query":"event groups round 2"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 122, noCache: 102, cacheRead: 20 },
            outputTokens: { total: 30, text: 18, reasoning: 12 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_2_0',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:20.186Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [
          {
            name: 'search_docs',
            id: 'call_r2_search',
            nodeId: 'activity-53',
            status: 'Completed',
            inferred: true,
          },
        ],
        reasoning: true,
        durationMs: 8,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 122,
          outputTokens: 30,
          reasoningTokens: 12,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['tool-calls'],
      },
    },
    {
      id: 'workflowTask-50',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.187Z',
      attempt: 1,
      events: [
        {
          eventId: '50',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.187Z',
        },
        {
          eventId: '51',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.194Z',
        },
        {
          eventId: '52',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.207Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.207Z',
    },
    {
      kind: 'activity',
      name: 'searchDocs',
      stepId: '9',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.207Z',
      input: {
        encoding: 'json/plain',
        value: { query: 'event groups round 2' },
      },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-53',
      events: [
        {
          eventId: '53',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.207Z',
        },
        {
          eventId: '54',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.207Z',
        },
        {
          eventId: '55',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.215Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.207Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.215Z',
      result: {
        encoding: 'json/plain',
        value: {
          hits: [
            'docs/event-groups-round-2.md',
            'docs/temporal-primer/README.md',
          ],
        },
      },
      tool: {
        toolCallId: 'call_r2_search',
        llmNodeId: 'activity-47',
        name: 'search_docs',
        inferred: true,
      },
    },
    {
      id: 'workflowTask-56',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.215Z',
      attempt: 1,
      events: [
        {
          eventId: '56',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.215Z',
        },
        {
          eventId: '57',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.222Z',
        },
        {
          eventId: '58',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.238Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.238Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '10',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.238Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 2 輪：Event Groups 是什麼？' },
                ],
              },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 2 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 2' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-2.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-59',
      events: [
        {
          eventId: '59',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.238Z',
        },
        {
          eventId: '60',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:20.238Z',
        },
        {
          eventId: '61',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:20.246Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:20.238Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.246Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_r2_read',
              toolName: 'read_file',
              input: '{"path":"docs/temporal-primer/README.md"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: {
            inputTokens: { total: 202, noCache: 182, cacheRead: 20 },
            outputTokens: { total: 18, text: 18, reasoning: 0 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_2_1',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:20.246Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [
          {
            name: 'read_file',
            id: 'call_r2_read',
            nodeId: 'activity-65',
            status: 'Completed',
          },
        ],
        reasoning: false,
        durationMs: 8,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 202,
          outputTokens: 18,
          reasoningTokens: 0,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['tool-calls'],
      },
    },
    {
      id: 'workflowTask-62',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:20.246Z',
      attempt: 1,
      events: [
        {
          eventId: '62',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:20.246Z',
        },
        {
          eventId: '63',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:20.254Z',
        },
        {
          eventId: '64',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:20.268Z',
        },
      ],
      endTime: '2026-11-14T06:34:20.268Z',
    },
    {
      kind: 'activity',
      name: 'docs-callTool',
      stepId: '11',
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.268Z',
      input: {
        encoding: 'json/plain',
        value: {
          name: 'read_file',
          input: { path: 'docs/temporal-primer/README.md' },
          options: {
            toolCallId: 'call_r2_read',
            messages: [
              { role: 'user', content: '第 2 輪：Event Groups 是什麼？' },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 2 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 2' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-2.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      maximumAttempts: 3,
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-65',
      events: [
        {
          eventId: '65',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:20.268Z',
        },
        {
          eventId: '66',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:21.280Z',
        },
        {
          eventId: '67',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:21.287Z',
        },
      ],
      summary: 'read_file',
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 2,
      attempts: [
        {
          attempt: 1,
          status: 'Failed',
          failure: {
            message: '暫時讀不到 docs/temporal-primer/README.md',
            kind: 'ApplicationFailure',
            type: 'Error',
            source: 'TypeScriptSDK',
            stackTrace: 'Error: 暫時讀不到 docs/temporal-primer/README.md',
            nonRetryable: false,
          },
        },
        {
          attempt: 2,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:21.280Z',
        },
      ],
      endTime: '2026-11-14T06:34:21.287Z',
      result: {
        encoding: 'json/plain',
        value: {
          path: 'docs/temporal-primer/README.md',
          content:
            '# docs/temporal-primer/README.md\n\nEvent Groups 是實驗性功能。',
        },
      },
      tool: {
        toolCallId: 'call_r2_read',
        llmNodeId: 'activity-59',
        name: 'read_file',
      },
    },
    {
      id: 'workflowTask-68',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:21.287Z',
      attempt: 1,
      events: [
        {
          eventId: '68',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:21.287Z',
        },
        {
          eventId: '69',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:21.294Z',
        },
        {
          eventId: '70',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:21.312Z',
        },
      ],
      endTime: '2026-11-14T06:34:21.312Z',
    },
    {
      kind: 'activity',
      name: 'invokeModel',
      stepId: '12',
      status: 'Completed',
      startTime: '2026-11-14T06:34:21.312Z',
      input: {
        encoding: 'json/plain',
        value: {
          modelId: 'fake-model',
          options: {
            tools: [
              {
                type: 'function',
                name: 'search_docs',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
                description: '搜尋文件',
              },
              {
                type: 'function',
                name: 'read_file',
                inputSchema: {
                  type: 'object',
                  properties: { path: { type: 'string' } },
                  required: ['path'],
                  additionalProperties: false,
                },
                description: '讀一個文件檔',
              },
            ],
            toolChoice: { type: 'auto' },
            prompt: [
              {
                role: 'system',
                content: '你是平台工程助理。先用工具查資料再回答。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '第 2 輪：Event Groups 是什麼？' },
                ],
              },
              {
                role: 'assistant',
                content: [
                  { type: 'reasoning', text: '第 2 輪：先查文件。' },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    input: { query: 'event groups round 2' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r2_search',
                    toolName: 'search_docs',
                    output: {
                      type: 'json',
                      value: {
                        hits: [
                          'docs/event-groups-round-2.md',
                          'docs/temporal-primer/README.md',
                        ],
                      },
                    },
                  },
                ],
              },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'call_r2_read',
                    toolName: 'read_file',
                    input: { path: 'docs/temporal-primer/README.md' },
                  },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_r2_read',
                    toolName: 'read_file',
                    output: {
                      type: 'json',
                      value: {
                        path: 'docs/temporal-primer/README.md',
                        content:
                          '# docs/temporal-primer/README.md\n\nEvent Groups 是實驗性功能。',
                      },
                    },
                  },
                ],
              },
            ],
            headers: { 'user-agent': 'ai/7.0.159' },
          },
        },
      },
      details: { taskQueue: 'ai-sdk-agents' },
      id: 'activity-71',
      events: [
        {
          eventId: '71',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T06:34:21.312Z',
        },
        {
          eventId: '72',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T06:34:21.312Z',
        },
        {
          eventId: '73',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T06:34:21.320Z',
        },
      ],
      groups: ['label:loop:agent', 'label:loop:agent:2'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T06:34:21.312Z',
        },
      ],
      endTime: '2026-11-14T06:34:21.320Z',
      result: {
        encoding: 'json/plain',
        value: {
          content: [
            {
              type: 'text',
              text: '第 2 輪的回答：Event Groups 可以把一輪的步驟收在一起。',
            },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 322, noCache: 302, cacheRead: 20 },
            outputTokens: { total: 42, text: 42, reasoning: 0 },
          },
          warnings: [],
          response: {
            id: 'resp_aisdk_2_2',
            modelId: 'fake-model-2026-11',
            timestamp: '2026-11-14T06:34:21.320Z',
          },
        },
      },
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        toolCalls: [],
        reasoning: false,
        durationMs: 8,
        operation: 'chat',
        model: 'fake-model-2026-11',
        usage: {
          inputTokens: 322,
          outputTokens: 42,
          reasoningTokens: 0,
          cacheReadInputTokens: 20,
        },
        finishReasons: ['stop'],
      },
    },
    {
      id: 'workflowTask-74',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T06:34:21.320Z',
      attempt: 1,
      events: [
        {
          eventId: '74',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T06:34:21.320Z',
        },
        {
          eventId: '75',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T06:34:21.328Z',
        },
        {
          eventId: '76',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T06:34:21.341Z',
        },
      ],
      endTime: '2026-11-14T06:34:21.341Z',
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Completed',
      events: [
        {
          eventId: '77',
          eventType: 'WorkflowExecutionCompleted',
          eventTime: '2026-11-14T06:34:21.341Z',
        },
      ],
      startTime: '2026-11-14T06:34:21.341Z',
      endTime: '2026-11-14T06:34:21.341Z',
      result: {
        encoding: 'json/plain',
        value: [
          {
            round: 1,
            text: '第 1 輪的回答：Event Groups 可以把一輪的步驟收在一起。',
            steps: 3,
            usage: {
              inputTokens: 643,
              inputTokenDetails: { noCacheTokens: 583, cacheReadTokens: 60 },
              outputTokens: 90,
              outputTokenDetails: { textTokens: 78, reasoningTokens: 12 },
              totalTokens: 733,
            },
          },
          {
            round: 2,
            text: '第 2 輪的回答：Event Groups 可以把一輪的步驟收在一起。',
            steps: 3,
            usage: {
              inputTokens: 646,
              inputTokenDetails: { noCacheTokens: 586, cacheReadTokens: 60 },
              outputTokens: 90,
              outputTokenDetails: { textTokens: 78, reasoningTokens: 12 },
              totalTokens: 736,
            },
          },
        ],
      },
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    {
      id: 'activity-5->activity-11',
      source: 'activity-5',
      target: 'activity-11',
    },
    {
      id: 'activity-11->activity-17',
      source: 'activity-11',
      target: 'activity-17',
    },
    {
      id: 'activity-17->activity-23',
      source: 'activity-17',
      target: 'activity-23',
    },
    {
      id: 'activity-23->activity-29',
      source: 'activity-23',
      target: 'activity-29',
    },
    {
      id: 'activity-29->activity-35',
      source: 'activity-29',
      target: 'activity-35',
    },
    {
      id: 'activity-35->activity-41',
      source: 'activity-35',
      target: 'activity-41',
    },
    {
      id: 'activity-41->activity-47',
      source: 'activity-41',
      target: 'activity-47',
    },
    {
      id: 'activity-47->activity-53',
      source: 'activity-47',
      target: 'activity-53',
    },
    {
      id: 'activity-53->activity-59',
      source: 'activity-53',
      target: 'activity-59',
    },
    {
      id: 'activity-59->activity-65',
      source: 'activity-59',
      target: 'activity-65',
    },
    {
      id: 'activity-65->activity-71',
      source: 'activity-65',
      target: 'activity-71',
    },
    { id: 'activity-71->end', source: 'activity-71', target: 'end' },
  ],
  completedSteps: 12,
  totalSteps: 12,
  truncated: false,
  payloadsHidden: false,
  eventGroups: [
    {
      key: 'label:loop:agent',
      kind: 'label',
      id: 'loop:agent',
      name: 'Loop agent',
      nodeIds: [
        'activity-5',
        'activity-11',
        'activity-17',
        'activity-23',
        'activity-29',
        'activity-35',
        'activity-41',
        'activity-47',
        'activity-53',
        'activity-59',
        'activity-65',
        'activity-71',
      ],
      children: ['label:loop:agent:1', 'label:loop:agent:2'],
      status: 'Completed',
      startTime: '2026-11-14T06:34:18.939Z',
      endTime: '2026-11-14T06:34:21.320Z',
      usage: {
        inputTokens: 1289,
        outputTokens: 180,
        reasoningTokens: 24,
        cacheReadInputTokens: 120,
      },
      llmCalls: 6,
    },
    {
      key: 'label:loop:agent:1',
      kind: 'label',
      id: 'loop:agent:1',
      name: 'agent · round 1',
      nodeIds: [
        'activity-5',
        'activity-11',
        'activity-17',
        'activity-23',
        'activity-29',
        'activity-35',
      ],
      parent: 'label:loop:agent',
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T06:34:18.939Z',
      endTime: '2026-11-14T06:34:20.130Z',
      usage: {
        inputTokens: 643,
        outputTokens: 90,
        reasoningTokens: 12,
        cacheReadInputTokens: 60,
      },
      llmCalls: 3,
    },
    {
      key: 'label:loop:agent:2',
      kind: 'label',
      id: 'loop:agent:2',
      name: 'agent · round 2',
      nodeIds: [
        'activity-41',
        'activity-47',
        'activity-53',
        'activity-59',
        'activity-65',
        'activity-71',
      ],
      parent: 'label:loop:agent',
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T06:34:20.150Z',
      endTime: '2026-11-14T06:34:21.320Z',
      usage: {
        inputTokens: 646,
        outputTokens: 90,
        reasoningTokens: 12,
        cacheReadInputTokens: 60,
      },
      llmCalls: 3,
    },
  ],
};
