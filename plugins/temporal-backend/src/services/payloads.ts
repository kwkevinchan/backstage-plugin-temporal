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

import type { JsonValue } from '@backstage/types';

/**
 * A Temporal payload, as the client sends it: metadata and data as bytes.
 */
export interface TemporalJsonPayload {
  metadata: Record<string, Uint8Array>;
  data: Uint8Array;
}

const JSON_ENCODING = Buffer.from('json/plain');

/**
 * Encodes JSON values as `json/plain` payloads, like the default data
 * converter of the Temporal SDKs: the arguments of the signals, updates,
 * queries and starts the plugin and its modules send.
 */
export function encodeJsonPayloads(args: JsonValue[] | undefined): {
  payloads: TemporalJsonPayload[];
} {
  return {
    payloads: (args ?? []).map(value => ({
      metadata: { encoding: JSON_ENCODING },
      data: Buffer.from(JSON.stringify(value)),
    })),
  };
}

/** Bytes as the client gives them, or base64 text (protobuf JSON). */
function bytesOf(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  return Buffer.alloc(0);
}

/** The value of one payload, like the default data converter. */
function decodeJsonPayload(payload: any): JsonValue {
  const encoding = bytesOf(payload?.metadata?.encoding).toString('utf8');
  const data = bytesOf(payload?.data);
  if (encoding === 'binary/null') return null;
  if (encoding === 'json/plain' || encoding === 'json/protobuf') {
    try {
      return JSON.parse(data.toString('utf8')) as JsonValue;
    } catch {
      // described below
    }
  }
  // Binary data or a payload codec (for example encryption): describe it.
  return { encoding, size: data.length, undecodable: true };
}

/**
 * Decodes the payloads of a result (an update, a query) like the default
 * data converter: one payload becomes its value, several an array, none
 * undefined. A payload that is not JSON (binary data, or encoded by a
 * payload codec) is described by its encoding and size with
 * `undecodable: true`. Takes the payloads as the client gives them (bytes)
 * or in their protobuf JSON form (base64 text).
 */
export function decodeJsonPayloads(payloads: unknown): JsonValue | undefined {
  const list: unknown[] = (payloads as any)?.payloads ?? [];
  if (list.length === 0) return undefined;
  const values = list.map(decodeJsonPayload);
  return values.length === 1 ? values[0] : values;
}
