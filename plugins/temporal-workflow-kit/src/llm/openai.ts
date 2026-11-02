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
  parseArguments,
  requestBase,
  stopList,
  urlPart,
} from './shared';
import type {
  ChatMessage,
  LlmAttributes,
  LlmConverter,
  MessagePart,
} from './types';

/*
 * OpenAI Chat Completions (`POST /v1/chat/completions`) and compatible APIs
 * (vLLM, LiteLLM, DeepSeek, ...). System and developer messages are part of
 * the chat history, so they stay in `gen_ai.input.messages`, as the
 * conventions ask. `reasoning_content` (DeepSeek, vLLM) and `reasoning`
 * (OpenRouter) become reasoning parts.
 */

const FINISH_REASONS: Record<string, string> = {
  stop: 'stop',
  length: 'length',
  content_filter: 'content_filter',
  tool_calls: 'tool_call',
  function_call: 'tool_call',
};

function contentParts(content: unknown): MessagePart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', content }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.filter(isObject).map((p): MessagePart => {
    switch (p.type) {
      case 'text':
        return { type: 'text', content: String(p.text ?? '') };
      case 'image_url':
        return urlPart(String(p.image_url?.url ?? ''), 'image');
      case 'input_audio':
        return compact({
          type: 'blob',
          modality: 'audio',
          mime_type: p.input_audio?.format
            ? `audio/${p.input_audio.format}`
            : undefined,
          content: String(p.input_audio?.data ?? ''),
        });
      case 'file':
        return p.file?.file_id
          ? {
              type: 'file',
              modality: 'document',
              file_id: String(p.file.file_id),
            }
          : compact({
              type: 'blob',
              modality: 'document',
              content: String(p.file?.file_data ?? ''),
              filename: p.file?.filename,
            });
      case 'refusal':
        return { type: 'openai.refusal', content: String(p.refusal ?? '') };
      default:
        return { ...p, type: `openai.${String(p.type)}` };
    }
  });
}

function assistantParts(m: Json): MessagePart[] {
  const parts: MessagePart[] = [];
  const reasoning = m.reasoning_content ?? m.reasoning;
  if (typeof reasoning === 'string' && reasoning) {
    parts.push({ type: 'reasoning', content: reasoning });
  }
  parts.push(...contentParts(m.content));
  if (typeof m.refusal === 'string' && m.refusal) {
    parts.push({ type: 'openai.refusal', content: m.refusal });
  }
  for (const call of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
    if (!isObject(call)) continue;
    parts.push(
      compact({
        type: 'tool_call',
        id: typeof call.id === 'string' ? call.id : undefined,
        name: String(call.function?.name ?? call.custom?.name ?? ''),
        arguments: parseArguments(
          call.function?.arguments ?? call.custom?.input,
        ),
      }),
    );
  }
  if (isObject(m.function_call)) {
    parts.push({
      type: 'tool_call',
      name: String(m.function_call.name ?? ''),
      arguments: parseArguments(m.function_call.arguments),
    });
  }
  return parts;
}

function toMessage(m: Json): ChatMessage {
  const role = String(m.role ?? 'user');
  if (role === 'tool' || role === 'function') {
    return {
      role: 'tool',
      parts: [
        compact({
          type: 'tool_call_response',
          id: typeof m.tool_call_id === 'string' ? m.tool_call_id : undefined,
          response:
            typeof m.content === 'string'
              ? parseArguments(m.content)
              : contentParts(m.content),
        }),
      ],
    };
  }
  const message: ChatMessage = {
    role,
    parts: role === 'assistant' ? assistantParts(m) : contentParts(m.content),
  };
  if (typeof m.name === 'string') message.name = m.name;
  return message;
}

/**
 * Converter of OpenAI chat completion requests and responses (not
 * streamed; collect a stream into the response shape first).
 *
 * @public
 */
export const openaiChat: LlmConverter<Json, Json> = {
  provider: 'openai',
  request(request): LlmAttributes {
    const r = isObject(request) ? request : {};
    return requestBase(r.model, {
      'gen_ai.request.temperature': num(r.temperature),
      'gen_ai.request.top_p': num(r.top_p),
      'gen_ai.request.max_tokens': num(r.max_completion_tokens ?? r.max_tokens),
      'gen_ai.request.seed': num(r.seed),
      'gen_ai.request.frequency_penalty': num(r.frequency_penalty),
      'gen_ai.request.presence_penalty': num(r.presence_penalty),
      'gen_ai.request.choice.count':
        num(r.n) !== undefined && r.n !== 1 ? r.n : undefined,
      'gen_ai.request.stop_sequences': stopList(r.stop),
      'gen_ai.request.reasoning.level':
        typeof r.reasoning_effort === 'string' ? r.reasoning_effort : undefined,
      'gen_ai.request.stream': r.stream === true ? true : undefined,
      'gen_ai.input.messages': Array.isArray(r.messages)
        ? r.messages.filter(isObject).map(toMessage)
        : undefined,
      'gen_ai.tool.definitions': functionTools(r.tools),
    });
  },
  response(response): LlmAttributes {
    const r = isObject(response) ? response : {};
    const choices: Json[] = Array.isArray(r.choices) ? r.choices : [];
    const usage = isObject(r.usage) ? r.usage : {};
    const reasons = choices
      .map(c => c?.finish_reason)
      .filter((x): x is string => typeof x === 'string')
      .map(x => FINISH_REASONS[x] ?? x);
    return compact({
      'gen_ai.response.id': typeof r.id === 'string' ? r.id : undefined,
      'gen_ai.response.model':
        typeof r.model === 'string' ? r.model : undefined,
      'gen_ai.response.finish_reasons':
        reasons.length > 0 ? reasons : undefined,
      'gen_ai.usage.input_tokens': num(usage.prompt_tokens),
      'gen_ai.usage.output_tokens': num(usage.completion_tokens),
      'gen_ai.usage.reasoning.output_tokens': num(
        usage.completion_tokens_details?.reasoning_tokens,
      ),
      'gen_ai.usage.cache_read.input_tokens': num(
        usage.prompt_tokens_details?.cached_tokens,
      ),
      'gen_ai.output.messages': choices
        .filter(isObject)
        .map(c => toMessage({ role: 'assistant', ...c.message })),
    });
  },
};
