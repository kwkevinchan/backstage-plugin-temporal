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

const { generateText, stepCountIs, streamText, tool } = require('ai');
const { z } = require('zod');
const { createEventGroup, proxyActivities } = require('@temporalio/workflow');
const {
  TemporalMCPClient,
  TemporalProvider,
} = require('@temporalio/vercel-ai-sdk/workflow');
const { WorkflowStream } = require('@temporalio/workflow-streams/workflow');

const { searchDocs } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

function buildTools(mcpTools) {
  return {
    search_docs: tool({
      description: 'Search docs.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchDocs({ query }),
    }),
    ...mcpTools,
  };
}

/** Parallel tools scenario (both identical and distinct parallel tool args). */
async function aiSdkParallel() {
  const provider = new TemporalProvider();
  const mcpClient = new TemporalMCPClient({
    name: 'docs',
    activityOptions: {
      startToCloseTimeout: '10 seconds',
      retry: { maximumAttempts: 3, initialInterval: '1 second' },
    },
  });
  const mcpTools = await mcpClient.tools();
  const res = await generateText({
    model: provider.languageModel('fake-parallel'),
    tools: buildTools(mcpTools),
    stopWhen: stepCountIs(5),
    prompt: '請同時搜尋並讀取兩份文件。',
  });
  return res.text;
}

/** Streaming text scenario using WorkflowStream and `streamingTopic`. */
async function aiSdkStream() {
  new WorkflowStream();
  const provider = new TemporalProvider({
    languageModel: {
      summary: 'streamed call',
      streamingTopic: 'llm-1',
      streamingBatchInterval: '20 milliseconds',
    },
  });
  const result = streamText({
    model: provider.languageModel('fake-model'),
    prompt: '用串流回答 Event Groups。',
  });
  return await result.text;
}

/** Activity summary (`languageModel.summary: 'plan call'`) or single-round agent. */
async function aiSdkSummary({ summary, encrypted = false } = {}) {
  const provider = new TemporalProvider(
    summary ? { languageModel: { summary } } : undefined,
  );
  const mcpClient = new TemporalMCPClient({
    name: 'docs',
    activityOptions: {
      startToCloseTimeout: '10 seconds',
      retry: { maximumAttempts: 3, initialInterval: '1 second' },
    },
  });
  const group = createEventGroup('loop:agent', { label: 'Loop agent' });
  return await group.withScope(async () => {
    const r1 = createEventGroup('loop:agent:1', { label: 'agent · round 1' });
    return await r1.withScope(async () => {
      const mcpTools = await mcpClient.tools();
      const res = await generateText({
        model: provider.languageModel(encrypted ? 'fake-model' : 'fake-flaky'),
        tools: buildTools(mcpTools),
        stopWhen: stepCountIs(5),
        prompt: '第 1 輪：Event Groups 是什麼？',
      });
      return res.text;
    });
  });
}

module.exports = {
  aiSdkParallel,
  aiSdkStream,
  aiSdkSummary,
};
