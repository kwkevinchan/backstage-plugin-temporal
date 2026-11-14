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

// Copy of plugins/temporal-backend/src/common/llm.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { JsonObject, JsonValue } from '@backstage/types';
import type { WorkflowNodeStatus } from './graph';
import type { ExternalPayload } from './types';

/*
 * Model calls and tool calls: the steps of a run that call a model, and the
 * steps that run the tools a model asked for. LLM adapters in the backend
 * recognize them in the history (the official Temporal AI integrations,
 * and adapters that modules add) and turn them into the types below.
 *
 * The markers and the record below are the format of the unreleased
 * `@kwkevinchan/temporal-workflow-kit`, read by a built-in adapter that
 * will be removed with it:
 *
 *   llm/<call>[/<rest>]                 one model call
 *   tool/<call>/<toolCallId>[/<rest>]   one tool call of that model call
 *
 * `<rest>` is free; a loop marker (`loop/<loop>/<round>/<step>`) there puts
 * the step in a loop round. The result of the model call holds the record
 * of the call under `temporal.llm`, with the attributes of the
 * OpenTelemetry GenAI semantic conventions.
 */

/** First segment of the activity ID of a model call. @alpha */
export const LLM_MARKER_PREFIX = 'llm';
/** First segment of the activity ID of a tool call. @alpha */
export const TOOL_MARKER_PREFIX = 'tool';
/** Key of the LLM record in the result of a model call. @alpha */
export const LLM_RECORD_KEY = 'temporal.llm';
/**
 * Key of the tool marker in the result of a tool call, for local
 * activities, whose activity ID the backend cannot always read. @alpha
 */
export const LLM_TOOL_RESULT_KEY = 'temporal.llm.tool';
/** Version of the LLM record format. @alpha */
export const LLM_RECORD_VERSION = 1;
/**
 * Version of the OpenTelemetry GenAI semantic conventions the record
 * follows (schema URL suffix of the conventions, status Development).
 *
 * @alpha
 */
export const LLM_SEMCONV_VERSION = 'gen-ai-dev/1.42.0-dev';

/**
 * A marker of the workflow kit: a model call, or a tool call of one.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
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
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
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
  /** Status of that activity, or of the run recorded in the model call. */
  status?: WorkflowNodeStatus;
  /** True when the tool ran inside the model call's activity. */
  inActivity?: boolean;
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
 * - `unreadable`: the result is encoded by a codec, or stored in S3 and
 *   larger than the backend reads inline (the full record route reads it);
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
 * reasoning, arguments and results need the permission to read the
 * history, through the full record route.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmSummary {
  /**
   * Name of the call, when the step records one (the workflow kit's
   * marker). Otherwise show the step's summary or the model.
   */
  call?: string;
  /**
   * The LLM adapter that read the step, for example `vercel-ai-sdk` or
   * `openai-agents`.
   */
  framework: string;
  /** Model calls in the step, when more than one: the numbers add up all. */
  callCount?: number;
  record: WorkflowLlmRecordState;
  /** `gen_ai.operation.name`, for example `chat`. */
  operation?: string;
  /** The provider, for example `openai`, when the step records it. */
  provider?: string;
  /** The response model, else the request model (of the last call). */
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
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowToolLink {
  /** Name of the model call, when it has one. */
  call?: string;
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
  /** Deprecated in the conventions; read from older records. */
  finishReason?: string;
}

/**
 * A tool that ran inside the model call's activity.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
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
 * The record of one model call: what an LLM adapter read from the step, in
 * the shape of the OpenTelemetry GenAI conventions.
 *
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
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
 * Experimental: the shape changes before the first stable release.
 *
 * @alpha
 */
export interface WorkflowLlmCallResponse {
  /** Graph node of the call, `activity-<scheduled event ID>`. */
  nodeId: string;
  activityId: string;
  activityType: string;
  /** Name of the call, when the step records one. */
  call?: string;
  /** The LLM adapter that read the step. */
  framework: string;
  /** Position of this call among the model calls of the step, from 0. */
  index?: number;
  /** Model calls in the step, when more than one (`?index=` picks one). */
  callCount?: number;
  status: WorkflowNodeStatus;
  /** The record; left out with `unavailable`. */
  record?: WorkflowLlmRecord;
  /** The data the record was read from, as the worker wrote it. */
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
