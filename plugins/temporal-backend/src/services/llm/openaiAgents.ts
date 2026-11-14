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

import type { JsonObject, JsonValue } from '@backstage/types';
import type {
  WorkflowLlmMessage,
  WorkflowLlmPart,
  WorkflowLlmRecord,
  WorkflowLlmUsage,
} from '../../common';
import type { TemporalLlmAdapter } from '../../node/alpha';
import { int, isObject, Json, str, structured } from './json';

/*
 * The official Temporal integration of the OpenAI Agents SDK
 * (`@temporalio/openai-agents`). A model call is one activity,
 * `invokeModelActivity` (`invokeModelStreamActivity` when streamed), with
 * the input `{ modelName, request }` (`systemInstructions`, `input[]`,
 * `tools`, `modelSettings`). The result is a `ModelResponse` (`usage`,
 * `output[]`, `responseId`); a streamed call returns its stream events,
 * the last of them `response_done` with the response. The token details are
 * a list of records in a response and one record in a stream event. There
 * is no finish reason: a call whose output asks for a function is
 * `tool-calls`, else `stop`. Tools (`activityAsTool`) are activities named
 * after the tool whose input is the arguments, without the call ID.
 *
 * Only the fields read here are typed; the rest is passed through.
 */

const MODEL_CALL_TYPES = new Set([
  'invokeModelActivity',
  'invokeModelStreamActivity',
]);

interface CallInput {
  modelName: string;
  request: {
    systemInstructions?: string;
    input: string | Json[];
    tools?: Json[];
    modelSettings?: Json;
  };
}

interface CallResponse {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    inputTokensDetails?: Json;
    outputTokensDetails?: Json;
  };
  output: Json[];
  responseId?: string;
  id?: string;
}

function isCallInput(value: unknown): value is CallInput {
  return (
    isObject(value) &&
    typeof value.modelName === 'string' &&
    isObject(value.request) &&
    (typeof value.request.input === 'string' ||
      Array.isArray(value.request.input))
  );
}

function isCallResponse(value: unknown): value is CallResponse {
  return (
    isObject(value) &&
    Array.isArray(value.output) &&
    value.output.every(i => isObject(i) && typeof i.type === 'string') &&
    (value.usage === undefined || isObject(value.usage))
  );
}

/**
 * The response of a call: the result itself, or for a stream the response
 * of its `response_done` event.
 */
function responseOf(result: unknown): CallResponse | undefined {
  if (isCallResponse(result)) return result;
  if (!Array.isArray(result)) return undefined;
  if (!result.every(e => isObject(e) && typeof e.type === 'string')) {
    return undefined;
  }
  const done = [...result].reverse().find(e => e.type === 'response_done');
  return isCallResponse(done?.response) ? done.response : undefined;
}

/** A token detail: summed over a list of records, or read from one. */
function detail(details: unknown, key: string): number | undefined {
  const records = Array.isArray(details) ? details : [details];
  let total: number | undefined;
  for (const r of records) {
    const n = isObject(r) ? int(r[key]) : undefined;
    if (n !== undefined) total = (total ?? 0) + n;
  }
  return total;
}

/** Input tokens include cached ones, output tokens reasoning ones. */
function usageOf(response: CallResponse): WorkflowLlmUsage {
  const usage: WorkflowLlmUsage = {};
  const set = (key: keyof WorkflowLlmUsage, n: number | undefined) => {
    if (n !== undefined) usage[key] = n;
  };
  set('inputTokens', int(response.usage?.inputTokens));
  set('outputTokens', int(response.usage?.outputTokens));
  set(
    'reasoningTokens',
    detail(response.usage?.outputTokensDetails, 'reasoning_tokens'),
  );
  set(
    'cacheReadInputTokens',
    detail(response.usage?.inputTokensDetails, 'cached_tokens'),
  );
  return usage;
}

function texts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(c => (isObject(c) ? str(c.text) ?? str(c.refusal) ?? '' : ''))
    .filter(Boolean)
    .join('\n');
}

function contentParts(content: unknown): WorkflowLlmPart[] {
  if (typeof content === 'string') return [{ type: 'text', content }];
  if (!Array.isArray(content)) return [];
  return content.filter(isObject).map((c): WorkflowLlmPart => {
    if (str(c.text) !== undefined || c.type === 'refusal') {
      return { type: 'text', content: String(c.text ?? c.refusal ?? '') };
    }
    return { ...(c as JsonObject), type: String(c.type ?? 'text') };
  });
}

/** One item of the input or the output as a message. */
function toMessage(item: Json): WorkflowLlmMessage {
  switch (item.type) {
    case 'function_call': {
      const part: WorkflowLlmPart = {
        type: 'tool_call',
        name: String(item.name ?? 'tool'),
        arguments: (structured(item.arguments) ?? null) as JsonValue,
      };
      if (str(item.callId)) part.id = item.callId;
      return { role: 'assistant', parts: [part] };
    }
    case 'function_call_result': {
      const output = item.output;
      const part: WorkflowLlmPart = {
        type: 'tool_call_response',
        response: (isObject(output) && typeof output.text === 'string'
          ? structured(output.text)
          : output ?? null) as JsonValue,
      };
      if (str(item.callId)) part.id = item.callId;
      if (str(item.name)) part.name = item.name;
      return { role: 'tool', parts: [part] };
    }
    case 'reasoning': {
      const content = texts(item.rawContent) || texts(item.content);
      return { role: 'assistant', parts: [{ type: 'reasoning', content }] };
    }
    case 'message':
    case undefined:
      return {
        role: str(item.role) ?? 'user',
        parts: contentParts(item.content),
      };
    default:
      return {
        role: 'assistant',
        parts: [{ ...(item as JsonObject), type: String(item.type) }],
      };
  }
}

function readRecord(input: CallInput | undefined, response: CallResponse) {
  const request = input?.request;
  const items =
    typeof request?.input === 'string'
      ? [{ type: 'message', role: 'user', content: request.input }]
      : (request?.input ?? []).filter(isObject);
  const output = response.output.map(toMessage);
  const record: WorkflowLlmRecord = {
    operation: 'chat',
    usage: usageOf(response),
    systemInstructions: str(request?.systemInstructions)
      ? [{ type: 'text', content: request!.systemInstructions! }]
      : [],
    inputMessages: items.map(toMessage),
    // One assistant message with the parts of every output item.
    outputMessages: [
      { role: 'assistant', parts: output.flatMap(m => m.parts) },
    ],
    toolExecutions: [],
    finishReasons: [
      response.output.some(i => i.type === 'function_call')
        ? 'tool-calls'
        : 'stop',
    ],
  };
  if (input) record.requestModel = input.modelName;
  const responseId = str(response.responseId) ?? str(response.id);
  if (responseId) record.responseId = responseId;
  if (Array.isArray(request?.tools)) {
    record.toolDefinitions = request!.tools as JsonValue[];
  }
  if (
    isObject(request?.modelSettings) &&
    Object.keys(request!.modelSettings).length > 0
  ) {
    record.parameters = request!.modelSettings as JsonObject;
  }
  return record;
}

/** The built-in adapter of `@temporalio/openai-agents`. */
export const openaiAgentsAdapter: TemporalLlmAdapter = {
  id: 'openai-agents',
  isModelCall(step) {
    return step.kind === 'activity' && MODEL_CALL_TYPES.has(step.activityType);
  },
  readModelCalls(_step, payloads) {
    const value = payloads.input?.[0];
    const result = payloads.result;
    if (value !== undefined && !isCallInput(value)) return [];
    const input = value as CallInput | undefined;
    const response = result === undefined ? undefined : responseOf(result);
    if (result !== undefined && !response) return [];
    if (input === undefined && result === undefined) return [];
    if (!response) return [{}];
    return [
      {
        record: readRecord(input, response),
        raw: { input: input ?? null, result: result ?? null } as JsonValue,
      },
    ];
  },
};
