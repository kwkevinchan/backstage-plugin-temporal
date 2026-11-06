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
 * LLM steps: activities that call a model, and the activities that run the
 * tools the model asked for. The activity ID marks them, so the backend
 * finds them without a payload codec:
 *
 *   llm/<call>[/<rest>]                 one model call
 *   tool/<call>/<toolCallId>[/<rest>]   one tool call of that model call
 *
 * `<rest>` is free; a loop marker (`loop/<loop>/<round>/<step>`) there puts
 * the step in a loop round. The result of the model call holds the record
 * of the call under `temporal.llm`, with the attributes of the
 * OpenTelemetry GenAI semantic conventions. `@kwkevinchan/temporal-workflow-kit/llm`
 * writes both in TypeScript workers; other SDKs follow the format in its
 * README.
 */

/** First segment of the activity ID of a model call. @public */
export const LLM_MARKER_PREFIX = 'llm';
/** First segment of the activity ID of a tool call. @public */
export const TOOL_MARKER_PREFIX = 'tool';
/** Key of the LLM record in the result of a model call. @public */
export const LLM_RECORD_KEY = 'temporal.llm';
/**
 * Key of the tool marker in the result of a tool call, for local
 * activities, whose activity ID the backend cannot always read. @public
 */
export const LLM_TOOL_RESULT_KEY = 'temporal.llm.tool';
/** Version of the LLM record format. @public */
export const LLM_RECORD_VERSION = 1;
/**
 * Version of the OpenTelemetry GenAI semantic conventions the record
 * follows (schema URL suffix of the conventions, status Development).
 * @public
 */
export const LLM_SEMCONV_VERSION = 'gen-ai-dev/1.42.0-dev';

/**
 * A step of an LLM agent: a model call, or a tool call of one.
 *
 * @public
 */
export type WorkflowLlmMarker =
  | { kind: 'llm'; call: string }
  | { kind: 'tool'; call: string; toolCallId: string };

const LLM_PATTERN = /^llm\/([^/]+)(?:\/|$)/;
const TOOL_PATTERN = /^tool\/([^/]+)\/([^/]+)(?:\/|$)/;

/**
 * Reads `llm/<call>[/...]` or `tool/<call>/<toolCallId>[/...]` from an
 * activity ID. Names are percent-encoded.
 *
 * @public
 */
export function parseLlmMarker(
  text: string | undefined,
): WorkflowLlmMarker | undefined {
  if (!text) return undefined;
  try {
    const llm = LLM_PATTERN.exec(text);
    if (llm) return { kind: 'llm', call: decodeURIComponent(llm[1]) };
    const tool = TOOL_PATTERN.exec(text);
    if (tool) {
      return {
        kind: 'tool',
        call: decodeURIComponent(tool[1]),
        toolCallId: decodeURIComponent(tool[2]),
      };
    }
  } catch {
    // Not percent-encoded: not a marker.
  }
  return undefined;
}

/**
 * Token counts of one model call, or a sum of several. Input tokens
 * include cached tokens, output tokens include reasoning tokens (as in the
 * OpenTelemetry conventions).
 *
 * @public
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
 * @public
 */
export interface WorkflowLlmToolCallRef {
  /** Tool call ID from the model. */
  id?: string;
  name: string;
  /** Graph node of the activity that ran the tool, when there is one. */
  nodeId?: string;
  /** Status of that activity, or of the run recorded in the model call. */
  status?: WorkflowNodeStatus;
  /** True when the tool ran inside the model call's activity. */
  inActivity?: boolean;
}

/**
 * State of the record of a model call:
 *
 * - `available`: read from the result;
 * - `pending`: the call has not ended;
 * - `unreadable`: the result is encoded by a codec, or stored in S3 and
 *   larger than the backend reads inline (the full record route reads it);
 * - `missing`: the result has no record.
 *
 * @public
 */
export type WorkflowLlmRecordState =
  | 'available'
  | 'pending'
  | 'unreadable'
  | 'missing';

/**
 * What the graph shows of a model call. Names and numbers only: messages,
 * reasoning, arguments and results need the permission to read the
 * history, through the full record route.
 *
 * @public
 */
export interface WorkflowLlmSummary {
  /** The call name of the marker. */
  call: string;
  record: WorkflowLlmRecordState;
  /** `gen_ai.operation.name`, for example `chat`. */
  operation?: string;
  /** `gen_ai.provider.name`, for example `openai`. */
  provider?: string;
  /** The response model, else the request model. */
  model?: string;
  usage?: WorkflowLlmUsage;
  /** Duration of the call, from the record, else from the activity. */
  durationMs?: number;
  toolCalls: WorkflowLlmToolCallRef[];
  /** True when the output has reasoning (thinking). */
  reasoning: boolean;
  finishReasons?: string[];
  /** Error type or message of a failed call. */
  error?: string;
}

/**
 * The model call a tool call belongs to.
 *
 * @public
 */
export interface WorkflowToolLink {
  call: string;
  toolCallId: string;
  /** Graph node of the model call. */
  llmNodeId?: string;
  /** Tool name from the model call, when it was read. */
  name?: string;
}

/**
 * One part of a message, as in the OpenTelemetry GenAI conventions:
 * `text`, `reasoning`, `tool_call`, `tool_call_response`, `blob`, `file`,
 * `uri`, `server_tool_call`, `server_tool_call_response`, `compaction`,
 * or a type of a provider.
 *
 * @public
 */
export type WorkflowLlmPart = JsonObject & { type: string };

/**
 * One message sent to or received from the model.
 *
 * @public
 */
export interface WorkflowLlmMessage {
  /** `system`, `user`, `assistant`, `tool` or another role. */
  role: string;
  name?: string;
  parts: WorkflowLlmPart[];
  /** Deprecated in the conventions; read from older records. */
  finishReason?: string;
}

/**
 * A tool that ran inside the model call's activity.
 *
 * @public
 */
export interface WorkflowLlmToolExecution {
  /** `gen_ai.tool.call.id`. */
  id?: string;
  /** `gen_ai.tool.name`. */
  name: string;
  /** `gen_ai.tool.call.arguments`. */
  arguments?: JsonValue;
  /** `gen_ai.tool.call.result`. */
  result?: JsonValue;
  /** `error.type` and the message of a failed tool. */
  error?: { type?: string; message: string };
  durationMs?: number;
}

/**
 * The record of one model call, read from the OpenTelemetry attributes.
 *
 * @public
 */
export interface WorkflowLlmRecord {
  operation?: string;
  provider?: string;
  requestModel?: string;
  responseModel?: string;
  responseId?: string;
  finishReasons?: string[];
  conversationId?: string;
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
  toolExecutions: WorkflowLlmToolExecution[];
  startTime?: string;
  durationMs?: number;
  error?: { type?: string; message: string };
}

/**
 * The full record of one model call.
 *
 * @public
 */
export interface WorkflowLlmCallResponse {
  /** Graph node of the call, `activity-<scheduled event ID>`. */
  nodeId: string;
  activityId: string;
  activityType: string;
  call: string;
  status: WorkflowNodeStatus;
  /** The record; left out with `unavailable`. */
  record?: WorkflowLlmRecord;
  /** The record as the worker wrote it. */
  raw?: JsonValue;
  /** Why there is no record, in words. */
  unavailable?: string;
  /** The payload in External Storage the record was read from. */
  external?: ExternalPayload;
  /** True when the record is of a failed attempt (failure details). */
  fromFailure?: boolean;
}

/**
 * Builds the path of the full record of a model call, relative to the
 * path of the workflow: `/llm-calls/<scheduled event ID>`.
 *
 * @public
 */
export function buildLlmCallPath(nodeId: string): string {
  const eventId = /^activity-(\d+)$/.exec(nodeId)?.[1] ?? nodeId;
  return `/llm-calls/${encodeURIComponent(eventId)}`;
}

/** Adds the token counts of `b` to `a`. @public */
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
