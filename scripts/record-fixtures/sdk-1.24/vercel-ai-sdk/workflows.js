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

const { generateText, stepCountIs, tool } = require('ai');
const { z } = require('zod');
const { createEventGroup, proxyActivities } = require('@temporalio/workflow');
const {
  TemporalMCPClient,
  temporalProvider,
} = require('@temporalio/vercel-ai-sdk/workflow');

const { searchDocs } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

/** SDK 1.24 two-round `generateText` agent with search tool + flaky MCP tool. */
async function aiSdkAgent({ rounds = 2 } = {}) {
  const mcpClient = new TemporalMCPClient({
    name: 'docs',
    activityOptions: {
      startToCloseTimeout: '10 seconds',
      retry: { maximumAttempts: 3, initialInterval: '1 second' },
    },
  });
  const loop = createEventGroup('Loop agent', { id: 'loop:agent' });
  const answers = [];

  await loop.withScope(async () => {
    for (let round = 1; round <= rounds; round += 1) {
      const roundGroup = createEventGroup(`agent · round ${round}`, {
        id: `loop:agent:${round}`,
      });
      await roundGroup.withScope(async () => {
        const mcpTools = await mcpClient.tools();
        const result = await generateText({
          model: temporalProvider.languageModel('fake-model'),
          tools: {
            search_docs: tool({
              description: 'Search docs.',
              inputSchema: z.object({ query: z.string() }),
              execute: async ({ query }) => searchDocs({ query }),
            }),
            ...mcpTools,
          },
          stopWhen: stepCountIs(5),
          prompt: `第 ${round} 輪：Event Groups 是什麼？`,
        });
        answers.push(result.text);
      });
    }
  });
  return answers;
}

module.exports = { aiSdkAgent };
