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
} from '../common';
import type {
  WorkflowGraphNode,
  WorkflowLlmMessage,
  WorkflowLlmPart,
  WorkflowLlmRecord,
  WorkflowLlmSummary,
  WorkflowLlmToolExecution,
  WorkflowLlmUsage,
  WorkflowNodeStatus,
  WorkflowToolLink,
} from '../common';

/*
 * Records of model calls. A model call activity (activity ID `llm/...`)
 * returns `{ "temporal.llm": <record>, "value": <anything> }`; the record
 * holds OpenTelemetry GenAI attributes (`gen_ai.*`) under `attributes`.
 * The backend reads the record without knowing the rest of the result.
 */

type Json = any;

function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function int(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
    ? Math.round(n)
    : undefined;
}

/** A JSON attribute that may be stored as a JSON string. */
function structured(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

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

function hasReasoning(record: WorkflowLlmRecord): boolean {
  return (
    (record.usage.reasoningTokens ?? 0) > 0 ||
    record.outputMessages.some(m =>
      m.parts.some(p => p.type === 'reasoning' || /thinking/.test(p.type)),
    )
  );
}

/** Tool calls in the output of a record, in order. */
export function outputToolCalls(
  record: WorkflowLlmRecord,
): { id?: string; name: string }[] {
  const calls: { id?: string; name: string }[] = [];
  for (const message of record.outputMessages) {
    for (const part of message.parts) {
      if (part.type !== 'tool_call') continue;
      const call: { id?: string; name: string } = {
        name: str(part.name) ?? 'tool',
      };
      if (str(part.id)) call.id = part.id as string;
      calls.push(call);
    }
  }
  return calls;
}

/** Milliseconds between two ISO times, when both are set. */
function between(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * The summary of a model call from its decoded result. `result` is the
 * decoded payload (`{ encoding, value }`, a stored payload, or undecodable).
 */
export function summarizeLlmCall(
  node: Pick<
    WorkflowGraphNode,
    'status' | 'startTime' | 'endTime' | 'attempts'
  >,
  call: string,
  result: unknown,
): WorkflowLlmSummary {
  const summary: WorkflowLlmSummary = {
    call,
    record: 'pending',
    toolCalls: [],
    reasoning: false,
  };
  const startedTime = node.attempts?.[node.attempts.length - 1]?.startedTime;
  const activityMs = between(startedTime ?? node.startTime, node.endTime);
  if (activityMs !== undefined && node.endTime) summary.durationMs = activityMs;
  const decoded = isObject(result) ? result : undefined;
  const value = decoded && 'value' in decoded ? decoded.value : undefined;
  const record = llmRecordOf(value);
  if (!record) {
    if (decoded) {
      summary.record = 'value' in decoded ? 'missing' : 'unreadable';
    } else if (
      !['Scheduled', 'Running', 'Retrying', 'Waiting'].includes(node.status)
    ) {
      summary.record = 'missing';
    }
    return summary;
  }
  const normalized = normalizeLlmRecord(record);
  summary.record = 'available';
  if (normalized.operation) summary.operation = normalized.operation;
  if (normalized.provider) summary.provider = normalized.provider;
  const model = normalized.responseModel ?? normalized.requestModel;
  if (model) summary.model = model;
  if (Object.keys(normalized.usage).length > 0)
    summary.usage = normalized.usage;
  if (normalized.durationMs !== undefined)
    summary.durationMs = normalized.durationMs;
  if (normalized.finishReasons?.length)
    summary.finishReasons = normalized.finishReasons;
  if (normalized.error) {
    summary.error = normalized.error.type ?? normalized.error.message;
  }
  summary.reasoning = hasReasoning(normalized);
  summary.toolCalls = outputToolCalls(normalized).map(c => ({ ...c }));
  for (const execution of normalized.toolExecutions) {
    const status: WorkflowNodeStatus = execution.error ? 'Failed' : 'Completed';
    const listed = summary.toolCalls.find(
      c => c.id !== undefined && c.id === execution.id,
    );
    if (listed) {
      listed.inActivity = true;
      listed.status = status;
    } else {
      summary.toolCalls.push({
        ...(execution.id ? { id: execution.id } : {}),
        name: execution.name,
        inActivity: true,
        status,
      });
    }
  }
  return summary;
}

/** Steps of a run, with what the LLM marker linking needs. */
export interface LlmLinkNode extends WorkflowGraphNode {
  first: number;
}

/**
 * Links tool calls to their model calls: each tool step gets the node ID of
 * the latest model call with the same call name that started before it,
 * and each model call lists the steps of its tool calls.
 */
export function linkLlmSteps(nodes: LlmLinkNode[]) {
  const calls = nodes.filter(n => n.llm).sort((a, b) => a.first - b.first);
  if (calls.length === 0 && !nodes.some(n => n.tool)) return;
  for (const tool of nodes.filter(n => n.tool)) {
    const link = tool.tool as WorkflowToolLink;
    const owner = [...calls]
      .reverse()
      .find(c => c.llm!.call === link.call && c.first < tool.first);
    if (!owner) continue;
    link.llmNodeId = owner.id;
    const summary = owner.llm!;
    let ref = summary.toolCalls.find(
      c => c.id === link.toolCallId && !c.nodeId,
    );
    if (!ref) {
      // A tool call the record does not list (unreadable record).
      ref = { id: link.toolCallId, name: tool.name };
      summary.toolCalls.push(ref);
    }
    ref.nodeId = tool.id;
    ref.status = tool.status;
    if (!link.name && ref.name) link.name = ref.name;
    delete ref.inActivity;
  }
}

/** The LLM marker of a step from its activity ID, as node fields. */
export function llmFieldsOf(
  activityId: string | undefined,
): { llmCall: string } | { tool: WorkflowToolLink } | undefined {
  const marker = parseLlmMarker(activityId);
  if (!marker) return undefined;
  if (marker.kind === 'llm') return { llmCall: marker.call };
  return { tool: { call: marker.call, toolCallId: marker.toolCallId } };
}

/** Activity ID of a local activity from its marker details, when readable. */
export function localActivityId(details: unknown): string | undefined {
  if (!isObject(details)) return undefined;
  for (const key of ['data', 'meta']) {
    const decoded = details[key];
    const value =
      isObject(decoded) && 'value' in decoded ? decoded.value : undefined;
    if (isObject(value)) {
      const id = str(value.activity_id) ?? str(value.activityId);
      if (id) return id;
    }
  }
  return undefined;
}

/** The decoded result of a local activity from its marker details. */
export function localActivityResult(details: unknown): unknown {
  if (!isObject(details)) return undefined;
  const decoded = details.result;
  return isObject(decoded) && 'value' in decoded ? decoded.value : undefined;
}
