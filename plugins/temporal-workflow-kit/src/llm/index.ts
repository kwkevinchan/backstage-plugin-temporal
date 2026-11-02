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

/**
 * LLM steps for Temporal workflows: activity ID markers for model calls
 * and their tool calls, a wrapper that records each model call with the
 * OpenTelemetry GenAI attributes, and converters for OpenAI chat,
 * Anthropic messages and Ollama chat. The Backstage Temporal plugin shows
 * the calls from these records.
 *
 * Depends on no SDK: the markers are for workflow code, the wrapper and
 * converters for activity code.
 *
 * @packageDocumentation
 */

export {
  formatLlmActivityId,
  formatToolActivityId,
  llmCallOptions,
  LLM_MARKER_PREFIX,
  LLM_RECORD_KEY,
  LLM_RECORD_VERSION,
  LLM_TOOL_RESULT_KEY,
  markToolResult,
  parseLlmMarker,
  toolCallOptions,
  toolValueOf,
  TOOL_MARKER_PREFIX,
} from './marker';
export type { LlmMarker, ToolCallResult } from './marker';
export {
  createLlmRecord,
  llmRecordOf,
  outputTextOf,
  reasoningOf,
  recordLlmCall,
  toolCallsOf,
} from './record';
export type { LlmCallContext, RecordLlmCallOptions } from './record';
export { LLM_SEMCONV_VERSION } from './types';
export type {
  BlobPart,
  ChatMessage,
  FilePart,
  GenericPart,
  LlmAttributes,
  LlmCallResult,
  LlmConverter,
  LlmRecord,
  LlmToolExecution,
  MessagePart,
  ReasoningPart,
  TextPart,
  ToolCallRequestPart,
  ToolCallResponsePart,
  ToolDefinition,
  UriPart,
} from './types';
export { openaiChat } from './openai';
export { anthropicMessages } from './anthropic';
export { ollamaChat } from './ollama';
