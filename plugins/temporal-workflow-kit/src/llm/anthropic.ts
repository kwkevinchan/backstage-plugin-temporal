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
  isObject,
  Json,
  modalityOf,
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
 * Anthropic Messages (`POST /v1/messages`). The `system` parameter is
 * separate from the chat history, so it becomes
 * `gen_ai.system_instructions`. Thinking blocks become reasoning parts;
 * a user message with tool results only becomes a `tool` message.
 * Input tokens include the cached tokens, as the conventions ask.
 */

const STOP_REASONS: Record<string, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_call',
  refusal: 'content_filter',
  pause_turn: 'anthropic.pause_turn',
};

function sourcePart(source: Json, modality: string): MessagePart {
  if (source?.type === 'base64') {
    return compact({
      type: 'blob',
      modality: modalityOf(source.media_type) || modality,
      mime_type: source.media_type,
      content: String(source.data ?? ''),
    });
  }
  if (source?.type === 'url') {
    return { type: 'uri', modality, uri: String(source.url ?? '') };
  }
  if (source?.type === 'file') {
    return { type: 'file', modality, file_id: String(source.file_id ?? '') };
  }
  if (source?.type === 'text') {
    return { type: 'text', content: String(source.data ?? '') };
  }
  return { type: 'anthropic.source', source };
}

function blockParts(content: unknown): MessagePart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', content }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.filter(isObject).map((b): MessagePart => {
    switch (b.type) {
      case 'text':
        return { type: 'text', content: String(b.text ?? '') };
      case 'thinking':
        return { type: 'reasoning', content: String(b.thinking ?? '') };
      case 'redacted_thinking':
        return { type: 'anthropic.redacted_thinking' };
      case 'image':
        return sourcePart(b.source, 'image');
      case 'document':
        return sourcePart(b.source, 'document');
      case 'tool_use':
        return {
          type: 'tool_call',
          id: b.id,
          name: String(b.name ?? ''),
          arguments: b.input,
        };
      case 'tool_result':
        return compact({
          type: 'tool_call_response',
          id: b.tool_use_id,
          response:
            typeof b.content === 'string' ? b.content : blockParts(b.content),
          is_error: b.is_error === true ? true : undefined,
        });
      case 'server_tool_use':
        return {
          type: 'server_tool_call',
          id: b.id,
          name: String(b.name ?? ''),
          server_tool_call: {
            type: String(b.name ?? 'server_tool'),
            input: b.input,
          },
        };
      default:
        if (typeof b.type === 'string' && b.type.endsWith('_tool_result')) {
          return {
            type: 'server_tool_call_response',
            id: b.tool_use_id,
            server_tool_call_response: { type: b.type, content: b.content },
          };
        }
        return { ...b, type: `anthropic.${String(b.type)}` };
    }
  });
}

/** The value sent: an effort, else the thinking type. */
function reasoningLevel(r: Json): string | undefined {
  if (typeof r.output_config?.effort === 'string')
    return r.output_config.effort;
  if (isObject(r.thinking) && typeof r.thinking.type === 'string') {
    return r.thinking.type;
  }
  return undefined;
}

function toMessage(m: Json): ChatMessage {
  const parts = blockParts(m.content);
  const onlyResults =
    parts.length > 0 && parts.every(p => p.type === 'tool_call_response');
  return { role: onlyResults ? 'tool' : String(m.role ?? 'user'), parts };
}

/**
 * Converter of Anthropic Messages requests and responses (not streamed).
 *
 * @public
 */
export const anthropicMessages: LlmConverter<Json, Json> = {
  provider: 'anthropic',
  request(request): LlmAttributes {
    const r = isObject(request) ? request : {};
    const system = blockParts(r.system);
    return requestBase(r.model, {
      'gen_ai.request.temperature': num(r.temperature),
      'gen_ai.request.top_p': num(r.top_p),
      'gen_ai.request.top_k': num(r.top_k),
      'gen_ai.request.max_tokens': num(r.max_tokens),
      'gen_ai.request.stop_sequences': stopList(r.stop_sequences),
      'gen_ai.request.reasoning.level': reasoningLevel(r),
      'gen_ai.request.stream': r.stream === true ? true : undefined,
      'gen_ai.system_instructions': system.length > 0 ? system : undefined,
      'gen_ai.input.messages': Array.isArray(r.messages)
        ? r.messages.filter(isObject).map(toMessage)
        : undefined,
      'gen_ai.tool.definitions': Array.isArray(r.tools)
        ? r.tools.filter(isObject).map(t =>
            compact({
              type: t.input_schema ? 'function' : `anthropic.${String(t.type)}`,
              name: String(t.name ?? ''),
              description:
                typeof t.description === 'string' ? t.description : undefined,
              parameters: isObject(t.input_schema) ? t.input_schema : undefined,
            }),
          )
        : undefined,
    });
  },
  response(response): LlmAttributes {
    const r = isObject(response) ? response : {};
    const usage = isObject(r.usage) ? r.usage : {};
    const input = num(usage.input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    const reason =
      typeof r.stop_reason === 'string'
        ? STOP_REASONS[r.stop_reason] ?? r.stop_reason
        : undefined;
    return compact({
      'gen_ai.response.id': typeof r.id === 'string' ? r.id : undefined,
      'gen_ai.response.model':
        typeof r.model === 'string' ? r.model : undefined,
      'gen_ai.response.finish_reasons': reason ? [reason] : undefined,
      'gen_ai.usage.input_tokens':
        input === undefined
          ? undefined
          : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
      'gen_ai.usage.output_tokens': num(usage.output_tokens),
      'gen_ai.usage.cache_read.input_tokens': cacheRead || undefined,
      'gen_ai.usage.cache_write.input_tokens': cacheWrite || undefined,
      'gen_ai.output.messages': [
        { role: String(r.role ?? 'assistant'), parts: blockParts(r.content) },
      ],
    });
  },
};
