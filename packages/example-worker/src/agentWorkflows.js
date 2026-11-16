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

/*
 * Fake agent workflows with LLM steps (see agentActivities.js):
 *
 *   agentWorkflow       an agent loop: each round calls the model, which
 *                       answers with reasoning and tool calls; the tools
 *                       run as activities (one fails once and is retried);
 *                       after four rounds the model writes a long report
 *                       (stored in S3 when the worker uses the S3 codec)
 *   mixedAgentWorkflow  ordinary activities, two model calls, two tools in
 *                       parallel and a child workflow
 *
 * Model calls use the activity type and payload shape of
 * `@temporalio/vercel-ai-sdk` (`invokeModel`), so the plugin's built-in
 * adapter shows them. No model is called.
 */
const {
  executeChild,
  proxyActivities,
  workflowInfo,
} = require('@temporalio/workflow');

const SYSTEM =
  'You are a helpful engineering assistant. Use the tools to look things up before you answer.';

function promptFrom(messages) {
  return messages.map(m => ({
    role: m.role === 'tool' ? 'tool' : m.role,
    content: [{ type: 'text', text: m.content ?? '' }],
  }));
}

function assistantFrom(result) {
  const text = (result.content ?? [])
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('\n');
  const calls = (result.content ?? []).filter(p => p.type === 'tool-call');
  return { text, calls };
}

/**
 * Runs the tool calls of one model call at the same time. The plugin
 * infers the tool from the activity name (`read_file` → `readFile`).
 */
async function runTools(toolCalls) {
  return Promise.all(
    toolCalls.map(async tc => {
      const activity = tc.toolName === 'read_file' ? 'readFile' : tc.toolName;
      const options = {
        startToCloseTimeout: '10 seconds',
        retry:
          activity === 'readFile'
            ? { initialInterval: '1 second', maximumAttempts: 3 }
            : undefined,
      };
      const output = await proxyActivities(options)[activity](tc.input);
      return { tc, output };
    }),
  );
}

/** An agent loop: model call, tools, model call, ... until it answers. */
async function agentWorkflow(request) {
  const { invokeModel } = proxyActivities({
    startToCloseTimeout: '30 seconds',
  });
  const conversation = request.conversation ?? 'agent';
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Explain ${request.topic} in this project.` },
  ];
  let answer;
  const maxRounds = request.maxRounds ?? 6;
  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    const result = await invokeModel({
      modelId: 'fake-reasoner-1',
      options: {
        prompt: promptFrom(messages),
        conversation,
        round,
        seed: request.seed ?? 1,
        topic: request.topic,
        reportSize: request.reportSize,
      },
    });
    const { text, calls } = assistantFrom(result);
    messages.push({ role: 'assistant', content: text });
    if (calls.length === 0) {
      answer = { length: text.length, start: text.slice(0, 120) };
      break;
    }
    const outputs = await runTools(calls);
    for (const { tc, output } of outputs) {
      messages.push({
        role: 'tool',
        content: JSON.stringify(output),
        toolCallId: tc.toolCallId,
      });
    }
  }
  return { rounds, answer };
}

const { loadTicket, postAnswer } = proxyActivities({
  startToCloseTimeout: '10 seconds',
});

/** A child workflow of the mixed example: no LLM steps. */
async function summarizeResultsWorkflow(input) {
  const { postAnswer: note } = proxyActivities({
    startToCloseTimeout: '10 seconds',
  });
  await note({ text: JSON.stringify(input.outputs) });
  return { summary: `${input.outputs.length} tool results` };
}

/**
 * Ordinary activities, model calls, two tools in parallel and a child
 * workflow.
 */
async function mixedAgentWorkflow(request) {
  const { invokeModel } = proxyActivities({
    startToCloseTimeout: '30 seconds',
  });
  const ticket = await loadTicket(request);
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Ticket ${ticket.ticket}: ${ticket.topic}?` },
  ];
  const plan = await invokeModel({
    modelId: 'fake-reasoner-1',
    options: {
      prompt: promptFrom(messages),
      conversation: `mixed-${request.ticket}`,
      round: 1,
      seed: 2,
      topic: request.topic,
      plan: 'mixed-plan',
    },
  });
  const planned = assistantFrom(plan);
  messages.push({ role: 'assistant', content: planned.text });
  const outputs = await runTools(planned.calls);
  for (const { output } of outputs) {
    messages.push({
      role: 'tool',
      content: JSON.stringify(output),
    });
  }
  const summary = await executeChild(summarizeResultsWorkflow, {
    workflowId: `${workflowInfo().workflowId}-summary`,
    typedSearchAttributes: workflowInfo().typedSearchAttributes,
    args: [{ outputs: outputs.map(o => o.output) }],
  });
  messages.push({ role: 'user', content: `Summary: ${summary.summary}` });
  const final = await invokeModel({
    modelId: 'fake-reasoner-1',
    options: {
      prompt: promptFrom(messages),
      conversation: `mixed-${request.ticket}`,
      round: 2,
      seed: 2,
      topic: request.topic,
      plan: 'mixed-final',
    },
  });
  const text = assistantFrom(final).text;
  await postAnswer({ text });
  return { answer: text };
}

module.exports = {
  agentWorkflow,
  mixedAgentWorkflow,
  summarizeResultsWorkflow,
};
