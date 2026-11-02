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
 * Activities of the fake agent examples. No model is called: `callModel`
 * answers like the OpenAI chat completions API, from the round and a seed,
 * so a run always looks the same. It records each call with
 * `recordLlmCall` and the OpenAI converter of
 * `@kwkevinchan/temporal-workflow-kit/llm`, so Backstage shows the input,
 * the reasoning, the output, the tool calls and the tokens.
 */
const { ApplicationFailure, Context } = require('@temporalio/activity');
const {
  markToolResult,
  openaiChat,
  recordLlmCall,
} = require('@kwkevinchan/temporal-workflow-kit/llm');

const MODEL = 'fake-reasoner-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A small random number generator, so a seed gives the same answers. */
function random(seed) {
  let x = (seed * 2654435761) % 4294967296;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the project documentation',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file of the repository',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glossary',
      description: 'Look a term up in the glossary',
      parameters: {
        type: 'object',
        properties: { term: { type: 'string' } },
      },
    },
  },
];

/** About `count` characters of a report, line by line. */
function longReport(topic, count, next) {
  const lines = [`# Report: ${topic}`, ''];
  let size = 0;
  for (let i = 1; size < count; i++) {
    const line = `${i}. Finding ${i} about ${topic}: retry budget ${Math.round(
      next() * 100,
    )}%, latency ${Math.round(next() * 900 + 100)} ms, owner team-${
      1 + Math.floor(next() * 9)
    }.`;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n');
}

/** The answer of the fake model for one round. */
function answer(request) {
  const next = random(request.seed * 100 + request.round);
  const topic = request.topic;
  const id = n => `call_${request.round}${String.fromCharCode(96 + n)}`;
  const toolCall = (n, name, args) => ({
    id: id(n),
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const steps = request.plan ?? 'agent';
  if (steps === 'mixed-plan') {
    return {
      reasoning: `To answer about ${topic} I need the docs and the config at the same time.`,
      content: 'Searching the docs and reading the config.',
      toolCalls: [
        toolCall(1, 'search', { query: `${topic} overview` }),
        toolCall(2, 'read_file', { path: 'config/settings.yaml' }),
      ],
    };
  }
  if (steps === 'mixed-final') {
    return {
      reasoning: 'The child workflow summarized the results; I can answer.',
      content: `${topic}: the settings enable retries with backoff, and the docs explain how to tune them.`,
      toolCalls: [],
    };
  }
  switch (request.round) {
    case 1:
      return {
        reasoning: `The user asks about ${topic}. I do not know this project yet, so I should search its documentation first.`,
        content: '',
        toolCalls: [toolCall(1, 'search', { query: topic })],
      };
    case 2:
      return {
        reasoning:
          'The search found two documents. I should read both, and look up the term "claim check" that the first one uses.',
        content: 'Reading the two documents.',
        toolCalls: [
          toolCall(1, 'read_file', { path: 'docs/flaky.md' }),
          toolCall(2, 'read_file', { path: 'docs/setup.md' }),
          toolCall(3, 'glossary', { term: 'claim check' }),
        ],
      };
    case 3:
      return {
        reasoning:
          'The setup guide mentions a retry policy that I have not seen yet. One more search should settle it.',
        content: '',
        toolCalls: [toolCall(1, 'search', { query: 'retry policy' })],
      };
    default:
      return {
        reasoning: `I have everything I need. I will write the report about ${topic}, with every finding, so it is long.`,
        content: longReport(topic, request.reportSize ?? 4000, next),
        toolCalls: [],
      };
  }
}

const tokens = text => Math.max(1, Math.round(JSON.stringify(text).length / 4));

/**
 * One call of the fake model, recorded with the OpenTelemetry attributes.
 * The request has the OpenAI chat completion shape.
 */
async function callModel(request) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    max_completion_tokens: 4096,
    messages: request.messages,
    tools: TOOLS,
  };
  return recordLlmCall({
    request: body,
    convert: openaiChat,
    attributes: { 'gen_ai.conversation.id': request.conversation },
    // The record has the output; the workflow reads it with toolCallsOf.
    value: () => undefined,
    async call(req, context) {
      // The first round looks up the user's profile inside the activity:
      // a tool that is only in the record.
      if (request.round === 1 && !request.plan) {
        await context.runTool(
          {
            id: 'ctx_profile',
            name: 'user_profile',
            arguments: { user: 'guest' },
          },
          async () => {
            await sleep(80);
            return { language: 'en', role: 'developer' };
          },
        );
      }
      const reply = answer(request);
      await sleep(400 + Math.round(random(request.round)() * 600));
      const reasoningTokens = tokens(reply.reasoning);
      return {
        id: `chatcmpl-${request.conversation}-${request.round}`,
        object: 'chat.completion',
        model: `${MODEL}-2026-11`,
        choices: [
          {
            index: 0,
            finish_reason: reply.toolCalls.length > 0 ? 'tool_calls' : 'stop',
            message: {
              role: 'assistant',
              content: reply.content || null,
              reasoning_content: reply.reasoning,
              tool_calls:
                reply.toolCalls.length > 0 ? reply.toolCalls : undefined,
            },
          },
        ],
        usage: {
          prompt_tokens: tokens(req.messages) + 180,
          completion_tokens:
            tokens(reply.content) + tokens(reply.toolCalls) + reasoningTokens,
          prompt_tokens_details: { cached_tokens: request.round > 1 ? 128 : 0 },
          completion_tokens_details: { reasoning_tokens: reasoningTokens },
        },
      };
    },
  });
}

/** Tool: search the docs. */
async function search(args) {
  await sleep(250);
  if (/retry/.test(args.query)) {
    return {
      hits: [{ path: 'docs/retries.md', snippet: 'Retries use backoff 2.0.' }],
    };
  }
  return {
    hits: [
      { path: 'docs/flaky.md', snippet: `About ${args.query}…` },
      { path: 'docs/setup.md', snippet: 'Set up the worker…' },
    ],
  };
}

/** Tool: read a file. `docs/flaky.md` fails on the first attempt. */
async function readFile(args) {
  await sleep(300);
  const { attempt } = Context.current().info;
  if (args.path === 'docs/flaky.md' && attempt === 1) {
    throw ApplicationFailure.create({
      message: 'File server busy (503), try again',
      type: 'Unavailable',
    });
  }
  return {
    path: args.path,
    text: `Contents of ${args.path}: large payloads go to S3 with a claim check; retries back off.`,
  };
}

/** Tool, run as a local activity: the result carries the tool marker. */
async function glossary(input) {
  await sleep(50);
  return markToolResult(
    { call: input.call, toolCallId: input.toolCallId, name: 'glossary' },
    {
      term: input.args.term,
      meaning:
        'A small reference in the history to data stored elsewhere (S3).',
    },
  );
}

/** Steps of the mixed example that are not LLM steps. */
async function loadTicket(request) {
  await sleep(150);
  return { ticket: request.ticket, topic: request.topic };
}

async function postAnswer(request) {
  await sleep(100);
  return { posted: true, length: request.text.length };
}

module.exports = {
  callModel,
  search,
  readFile,
  glossary,
  loadTicket,
  postAnswer,
};
