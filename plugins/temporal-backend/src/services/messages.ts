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
import { decodePayloads } from './convert';

// Arguments and results of the messages the plugin sends itself (queries),
// as JSON payloads like the default data converter.

interface Payload {
  metadata: Record<string, Uint8Array>;
  data: Uint8Array;
}

const JSON_ENCODING = Buffer.from('json/plain');

/** Encodes JSON values as `json/plain` payloads, like the default converter. */
export function encodeArgs(args: JsonValue[] | undefined): {
  payloads: Payload[];
} {
  return {
    payloads: (args ?? []).map(value => ({
      metadata: { encoding: JSON_ENCODING },
      data: Buffer.from(JSON.stringify(value)),
    })),
  };
}

/** Payloads in their JSON form: bytes as base64 text. */
function payloadsJson(payloads: any): any {
  if (payloads && typeof payloads.toJSON === 'function') {
    return payloads.toJSON();
  }
  const base64 = (v: unknown) =>
    v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v;
  return {
    payloads: (payloads?.payloads ?? []).map((p: any) => ({
      metadata: Object.fromEntries(
        Object.entries(p?.metadata ?? {}).map(([k, v]) => [k, base64(v)]),
      ),
      data: base64(p?.data),
    })),
  };
}

/**
 * The value of a result: decoded like the default data converter. A result
 * the backend cannot decode is described by its encoding and size.
 */
export function decodeResult(payloads: unknown): JsonValue | undefined {
  const decoded = decodePayloads(payloadsJson(payloads));
  if (decoded === undefined) return undefined;
  const one = (d: any): JsonValue =>
    d && typeof d === 'object' && 'value' in d ? d.value : d;
  return Array.isArray(decoded) ? decoded.map(one) : one(decoded);
}
