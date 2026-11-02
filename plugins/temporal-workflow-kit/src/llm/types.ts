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
 * The OpenTelemetry GenAI semantic conventions (status Development),
 * version gen-ai-dev/1.42.0-dev (open-telemetry/semantic-conventions-genai
 * at commit 16f3130, November 2026): message parts, messages and the
 * span attributes the record uses.
 */

/** Version of the conventions the record follows. @public */
export const LLM_SEMCONV_VERSION = 'gen-ai-dev/1.42.0-dev';

/** Text sent to or received from the model. @public */
export interface TextPart {
  type: 'text';
  content: string;
  [extra: string]: unknown;
}

/** Reasoning (thinking) received from the model. @public */
export interface ReasoningPart {
  type: 'reasoning';
  content: string;
  [extra: string]: unknown;
}

/** A tool call requested by the model. @public */
export interface ToolCallRequestPart {
  type: 'tool_call';
  id?: string;
  name: string;
  arguments?: unknown;
  [extra: string]: unknown;
}

/** A tool result sent to the model. @public */
export interface ToolCallResponsePart {
  type: 'tool_call_response';
  id?: string;
  response: unknown;
  [extra: string]: unknown;
}

/** Binary data sent inline (base64). @public */
export interface BlobPart {
  type: 'blob';
  mime_type?: string;
  modality: string;
  content: string;
  [extra: string]: unknown;
}

/** A file referenced by URI. @public */
export interface UriPart {
  type: 'uri';
  mime_type?: string;
  modality: string;
  uri: string;
  [extra: string]: unknown;
}

/** A file uploaded to the provider before. @public */
export interface FilePart {
  type: 'file';
  mime_type?: string;
  modality: string;
  file_id: string;
  [extra: string]: unknown;
}

/** Any other part, for example `server_tool_call` or a provider's own type. @public */
export interface GenericPart {
  type: string;
  [extra: string]: unknown;
}

/** One part of a message. @public */
export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallRequestPart
  | ToolCallResponsePart
  | BlobPart
  | UriPart
  | FilePart
  | GenericPart;

/** One message (`gen_ai.input.messages`, `gen_ai.output.messages`). @public */
export interface ChatMessage {
  /** `system`, `user`, `assistant`, `tool` or another role. */
  role: string;
  parts: MessagePart[];
  name?: string;
}

/** A tool the model may call (`gen_ai.tool.definitions`). @public */
export interface ToolDefinition {
  type: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [extra: string]: unknown;
}

/**
 * The OpenTelemetry attributes of one model call (an inference span).
 * Names as in the conventions; any other `gen_ai.*` attribute may be added.
 *
 * @public
 */
export interface LlmAttributes {
  'gen_ai.operation.name'?: string;
  'gen_ai.provider.name'?: string;
  'gen_ai.conversation.id'?: string;
  'gen_ai.request.model'?: string;
  'gen_ai.request.temperature'?: number;
  'gen_ai.request.top_p'?: number;
  'gen_ai.request.top_k'?: number;
  'gen_ai.request.max_tokens'?: number;
  'gen_ai.request.seed'?: number;
  'gen_ai.request.stop_sequences'?: string[];
  'gen_ai.request.frequency_penalty'?: number;
  'gen_ai.request.presence_penalty'?: number;
  'gen_ai.request.choice.count'?: number;
  'gen_ai.request.reasoning.level'?: string;
  'gen_ai.request.stream'?: boolean;
  'gen_ai.response.model'?: string;
  'gen_ai.response.id'?: string;
  'gen_ai.response.finish_reasons'?: string[];
  'gen_ai.usage.input_tokens'?: number;
  'gen_ai.usage.output_tokens'?: number;
  'gen_ai.usage.reasoning.output_tokens'?: number;
  'gen_ai.usage.cache_read.input_tokens'?: number;
  'gen_ai.usage.cache_write.input_tokens'?: number;
  'gen_ai.system_instructions'?: MessagePart[];
  'gen_ai.input.messages'?: ChatMessage[];
  'gen_ai.output.messages'?: ChatMessage[];
  'gen_ai.tool.definitions'?: ToolDefinition[];
  'error.type'?: string;
  [attribute: string]: unknown;
}

/**
 * A tool that ran inside the model call's activity (attributes of an
 * `execute_tool` span), with its duration.
 *
 * @public
 */
export interface LlmToolExecution {
  'gen_ai.tool.call.id'?: string;
  'gen_ai.tool.name': string;
  'gen_ai.tool.type'?: string;
  'gen_ai.tool.call.arguments'?: unknown;
  'gen_ai.tool.call.result'?: unknown;
  'error.type'?: string;
  error?: { type?: string; message: string };
  durationMs?: number;
}

/**
 * The record of one model call, stored in the activity result under
 * `temporal.llm`.
 *
 * @public
 */
export interface LlmRecord {
  /** Format version, 1. */
  v: 1;
  /** Version of the OpenTelemetry conventions of `attributes`. */
  semconv: string;
  attributes: LlmAttributes;
  /** When the call started, ISO 8601. */
  startTime?: string;
  durationMs?: number;
  /** The error of a failed call. */
  error?: { type?: string; message: string };
  /** Tools that ran inside the activity. */
  toolExecutions?: LlmToolExecution[];
}

/**
 * The result of a model call activity: the record, and your own value (by
 * default the provider's response).
 *
 * @public
 */
export interface LlmCallResult<T = unknown> {
  'temporal.llm': LlmRecord;
  value?: T;
}

/**
 * Turns a provider's request and response into OpenTelemetry attributes.
 *
 * @public
 */
export interface LlmConverter<Req, Res> {
  /** `gen_ai.provider.name`. */
  provider: string;
  request(request: Req): LlmAttributes;
  response(response: Res): LlmAttributes;
}
