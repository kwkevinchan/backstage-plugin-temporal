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

/** Maximum nesting depth canonicalJson traverses before treating a value as non-comparable. */
export const MAX_CANONICAL_JSON_DEPTH = 64;

/**
 * JSON text of a value with sorted object keys, for comparing values.
 * Returns `undefined` when nesting exceeds `maxDepth` (default 64) so a deeply
 * nested payload never overflows the call stack.
 */
export function canonicalJson(
  value: unknown,
  maxDepth = MAX_CANONICAL_JSON_DEPTH,
): string | undefined {
  let exceeded = false;
  const sort = (v: unknown, depth: number): unknown => {
    if (exceeded) return undefined;
    if (Array.isArray(v)) {
      if (depth >= maxDepth) {
        exceeded = true;
        return undefined;
      }
      return v.map(item => sort(item, depth + 1));
    }
    if (isObject(v)) {
      if (depth >= maxDepth) {
        exceeded = true;
        return undefined;
      }
      const keys = Object.keys(v).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        out[k] = sort(v[k], depth + 1);
        if (exceeded) return undefined;
      }
      return out;
    }
    return v;
  };
  const sorted = sort(value ?? null, 0);
  if (exceeded) return undefined;
  return JSON.stringify(sorted);
}
