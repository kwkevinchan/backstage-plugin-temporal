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

/*
 * Fake agent workflows with LLM steps (see agentActivities.js):
 *
 *   agentWorkflow       an agent loop with loop markers: each round calls the
 *                       model, which answers with reasoning and tool calls;
 *                       the tools run as activities (one fails once and is
 *                       retried, one runs as a local activity); after four
 *                       rounds the model writes a long report (stored in S3
 *                       when the worker uses the S3 codec)
 *   mixedAgentWorkflow  ordinary activities, two model calls, two tools in
 *                       parallel and a child workflow, without loop markers
 */
const {
  executeChild,
  proxyActivities,
  proxyLocalActivities,
  workflowInfo,
} = require('@temporalio/workflow');
const { createLoops } = require('@kwkevinchan/temporal-workflow-kit/loop');
const {
  llmCallOptions,
  outputTextOf,
  toolCallOptions,
  toolCallsOf,
} = require('@kwkevinchan/temporal-workflow-kit/llm');

/** Activity of each tool; `glossary` runs as a local activity. */
const TOOL_ACTIVITIES = { search: 'search', read_file: 'readFile' };

const SYSTEM =
  'You are a helpful engineering assistant. Use the tools to look things up before you answer.';

/** The assistant message of a model call, for the next request. */
function assistantMessage(result) {
  const record = result['temporal.llm'];
  const [message] = record.attributes['gen_ai.output.messages'] ?? [];
  const text = (message?.parts ?? [])
    .filter(p => p.type === 'text')
    .map(p => p.content)
    .join('\n');
  const calls = toolCallsOf(result);
  return {
    role: 'assistant',
    content: text || null,
    tool_calls:
      calls.length > 0
        ? calls.map(c => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          }))
        : undefined,
  };
}

/**
 * Runs the tool calls of one model call at the same time: each as an
 * activity with the ID `tool/<call>/<tool call ID>/...`, and the glossary
 * as a local activity whose result carries the tool marker.
 */
async function runTools(call, toolCalls, activityOptions) {
  return Promise.all(
    toolCalls.map(async tc => {
      if (tc.name === 'glossary') {
        const { glossary } = proxyLocalActivities({
          startToCloseTimeout: '10 seconds',
        });
        const marked = await glossary({
          call,
          toolCallId: tc.id,
          args: tc.arguments,
        });
        return { tc, output: marked.value };
      }
      const activity = TOOL_ACTIVITIES[tc.name];
      const options = toolCallOptions(
        call,
        tc.id,
        activityOptions(tc.name, {
          startToCloseTimeout: '10 seconds',
          retry: { initialInterval: '1 second', maximumAttempts: 3 },
        }),
      );
      const output = await proxyActivities(options)[activity](tc.arguments);
      return { tc, output };
    }),
  );
}

/** An agent loop: model call, tools, model call, ... until it answers. */
async function agentWorkflow(request) {
  const loops = createLoops();
  const conversation = request.conversation ?? 'agent';
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Explain ${request.topic} in this project.` },
  ];
  const result = await loops.run(
    'agent',
    { maxIterations: request.maxRounds ?? 6 },
    async round => {
      const call = `r${round.iteration}`;
      const { callModel } = proxyActivities(
        llmCallOptions(
          call,
          round.activityOptions('callModel', {
            startToCloseTimeout: '30 seconds',
          }),
        ),
      );
      const reply = await callModel({
        conversation,
        round: round.iteration,
        seed: request.seed ?? 1,
        topic: request.topic,
        reportSize: request.reportSize,
        messages,
      });
      messages.push(assistantMessage(reply));
      const toolCalls = toolCallsOf(reply);
      if (toolCalls.length === 0) {
        const text = outputTextOf(reply);
        return round.done({
          value: { length: text.length, start: text.slice(0, 120) },
          decision: 'answer',
        });
      }
      const outputs = await runTools(call, toolCalls, (step, options) =>
        round.activityOptions(step, options),
      );
      for (const { tc, output } of outputs) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(output),
        });
      }
      return round.next({
        decision:
          toolCalls.length === 1
            ? '1 tool call'
            : `${toolCalls.length} tool calls`,
      });
    },
  );
  return {
    status: result.status,
    rounds: result.iterations,
    answer: result.value,
  };
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
 * workflow, without loop markers.
 */
async function mixedAgentWorkflow(request) {
  const ticket = await loadTicket(request);
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Ticket ${ticket.ticket}: ${ticket.topic}?` },
  ];
  const plan = await proxyActivities(
    llmCallOptions('plan', { startToCloseTimeout: '30 seconds' }),
  ).callModel({
    conversation: `mixed-${request.ticket}`,
    round: 1,
    seed: 2,
    topic: request.topic,
    plan: 'mixed-plan',
    messages,
  });
  messages.push(assistantMessage(plan));
  const outputs = await runTools(
    'plan',
    toolCallsOf(plan),
    (_step, options) => ({
      ...options,
    }),
  );
  for (const { tc, output } of outputs) {
    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(output),
    });
  }
  const summary = await executeChild(summarizeResultsWorkflow, {
    workflowId: `${workflowInfo().workflowId}-summary`,
    // The entity reference too, so the child shows on the same entity.
    typedSearchAttributes: workflowInfo().typedSearchAttributes,
    args: [{ outputs: outputs.map(o => o.output) }],
  });
  messages.push({ role: 'user', content: `Summary: ${summary.summary}` });
  const final = await proxyActivities(
    llmCallOptions('final', { startToCloseTimeout: '30 seconds' }),
  ).callModel({
    conversation: `mixed-${request.ticket}`,
    round: 2,
    seed: 2,
    topic: request.topic,
    plan: 'mixed-final',
    messages,
  });
  const text = outputTextOf(final);
  await postAnswer({ text });
  return { answer: text };
}

module.exports = {
  agentWorkflow,
  mixedAgentWorkflow,
  summarizeResultsWorkflow,
};
