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

import type { LlmAttributes, MessagePart, ToolDefinition } from './types';

/* Helpers of the converters. They only read data shapes. */

export type Json = any;

export function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tool call arguments: JSON text becomes the object, other text stays. */
export function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** A `data:` URL as a blob part, any other URL as a URI part. */
export function urlPart(url: string, modality: string): MessagePart {
  const data = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (data) {
    return compact({
      type: 'blob',
      modality,
      mime_type: data[1],
      content: data[2] ? data[3] : encodeBase64(decodeURIComponent(data[3])),
    });
  }
  return { type: 'uri', modality, uri: url };
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The modality of a media type, for blob parts. */
export function modalityOf(mimeType: string | undefined): string {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/** Number attributes that are numbers; others are left out. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function stopList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string');
  return undefined;
}

/** `{ type: 'function', function: { name, description, parameters } }`. */
export function functionTools(tools: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.filter(isObject).map(t => {
    const f = isObject(t.function) ? t.function : t;
    return compact({
      type: typeof t.type === 'string' ? t.type : 'function',
      name: String(f.name ?? ''),
      description:
        typeof f.description === 'string' ? f.description : undefined,
      parameters: isObject(f.parameters) ? f.parameters : undefined,
    });
  });
}

/** Request attributes shared by the converters. */
export function requestBase(
  model: unknown,
  extra: LlmAttributes,
): LlmAttributes {
  return compact({
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': typeof model === 'string' ? model : undefined,
    ...extra,
  });
}
