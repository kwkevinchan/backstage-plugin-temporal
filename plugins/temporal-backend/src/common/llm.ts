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
import type { WorkflowNodeStatus } from './graph';
import type { ExternalPayload } from './types';

/*
 * Model calls and tool calls: the steps of a run that call a model, and the
 * steps that run the tools a model asked for. LLM adapters in the backend
 * recognize them in the history (the official Temporal AI integrations) and
 * turn them into the types below.
 */

/**
 * Token counts of one model call, or a sum of several. Input tokens
 * include cached tokens, output tokens include reasoning tokens (as in the
 * OpenTelemetry conventions).
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/**
 * A tool call the model asked for.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmToolCallRef {
  /** Tool call ID from the model. */
  id?: string;
  name: string;
  /** Graph node of the activity that ran the tool, when there is one. */
  nodeId?: string;
  /** Status of that activity. */
  status?: WorkflowNodeStatus;
  /**
   * True when the step in `nodeId` was found by its name, arguments and
   * place in the run, not by a tool call ID the step recorded.
   */
  inferred?: boolean;
}

/**
 * State of the record of a model call:
 *
 * - `available`: read from the result;
 * - `pending`: the call has not ended;
 * - `unreadable`: the result is encoded by a codec, or stored in External
 *   Storage (the backend does not read it);
 * - `missing`: the result has no record.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export type WorkflowLlmRecordState =
  | 'available'
  | 'pending'
  | 'unreadable'
  | 'missing';

/**
 * What the graph shows of a model call. Names and numbers only: messages,
 * reasoning, arguments and results come from the full record route.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmSummary {
  /**
   * The LLM adapter that read the step, for example `vercel-ai-sdk` or
   * `openai-agents`.
   */
  framework: string;
  record: WorkflowLlmRecordState;
  /** The provider, for example `openai`, when the step records it. */
  provider?: string;
  /** The response model, else the request model. */
  model?: string;
  usage?: WorkflowLlmUsage;
  /** Duration of the call, from the record, else from the activity. */
  durationMs?: number;
  toolCalls: WorkflowLlmToolCallRef[];
  /**
   * True when the output has a reasoning (thinking) part, or the usage
   * counts reasoning tokens.
   */
  reasoning: boolean;
  finishReasons?: string[];
  /** Error type of a failed call, or `error` when the record has none. */
  error?: string;
}

/**
 * The model call a tool call belongs to.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowToolLink {
  /** Tool call ID from the step, or from the model call it was linked to. */
  toolCallId?: string;
  /** Graph node of the model call. */
  llmNodeId?: string;
  /** Tool name from the model call, when it was read. */
  name?: string;
  /**
   * True when the link was inferred from the tool name, the arguments and
   * the order of the steps: the step recorded no tool call ID.
   */
  inferred?: boolean;
}

/**
 * One part of a message, as in the OpenTelemetry GenAI conventions:
 * `text`, `reasoning`, `tool_call`, `tool_call_response`, `blob`, `file`,
 * `uri`, `server_tool_call`, `server_tool_call_response`, `compaction`,
 * or a type of a provider.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export type WorkflowLlmPart = JsonObject & { type: string };

/**
 * One message sent to or received from the model.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmMessage {
  /** `system`, `user`, `assistant`, `tool` or another role. */
  role: string;
  name?: string;
  parts: WorkflowLlmPart[];
}

/**
 * The record of one model call: what an LLM adapter read from the step, in
 * the shape of the OpenTelemetry GenAI conventions.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmRecord {
  provider?: string;
  requestModel?: string;
  responseModel?: string;
  responseId?: string;
  finishReasons?: string[];
  /** Other `gen_ai.request.*` attributes, for example the temperature. */
  parameters?: JsonObject;
  usage: WorkflowLlmUsage;
  /** `gen_ai.system_instructions`. */
  systemInstructions: WorkflowLlmPart[];
  /** `gen_ai.input.messages`. */
  inputMessages: WorkflowLlmMessage[];
  /** `gen_ai.output.messages`. */
  outputMessages: WorkflowLlmMessage[];
  /** `gen_ai.tool.definitions`. */
  toolDefinitions?: JsonValue[];
  durationMs?: number;
  error?: { type?: string; message: string };
}

/**
 * The full record of one model call.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmCallResponse {
  /** Graph node of the call, `activity-<scheduled event ID>`. */
  nodeId: string;
  activityId: string;
  activityType: string;
  /** The LLM adapter that read the step. */
  framework: string;
  status: WorkflowNodeStatus;
  /** The record; left out with `unavailable`. */
  record?: WorkflowLlmRecord;
  /** The data the record was read from, as the worker wrote it. */
  raw?: JsonValue;
  /** Why there is no record, in words. */
  unavailable?: string;
  /** The payload in External Storage that holds the record; with `unavailable`. */
  external?: ExternalPayload;
}

/**
 * Builds the path of the full record of a model call, relative to the
 * path of the workflow: `/llm-calls/<scheduled event ID>`.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export function buildLlmCallPath(nodeId: string): string {
  const eventId = /^activity-(\d+)$/.exec(nodeId)?.[1] ?? nodeId;
  return `/llm-calls/${encodeURIComponent(eventId)}`;
}

/** Adds the token counts of `b` to `a`. @alpha */
export function addLlmUsage(
  a: WorkflowLlmUsage | undefined,
  b: WorkflowLlmUsage | undefined,
): WorkflowLlmUsage | undefined {
  if (!b) return a;
  if (!a) return { ...b };
  const out: WorkflowLlmUsage = { ...a };
  for (const key of [
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'cacheReadInputTokens',
    'cacheWriteInputTokens',
  ] as const) {
    if (b[key] !== undefined) out[key] = (out[key] ?? 0) + b[key]!;
  }
  return out;
}
