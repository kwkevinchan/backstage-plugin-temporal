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
 * The activity ID marker of LLM steps. The format is a specification:
 * workflows written with other SDKs follow it by hand, and the Backstage
 * backend reads it from the history without a payload codec.
 *
 *   llm/<call>[/<rest>]                 a model call
 *   tool/<call>/<toolCallId>[/<rest>]   a tool call of that model call
 */

/** First segment of the activity ID of a model call. @public */
export const LLM_MARKER_PREFIX = 'llm';
/** First segment of the activity ID of a tool call. @public */
export const TOOL_MARKER_PREFIX = 'tool';
/** Key of the record in the result of a model call. @public */
export const LLM_RECORD_KEY = 'temporal.llm';
/** Key of the tool marker in the result of a tool call (local activities). @public */
export const LLM_TOOL_RESULT_KEY = 'temporal.llm.tool';
/** Version of the record format. @public */
export const LLM_RECORD_VERSION = 1;

/**
 * A model call or a tool call of one.
 *
 * @public
 */
export type LlmMarker =
  | { kind: 'llm'; call: string }
  | { kind: 'tool'; call: string; toolCallId: string };

function segment(name: string, what: string): string {
  if (!name) throw new TypeError(`The ${what} must not be empty`);
  return encodeURIComponent(name);
}

function withRest(base: string, rest?: string): string {
  return rest ? `${base}/${rest}` : base;
}

/**
 * The activity ID of a model call, `llm/<call>[/<rest>]`. `call` names the
 * call, unique in the run (for example `agent-3`); `rest` is anything else,
 * for example a loop marker.
 *
 * @public
 */
export function formatLlmActivityId(call: string, rest?: string): string {
  if (call === 'loop') throw new TypeError('The call must not be "loop"');
  return withRest(`${LLM_MARKER_PREFIX}/${segment(call, 'call')}`, rest);
}

/**
 * The activity ID of a tool call, `tool/<call>/<toolCallId>[/<rest>]`.
 * `toolCallId` is the ID the model gave the tool call.
 *
 * @public
 */
export function formatToolActivityId(
  call: string,
  toolCallId: string,
  rest?: string,
): string {
  if (call === 'loop') throw new TypeError('The call must not be "loop"');
  return withRest(
    `${TOOL_MARKER_PREFIX}/${segment(call, 'call')}/${segment(
      toolCallId,
      'tool call ID',
    )}`,
    rest,
  );
}

const LLM_PATTERN = /^llm\/([^/]+)(?:\/|$)/;
const TOOL_PATTERN = /^tool\/([^/]+)\/([^/]+)(?:\/|$)/;

/**
 * Reads the marker of an activity ID, or undefined.
 *
 * @public
 */
export function parseLlmMarker(activityId: string): LlmMarker | undefined {
  try {
    const llm = LLM_PATTERN.exec(activityId);
    if (llm) return { kind: 'llm', call: decodeURIComponent(llm[1]) };
    const tool = TOOL_PATTERN.exec(activityId);
    if (tool) {
      return {
        kind: 'tool',
        call: decodeURIComponent(tool[1]),
        toolCallId: decodeURIComponent(tool[2]),
      };
    }
  } catch {
    // Not percent-encoded.
  }
  return undefined;
}

/**
 * Activity options for a model call: `activityId` becomes
 * `llm/<call>/<the activityId of options>`. Works with the options of a
 * loop round (`round.activityOptions(...)`), so the call shows in the
 * round. Use the options for one call: the activity ID must be unique
 * among the open activities.
 *
 * @public
 */
export function llmCallOptions<T extends { activityId?: string }>(
  call: string,
  options: T,
): T & { activityId: string } {
  return {
    ...options,
    activityId: formatLlmActivityId(call, options.activityId),
  };
}

/**
 * Activity options for a tool call of the model call `call`.
 *
 * @public
 */
export function toolCallOptions<T extends { activityId?: string }>(
  call: string,
  toolCallId: string,
  options: T,
): T & { activityId: string } {
  return {
    ...options,
    activityId: formatToolActivityId(call, toolCallId, options.activityId),
  };
}

/**
 * The result of a tool call with the tool marker, for local activities:
 * Backstage cannot read their activity ID in every SDK, so it reads the
 * marker from the result. Unwrap it with `toolValueOf`.
 *
 * @public
 */
export interface ToolCallResult<T> {
  'temporal.llm.tool': { call: string; toolCallId: string; name?: string };
  value: T;
}

/** Adds the tool marker to a tool's result (local activities). @public */
export function markToolResult<T>(
  marker: { call: string; toolCallId: string; name?: string },
  value: T,
): ToolCallResult<T> {
  return { [LLM_TOOL_RESULT_KEY]: { ...marker }, value } as ToolCallResult<T>;
}

/** The value of a tool result with or without the tool marker. @public */
export function toolValueOf<T>(result: ToolCallResult<T> | T): T {
  if (
    result &&
    typeof result === 'object' &&
    LLM_TOOL_RESULT_KEY in (result as object)
  ) {
    return (result as ToolCallResult<T>).value;
  }
  return result as T;
}
