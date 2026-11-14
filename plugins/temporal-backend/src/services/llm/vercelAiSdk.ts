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
 * The official Temporal integration of the Vercel AI SDK
 * (`@temporalio/vercel-ai-sdk`). A model call is one activity,
 * `invokeModel` (`invokeModelStreaming` when streamed), with the input
 * `{ modelId, options: LanguageModelV4CallOptions }` and the result
 * `LanguageModelV4GenerateResult` (`content`, `finishReason`, `usage`,
 * `response`). Tools defined in the workflow run there and record no tool
 * call ID; MCP tools run as `<server>-callTool` activities with the input
 * `{ name, input, options: { toolCallId } }`. `invokeEmbeddingModel` is not
 * a model call with messages and stays a plain step.
 *
 * Only the fields read here are typed; the rest is passed through.
 */

const MODEL_CALL_TYPES = new Set(['invokeModel', 'invokeModelStreaming']);

interface CallInput {
  modelId: string;
  options: {
    prompt: Json[];
    tools?: Json[];
    [key: string]: Json;
  };
}

interface CallResult {
  content: Json[];
  finishReason?: { unified?: string; raw?: string } | string;
  usage?: {
    inputTokens?:
      | number
      | { total?: number; cacheRead?: number; cacheWrite?: number };
    outputTokens?: number | { total?: number; reasoning?: number };
  };
  response?: { id?: string; modelId?: string };
}

function isCallInput(value: unknown): value is CallInput {
  return (
    isObject(value) &&
    typeof value.modelId === 'string' &&
    isObject(value.options) &&
    Array.isArray(value.options.prompt)
  );
}

function isCallResult(value: unknown): value is CallResult {
  return (
    isObject(value) &&
    Array.isArray(value.content) &&
    value.content.every(p => isObject(p) && typeof p.type === 'string') &&
    (value.usage === undefined || isObject(value.usage)) &&
    (value.response === undefined || isObject(value.response))
  );
}

/** A tool output of the SDK (`{ type: 'json' | 'text', value }`), unwrapped. */
function toolOutput(output: unknown): JsonValue {
  if (isObject(output) && 'value' in output && typeof output.type === 'string')
    return output.value as JsonValue;
  return (output ?? null) as JsonValue;
}

/** One content part of the SDK in the OpenTelemetry GenAI shape. */
function toPart(part: Json): WorkflowLlmPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', content: String(part.text ?? '') };
    case 'reasoning':
      return { type: 'reasoning', content: String(part.text ?? '') };
    case 'tool-call': {
      const call: WorkflowLlmPart = {
        type: 'tool_call',
        name: String(part.toolName ?? 'tool'),
        arguments: (structured(part.input) ?? null) as JsonValue,
      };
      if (str(part.toolCallId)) call.id = part.toolCallId;
      return call;
    }
    case 'tool-result': {
      const response: WorkflowLlmPart = {
        type: 'tool_call_response',
        response: toolOutput(part.output),
      };
      if (str(part.toolCallId)) response.id = part.toolCallId;
      if (str(part.toolName)) response.name = part.toolName;
      return response;
    }
    case 'file': {
      const file: WorkflowLlmPart = { type: 'file' };
      if (str(part.mediaType)) file.mime_type = part.mediaType;
      if (str(part.filename)) file.name = part.filename;
      return file;
    }
    default:
      return { ...(part as JsonObject), type: String(part.type) };
  }
}

function toParts(content: unknown): WorkflowLlmPart[] {
  if (typeof content === 'string') return [{ type: 'text', content }];
  if (!Array.isArray(content)) return [];
  return content.filter(isObject).map(toPart);
}

function count(
  value: unknown,
  key: 'total' | 'cacheRead' | 'cacheWrite' | 'reasoning',
): number | undefined {
  if (typeof value === 'number')
    return key === 'total' ? int(value) : undefined;
  return isObject(value) ? int(value[key]) : undefined;
}

/** Input tokens include cached ones, output tokens reasoning ones. */
function usageOf(result: CallResult): WorkflowLlmUsage {
  const usage: WorkflowLlmUsage = {};
  const set = (key: keyof WorkflowLlmUsage, n: number | undefined) => {
    if (n !== undefined) usage[key] = n;
  };
  const input = result.usage?.inputTokens;
  const output = result.usage?.outputTokens;
  set('inputTokens', count(input, 'total'));
  set('outputTokens', count(output, 'total'));
  set('reasoningTokens', count(output, 'reasoning'));
  set('cacheReadInputTokens', count(input, 'cacheRead'));
  set('cacheWriteInputTokens', count(input, 'cacheWrite'));
  return usage;
}

/** Call options other than the prompt and the tools, for example the temperature. */
const SKIPPED_OPTIONS = new Set([
  'prompt',
  'tools',
  'headers',
  'abortSignal',
  'providerOptions',
]);

function readRecord(input: CallInput | undefined, result: CallResult) {
  const prompt = input?.options.prompt.filter(isObject) ?? [];
  const record: WorkflowLlmRecord = {
    operation: 'chat',
    usage: usageOf(result),
    systemInstructions: prompt
      .filter(m => m.role === 'system')
      .flatMap(m => toParts(m.content)),
    inputMessages: prompt
      .filter(m => m.role !== 'system')
      .map(
        (m): WorkflowLlmMessage => ({
          role: str(m.role) ?? 'user',
          parts: toParts(m.content),
        }),
      ),
    outputMessages: [{ role: 'assistant', parts: toParts(result.content) }],
    toolExecutions: [],
  };
  if (input) record.requestModel = input.modelId;
  const responseModel = str(result.response?.modelId);
  if (responseModel) record.responseModel = responseModel;
  const responseId = str(result.response?.id);
  if (responseId) record.responseId = responseId;
  const reason =
    typeof result.finishReason === 'string'
      ? result.finishReason
      : str(result.finishReason?.unified) ?? str(result.finishReason?.raw);
  if (reason) record.finishReasons = [reason];
  if (Array.isArray(input?.options.tools)) {
    record.toolDefinitions = input!.options.tools as JsonValue[];
  }
  const parameters: JsonObject = {};
  for (const [key, value] of Object.entries(input?.options ?? {})) {
    if (!SKIPPED_OPTIONS.has(key) && value !== undefined) {
      parameters[key] = value as JsonValue;
    }
  }
  if (Object.keys(parameters).length > 0) record.parameters = parameters;
  return record;
}

/** The built-in adapter of `@temporalio/vercel-ai-sdk`. */
export const vercelAiSdkAdapter: TemporalLlmAdapter = {
  id: 'vercel-ai-sdk',
  isModelCall(step) {
    return step.kind === 'activity' && MODEL_CALL_TYPES.has(step.activityType);
  },
  readModelCalls(_step, payloads) {
    const value = payloads.input?.[0];
    const result = payloads.result;
    if (value !== undefined && !isCallInput(value)) return [];
    const input = value as CallInput | undefined;
    if (result !== undefined && !isCallResult(result)) return [];
    if (input === undefined && result === undefined) return [];
    if (result === undefined) return [{}];
    return [
      {
        record: readRecord(input, result as CallResult),
        raw: { input: input ?? null, result } as JsonValue,
      },
    ];
  },
  readToolCall(step, payloads) {
    if (step.kind !== 'activity' || !step.activityType.endsWith('-callTool'))
      return undefined;
    const input: unknown = payloads.input?.[0];
    if (
      !isObject(input) ||
      typeof input.name !== 'string' ||
      !isObject(input.options)
    ) {
      return undefined;
    }
    const tool: { toolName: string; toolCallId?: string } = {
      toolName: input.name,
    };
    const id = str(input.options.toolCallId);
    if (id) tool.toolCallId = id;
    return tool;
  },
};
