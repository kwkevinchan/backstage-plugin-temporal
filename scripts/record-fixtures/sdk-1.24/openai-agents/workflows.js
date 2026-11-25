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

const { Agent } = require('@openai/agents-core');
const { createEventGroup } = require('@temporalio/workflow');
const {
  TemporalOpenAIRunner,
  activityAsTool,
} = require('@temporalio/openai-agents/workflow');
const { WorkflowStream } = require('@temporalio/workflow-streams/workflow');

const searchDocsTool = activityAsTool(
  {
    name: 'searchDocs',
    description: 'Search docs by query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  { startToCloseTimeout: '10 seconds' },
);

async function openAiAgent() {
  const runner = new TemporalOpenAIRunner();
  const agent = new Agent({
    name: 'DocsAgent',
    model: 'fake-model',
    instructions: '[scenario:agent] 你是平台工程助理。先用工具查資料再回答。',
    tools: [searchDocsTool],
  });
  const loop = createEventGroup('Loop agent', { id: 'loop:agent' });
  return await loop.withScope(async () => {
    const r1 = createEventGroup('agent · round 1', { id: 'loop:agent:1' });
    const first = await r1.withScope(() =>
      runner.run(agent, '第 1 輪：Event Groups 是什麼？'),
    );
    const r2 = createEventGroup('agent · round 2', { id: 'loop:agent:2' });
    const second = await r2.withScope(() =>
      runner.run(agent, '第 2 輪：深入說明。'),
    );
    return { first: first.finalOutput, second: second.finalOutput };
  });
}

async function openAiParallel() {
  const runner = new TemporalOpenAIRunner();
  const agent = new Agent({
    name: 'ParallelDocsAgent',
    model: 'fake-model',
    instructions:
      '[scenario:parallel] 你是平台工程助理。可同時呼叫多個 searchDocs。',
    tools: [searchDocsTool],
  });
  const res = await runner.run(agent, '請同時查兩份文件。');
  return res.finalOutput;
}

async function openAiReasoning() {
  const runner = new TemporalOpenAIRunner();
  const agent = new Agent({
    name: 'ReasoningAgent',
    model: 'fake-model',
    instructions: '[scenario:reasoning] 你是平台工程助理。',
  });
  const res = await runner.run(agent, '要 reasoning');
  return res.finalOutput;
}

async function openAiStream() {
  // Hosts `__temporal_workflow_stream_publish` signal / poll update / query handlers.
  new WorkflowStream();
  const runner = new TemporalOpenAIRunner({
    defaultModelParams: {
      streamingTopic: 'openai-stream',
      streamingBatchInterval: '50 milliseconds',
    },
  });
  const agent = new Agent({
    name: 'StreamingAgent',
    model: 'fake-model',
    instructions: '[scenario:stream] 你是平台工程助理。',
  });
  const stream = await runner.run(agent, '用串流回答', { stream: true });
  for await (const _chunk of stream) {
    // Consume stream events until completion.
  }
  await stream.completed;
  return stream.finalOutput;
}

async function openAiSummary() {
  const agent = new Agent({
    name: 'DocsAgent',
    model: 'fake-model',
    instructions: '[scenario:agent] 你是平台工程助理。先用工具查資料再回答。',
    tools: [searchDocsTool],
  });
  const r1 = new TemporalOpenAIRunner({
    defaultModelParams: { summary: 'plan call' },
  });
  const first = await r1.run(agent, '第 1 輪：摘要字串');

  const r2 = new TemporalOpenAIRunner({
    defaultModelParams: {
      summary: {
        provide(targetAgent) {
          return `model call for ${targetAgent?.name ?? 'Agent'} (object)`;
        },
      },
    },
  });
  const second = await r2.run(agent, '第 2 輪：摘要函式');
  return { first: first.finalOutput, second: second.finalOutput };
}

module.exports = {
  openAiAgent,
  openAiParallel,
  openAiReasoning,
  openAiStream,
  openAiSummary,
};
