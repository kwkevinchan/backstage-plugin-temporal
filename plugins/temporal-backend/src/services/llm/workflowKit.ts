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
import {
  LLM_RECORD_KEY,
  LLM_TOOL_RESULT_KEY,
  parseLlmMarker,
} from '../../common';
import type {
  WorkflowLlmMessage,
  WorkflowLlmPart,
  WorkflowLlmRecord,
  WorkflowLlmToolExecution,
  WorkflowLlmUsage,
} from '../../common';
import type { TemporalLlmAdapter } from '../../node/alpha';
import { int, isObject, Json, str, structured } from './json';

/*
 * The format of the unreleased `@kwkevinchan/temporal-workflow-kit`, read by
 * a built-in adapter. Internal, and removed together with the kit: the
 * activity ID marks a step (`llm/<call>`, `tool/<call>/<toolCallId>`), and
 * a model call returns `{ "temporal.llm": <record>, "value": <anything> }`;
 * the record holds OpenTelemetry GenAI attributes (`gen_ai.*`) under
 * `attributes`.
 */

/** ID of the built-in adapter of the workflow kit's format. */
export const WORKFLOW_KIT_ADAPTER_ID = 'temporal-workflow-kit';

/**
 * The record in a decoded result (`{ "temporal.llm": {...} }`), or
 * undefined. Accepts version 1 and records without a version.
 */
export function llmRecordOf(value: unknown): JsonObject | undefined {
  if (!isObject(value)) return undefined;
  const record = value[LLM_RECORD_KEY];
  if (!isObject(record) || !isObject(record.attributes)) return undefined;
  if (record.v !== undefined && record.v !== 1) return undefined;
  return record as JsonObject;
}

/** The tool marker in a decoded result of a tool call (local activities). */
export function toolMarkerOf(
  value: unknown,
): { call: string; toolCallId: string } | undefined {
  if (!isObject(value)) return undefined;
  const marker = value[LLM_TOOL_RESULT_KEY];
  if (!isObject(marker)) return undefined;
  const call = str(marker.call);
  const toolCallId = str(marker.toolCallId);
  return call && toolCallId ? { call, toolCallId } : undefined;
}

function toPart(value: unknown): WorkflowLlmPart {
  if (isObject(value) && typeof value.type === 'string') {
    const part = { ...value } as WorkflowLlmPart;
    if (part.type === 'tool_call')
      part.arguments = structured(part.arguments) as JsonValue;
    return part;
  }
  return {
    type: 'text',
    content: typeof value === 'string' ? value : JSON.stringify(value ?? null),
  };
}

function toParts(value: unknown): WorkflowLlmPart[] {
  const parsed = structured(value);
  if (Array.isArray(parsed)) return parsed.map(toPart);
  if (parsed === undefined || parsed === null) return [];
  return [toPart(parsed)];
}

function toMessages(value: unknown): WorkflowLlmMessage[] {
  const parsed = structured(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(m => {
    if (!isObject(m)) {
      return { role: 'user', parts: toParts(m) };
    }
    const message: WorkflowLlmMessage = {
      role: str(m.role) ?? 'user',
      parts: toParts(m.parts ?? m.content),
    };
    if (str(m.name)) message.name = m.name;
    if (str(m.finish_reason)) message.finishReason = m.finish_reason;
    return message;
  });
}

function usageOf(attributes: Record<string, Json>): WorkflowLlmUsage {
  const usage: WorkflowLlmUsage = {};
  const set = (key: keyof WorkflowLlmUsage, attribute: string) => {
    const n = int(attributes[attribute]);
    if (n !== undefined) usage[key] = n;
  };
  set('inputTokens', 'gen_ai.usage.input_tokens');
  set('outputTokens', 'gen_ai.usage.output_tokens');
  set('reasoningTokens', 'gen_ai.usage.reasoning.output_tokens');
  set('cacheReadInputTokens', 'gen_ai.usage.cache_read.input_tokens');
  set('cacheWriteInputTokens', 'gen_ai.usage.cache_write.input_tokens');
  return usage;
}

function errorOf(value: unknown, type?: unknown) {
  if (isObject(value)) {
    const message = str(value.message) ?? str(value.type) ?? 'Error';
    const error: { type?: string; message: string } = { message };
    if (str(value.type)) error.type = value.type;
    return error;
  }
  if (str(value)) {
    return str(type)
      ? { type: type as string, message: value as string }
      : { message: value as string };
  }
  return str(type)
    ? { type: type as string, message: type as string }
    : undefined;
}

function toolExecutionsOf(value: unknown): WorkflowLlmToolExecution[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map(t => {
    const execution: WorkflowLlmToolExecution = {
      name: str(t['gen_ai.tool.name']) ?? 'tool',
    };
    if (str(t['gen_ai.tool.call.id'])) execution.id = t['gen_ai.tool.call.id'];
    if (t['gen_ai.tool.call.arguments'] !== undefined) {
      execution.arguments = structured(
        t['gen_ai.tool.call.arguments'],
      ) as JsonValue;
    }
    if (t['gen_ai.tool.call.result'] !== undefined) {
      execution.result = structured(t['gen_ai.tool.call.result']) as JsonValue;
    }
    const error = errorOf(t.error, t['error.type']);
    if (error) execution.error = error;
    const ms = int(t.durationMs);
    if (ms !== undefined) execution.durationMs = ms;
    return execution;
  });
}

const KNOWN_ATTRIBUTES = new Set([
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.response.id',
  'gen_ai.response.finish_reasons',
  'gen_ai.conversation.id',
  'gen_ai.system_instructions',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.tool.definitions',
]);

/** Reads a record (`llmRecordOf`) into the shape the frontend shows. */
export function normalizeLlmRecord(record: JsonObject): WorkflowLlmRecord {
  const a = record.attributes as Record<string, Json>;
  const out: WorkflowLlmRecord = {
    usage: usageOf(a),
    systemInstructions: toParts(a['gen_ai.system_instructions']),
    inputMessages: toMessages(a['gen_ai.input.messages']),
    outputMessages: toMessages(a['gen_ai.output.messages']),
    toolExecutions: toolExecutionsOf(record.toolExecutions),
  };
  const set = <K extends keyof WorkflowLlmRecord>(
    key: K,
    value: WorkflowLlmRecord[K] | undefined,
  ) => {
    if (value !== undefined) out[key] = value;
  };
  set('operation', str(a['gen_ai.operation.name']));
  set('provider', str(a['gen_ai.provider.name']));
  set('requestModel', str(a['gen_ai.request.model']));
  set('responseModel', str(a['gen_ai.response.model']));
  set('responseId', str(a['gen_ai.response.id']));
  set('conversationId', str(a['gen_ai.conversation.id']));
  const reasons = structured(a['gen_ai.response.finish_reasons']);
  if (Array.isArray(reasons)) {
    set(
      'finishReasons',
      reasons.filter(r => typeof r === 'string'),
    );
  } else if (str(reasons)) set('finishReasons', [reasons as string]);
  const definitions = structured(a['gen_ai.tool.definitions']);
  if (Array.isArray(definitions)) set('toolDefinitions', definitions);
  const parameters: JsonObject = {};
  for (const [key, value] of Object.entries(a)) {
    if (key.startsWith('gen_ai.request.') && !KNOWN_ATTRIBUTES.has(key)) {
      parameters[key.slice('gen_ai.request.'.length)] = value as JsonValue;
    }
  }
  if (Object.keys(parameters).length > 0) set('parameters', parameters);
  set('startTime', str(record.startTime));
  set('durationMs', int(record.durationMs));
  set('error', errorOf(record.error, a['error.type']));
  return out;
}

/**
 * The adapter of the workflow kit's format. Internal: it is not exported,
 * and goes away with the kit.
 */
export const workflowKitAdapter: TemporalLlmAdapter = {
  id: WORKFLOW_KIT_ADAPTER_ID,
  isModelCall(step) {
    return (
      step.kind === 'activity' &&
      parseLlmMarker(step.activityId)?.kind === 'llm'
    );
  },
  readModelCalls(step, payloads) {
    const marker = parseLlmMarker(step.activityId);
    if (marker?.kind !== 'llm') return [];
    // The result; without one, the details of the latest failure that has
    // a record.
    const record =
      payloads.result !== undefined
        ? llmRecordOf(payloads.result)
        : (payloads.failureDetails ?? [])
            .map(llmRecordOf)
            .find(r => r !== undefined);
    if (!record) return [{ name: marker.call }];
    return [
      { name: marker.call, record: normalizeLlmRecord(record), raw: record },
    ];
  },
  readToolCall(step, payloads) {
    const marker = parseLlmMarker(step.activityId);
    // Local activities: the SDKs that record the activity ID, else the tool
    // marker in the result.
    let tool: { call: string; toolCallId: string } | undefined;
    if (marker?.kind === 'tool') tool = marker;
    else if (step.kind === 'localActivity') {
      tool = toolMarkerOf(payloads.result);
    }
    if (!tool) return undefined;
    return { toolCallId: tool.toolCallId, modelCall: tool.call };
  },
};
