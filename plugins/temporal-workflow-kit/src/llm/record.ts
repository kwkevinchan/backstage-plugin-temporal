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

import { LLM_RECORD_KEY } from './marker';
import {
  ChatMessage,
  LLM_SEMCONV_VERSION,
  LlmAttributes,
  LlmCallResult,
  LlmConverter,
  LlmRecord,
  LlmToolExecution,
  ToolCallRequestPart,
} from './types';

/*
 * Recording model calls in activities. `recordLlmCall` runs the call and
 * returns `{ "temporal.llm": <record>, value }`: the record holds the
 * OpenTelemetry attributes of the call (model, messages, reasoning, tool
 * calls, tokens), its start, duration and error. No LLM SDK is used; the
 * converters only read the shape of requests and responses.
 */

function errorInfo(error: unknown): { type?: string; message: string } {
  if (error instanceof Error) {
    const type =
      (error as { type?: unknown }).type ??
      (error.name && error.name !== 'Error' ? error.name : undefined);
    return typeof type === 'string' && type
      ? { type, message: error.message }
      : { message: error.message };
  }
  return { message: String(error) };
}

/** Drops attributes that are undefined. */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/**
 * A record from attributes you collected yourself.
 *
 * @public
 */
export function createLlmRecord(
  attributes: LlmAttributes,
  extra: Omit<LlmRecord, 'v' | 'semconv' | 'attributes'> = {},
): LlmRecord {
  return compact({
    v: 1 as const,
    semconv: LLM_SEMCONV_VERSION,
    attributes: compact({ 'gen_ai.operation.name': 'chat', ...attributes }),
    ...extra,
  });
}

/**
 * Runs tools inside the model call's activity and records them.
 *
 * @public
 */
export interface LlmCallContext {
  /**
   * Runs one tool and adds it to the record's `toolExecutions` (the
   * attributes of an `execute_tool` span). Errors are recorded and thrown.
   */
  runTool<T>(
    call: { id?: string; name: string; arguments?: unknown },
    run: () => Promise<T> | T,
  ): Promise<T>;
}

/**
 * Options of {@link recordLlmCall}.
 *
 * @public
 */
export interface RecordLlmCallOptions<Req, Res, V> {
  /** The request to the model. */
  request: Req;
  /** Calls the model, for example with the provider's SDK. */
  call(request: Req, context: LlmCallContext): Promise<Res>;
  /** Reads request and response, for example `openaiChat`. */
  convert?: LlmConverter<Req, Res>;
  /** More attributes, for example `gen_ai.conversation.id`. */
  attributes?: LlmAttributes;
  /**
   * The `value` of the result. Default: the response. Return undefined to
   * keep the result small (the record has the output messages).
   */
  value?(response: Res): V;
  /**
   * Called when the call throws, with the record of the failed call.
   * Return the error to throw; for example in TypeScript
   * `(err, record) => ApplicationFailure.fromError(err, { details: [record] })`
   * keeps the record in the history (Backstage reads it from the failure
   * details). Default: the error, with the record in its `llm` property.
   */
  onError?(error: unknown, result: LlmCallResult<never>): unknown;
  /** Clock, for tests. */
  now?(): number;
}

/**
 * Runs one model call and returns `{ "temporal.llm": record, value }`.
 * Use it as the return value of the activity whose ID is
 * `llm/<call>/...` (see `llmCallOptions`).
 *
 * @public
 */
export async function recordLlmCall<Req, Res, V = Res>(
  options: RecordLlmCallOptions<Req, Res, V>,
): Promise<LlmCallResult<V>> {
  const now = options.now ?? Date.now;
  const start = now();
  const toolExecutions: LlmToolExecution[] = [];
  const context: LlmCallContext = {
    async runTool(call, run) {
      const started = now();
      const execution: LlmToolExecution = compact({
        'gen_ai.tool.call.id': call.id,
        'gen_ai.tool.name': call.name,
        'gen_ai.tool.type': 'function',
        'gen_ai.tool.call.arguments': call.arguments,
      });
      toolExecutions.push(execution);
      try {
        const result = await run();
        execution['gen_ai.tool.call.result'] = result;
        return result;
      } catch (error) {
        const info = errorInfo(error);
        execution.error = info;
        execution['error.type'] = info.type ?? 'Error';
        throw error;
      } finally {
        execution.durationMs = Math.max(0, now() - started);
      }
    },
  };
  const requestAttributes = options.convert?.request(options.request) ?? {};
  const base: LlmAttributes = {
    'gen_ai.provider.name': options.convert?.provider,
    ...requestAttributes,
    ...options.attributes,
  };
  const record = (attributes: LlmAttributes, error?: unknown) =>
    createLlmRecord(attributes, {
      startTime: new Date(start).toISOString(),
      durationMs: Math.max(0, now() - start),
      error: error === undefined ? undefined : errorInfo(error),
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
    });
  let response: Res;
  try {
    response = await options.call(options.request, context);
  } catch (error) {
    const info = errorInfo(error);
    const failed = {
      [LLM_RECORD_KEY]: record(
        { ...base, 'error.type': info.type ?? 'Error' },
        error,
      ),
    } as LlmCallResult<never>;
    if (options.onError) throw options.onError(error, failed);
    if (error && typeof error === 'object') {
      (error as { llm?: unknown }).llm = failed[LLM_RECORD_KEY];
    }
    throw error;
  }
  const attributes: LlmAttributes = {
    ...base,
    ...(options.convert?.response(response) ?? {}),
    ...options.attributes,
  };
  const result = {
    [LLM_RECORD_KEY]: record(attributes),
  } as LlmCallResult<V>;
  const value = options.value
    ? options.value(response)
    : (response as unknown as V);
  if (value !== undefined) result.value = value;
  return result;
}

/** The record in an activity result, or undefined. @public */
export function llmRecordOf(result: unknown): LlmRecord | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = (result as Record<string, unknown>)[LLM_RECORD_KEY];
  return record && typeof record === 'object'
    ? (record as LlmRecord)
    : undefined;
}

function outputMessages(
  result: LlmCallResult | LlmRecord | undefined,
): ChatMessage[] {
  const record =
    result && 'attributes' in result
      ? (result as LlmRecord)
      : llmRecordOf(result);
  const messages = record?.attributes['gen_ai.output.messages'];
  return Array.isArray(messages) ? messages : [];
}

/**
 * The tool calls the model asked for, in order. For the workflow: run each
 * as an activity with `toolCallOptions(call, toolCall.id, ...)`.
 *
 * @public
 */
export function toolCallsOf(
  result: LlmCallResult | LlmRecord | undefined,
): ToolCallRequestPart[] {
  return outputMessages(result).flatMap(m =>
    m.parts.filter((p): p is ToolCallRequestPart => p.type === 'tool_call'),
  );
}

/** The text of the output, parts joined with a blank line. @public */
export function outputTextOf(
  result: LlmCallResult | LlmRecord | undefined,
): string {
  return outputMessages(result)
    .flatMap(m => m.parts)
    .filter(p => p.type === 'text')
    .map(p => String((p as { content?: unknown }).content ?? ''))
    .join('\n\n');
}

/** The reasoning (thinking) of the output. @public */
export function reasoningOf(
  result: LlmCallResult | LlmRecord | undefined,
): string {
  return outputMessages(result)
    .flatMap(m => m.parts)
    .filter(p => p.type === 'reasoning')
    .map(p => String((p as { content?: unknown }).content ?? ''))
    .join('\n\n');
}
