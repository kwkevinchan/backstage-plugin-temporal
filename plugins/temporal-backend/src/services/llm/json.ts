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

/* Small readers of decoded JSON that the LLM adapters share. */

export type Json = any;

export function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, else undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A count: a non-negative number (or numeric text), rounded. */
export function int(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
    ? Math.round(n)
    : undefined;
}

/** A JSON value that may be stored as JSON text. */
export function structured(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/** JSON text of a value with sorted object keys, for comparing values. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObject(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map(k => [k, sort(v[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value ?? null));
}
