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

import {
  compact,
  functionTools,
  isObject,
  Json,
  num,
  requestBase,
  stopList,
} from './shared';
import type {
  ChatMessage,
  LlmAttributes,
  LlmConverter,
  MessagePart,
} from './types';

/*
 * Ollama chat (`POST /api/chat`). Ollama does not always give tool calls an
 * ID; the converter then uses `call_<n>` (position in the message, from 1),
 * the same in the response and in the request that sends the results back,
 * where tool messages are paired with the tool calls before them in order.
 * `gen_ai.provider.name` is `ollama` (not a well-known value).
 */

const DONE_REASONS: Record<string, string> = {
  stop: 'stop',
  length: 'length',
  load: 'ollama.load',
  unload: 'ollama.unload',
};

/** `think: true` or a level (`low`, `medium`, `high`). */
function thinkLevel(think: unknown): string | undefined {
  if (think === true) return 'on';
  return typeof think === 'string' ? think : undefined;
}

function toolCallId(call: Json, index: number): string {
  return typeof call?.id === 'string' && call.id
    ? call.id
    : `call_${index + 1}`;
}

function assistantParts(m: Json): MessagePart[] {
  const parts: MessagePart[] = [];
  if (typeof m.thinking === 'string' && m.thinking) {
    parts.push({ type: 'reasoning', content: m.thinking });
  }
  if (typeof m.content === 'string' && m.content) {
    parts.push({ type: 'text', content: m.content });
  }
  (Array.isArray(m.tool_calls) ? m.tool_calls : []).forEach(
    (call: Json, i: number) => {
      parts.push({
        type: 'tool_call',
        id: toolCallId(call, i),
        name: String(call?.function?.name ?? ''),
        arguments: call?.function?.arguments,
      });
    },
  );
  return parts;
}

function userParts(m: Json): MessagePart[] {
  const parts: MessagePart[] = [];
  if (typeof m.content === 'string' && m.content) {
    parts.push({ type: 'text', content: m.content });
  }
  for (const image of Array.isArray(m.images) ? m.images : []) {
    parts.push({ type: 'blob', modality: 'image', content: String(image) });
  }
  return parts;
}

function toMessages(messages: Json[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  // Tool calls of the last assistant message, for tool messages without an ID.
  let pending: string[] = [];
  for (const m of messages.filter(isObject)) {
    const role = String(m.role ?? 'user');
    if (role === 'assistant') {
      const parts = assistantParts(m);
      pending = parts
        .filter(p => p.type === 'tool_call')
        .map(p => String(p.id));
      out.push({ role, parts });
      continue;
    }
    if (role === 'tool') {
      const id =
        typeof m.tool_call_id === 'string' ? m.tool_call_id : pending.shift();
      out.push({
        role: 'tool',
        parts: [
          compact({
            type: 'tool_call_response',
            id,
            response: m.content,
            name: typeof m.tool_name === 'string' ? m.tool_name : undefined,
          }),
        ],
      });
      continue;
    }
    out.push({ role, parts: userParts(m) });
  }
  return out;
}

/**
 * Converter of Ollama `/api/chat` requests and responses (`stream: false`).
 *
 * @public
 */
export const ollamaChat: LlmConverter<Json, Json> = {
  provider: 'ollama',
  request(request): LlmAttributes {
    const r = isObject(request) ? request : {};
    const o = isObject(r.options) ? r.options : {};
    return requestBase(r.model, {
      'gen_ai.request.temperature': num(o.temperature),
      'gen_ai.request.top_p': num(o.top_p),
      'gen_ai.request.top_k': num(o.top_k),
      'gen_ai.request.max_tokens': num(o.num_predict),
      'gen_ai.request.seed': num(o.seed),
      'gen_ai.request.stop_sequences': stopList(o.stop),
      'gen_ai.request.reasoning.level': thinkLevel(r.think),
      'gen_ai.request.stream': r.stream === false ? undefined : true,
      'gen_ai.input.messages': Array.isArray(r.messages)
        ? toMessages(r.messages)
        : undefined,
      'gen_ai.tool.definitions': functionTools(r.tools),
    });
  },
  response(response): LlmAttributes {
    const r = isObject(response) ? response : {};
    const reason =
      typeof r.done_reason === 'string'
        ? DONE_REASONS[r.done_reason] ?? r.done_reason
        : undefined;
    const parts = isObject(r.message) ? assistantParts(r.message) : [];
    // Ollama ends a tool call with `stop`; the conventions call it tool_call.
    const toolCall =
      parts.some(p => p.type === 'tool_call') && reason === 'stop';
    const final = toolCall ? 'tool_call' : reason;
    const reasons = final ? [final] : undefined;
    return compact({
      'gen_ai.response.model':
        typeof r.model === 'string' ? r.model : undefined,
      'gen_ai.response.finish_reasons': reasons,
      'gen_ai.usage.input_tokens': num(r.prompt_eval_count),
      'gen_ai.usage.output_tokens': num(r.eval_count),
      'gen_ai.output.messages': [{ role: 'assistant', parts }],
    });
  },
};
