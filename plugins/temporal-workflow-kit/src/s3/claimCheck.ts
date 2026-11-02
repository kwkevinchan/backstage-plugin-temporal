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

import { createHash } from 'node:crypto';

/**
 * A Temporal payload: metadata and data as bytes. Same shape as `Payload`
 * of `@temporalio/common`, so the codec works with any SDK version without
 * depending on it.
 *
 * @public
 */
export interface Payload {
  metadata?: Record<string, Uint8Array> | null;
  data?: Uint8Array | null;
}

/**
 * Value of the `encoding` metadata of a claim check payload.
 *
 * @public
 */
export const CLAIM_CHECK_ENCODING = 'json/claim-check';

/**
 * Version of the claim check format written by this package.
 *
 * @public
 */
export const CLAIM_CHECK_VERSION = 1;

/**
 * What a claim check payload holds instead of the data: where the data is
 * stored and how to restore the original payload. The payload data is this
 * object as JSON.
 *
 * @public
 */
export interface ClaimCheck {
  /** Format version, {@link CLAIM_CHECK_VERSION}. */
  version: number;
  /** Storage protocol. Only `s3` is defined. */
  store: 's3';
  bucket: string;
  key: string;
  /** Size of the stored data in bytes. */
  size: number;
  /** SHA-256 of the stored data, lowercase hex. */
  sha256: string;
  /** `encoding` metadata of the original payload, for example `json/plain`. */
  encoding: string;
  /** Media type of the stored data, for example `application/json`. */
  contentType: string;
  /** Other metadata of the original payload, values in base64. */
  metadata?: Record<string, string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Lowercase hex SHA-256 of bytes.
 *
 * @public
 */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The `encoding` metadata of a payload, or an empty string. */
export function payloadEncoding(payload: Payload): string {
  const raw = payload.metadata?.encoding;
  return raw ? decoder.decode(raw) : '';
}

/**
 * True when the payload is a claim check written by this package.
 *
 * @public
 */
export function isClaimCheckPayload(payload: Payload): boolean {
  return payloadEncoding(payload) === CLAIM_CHECK_ENCODING;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Validates a parsed claim check. Throws a `TypeError` for anything that is
 * not a version 1 S3 claim check.
 *
 * @public
 */
export function validateClaimCheck(value: unknown): ClaimCheck {
  const v = value as Partial<ClaimCheck> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new TypeError('Claim check is not an object');
  }
  if (v.version !== CLAIM_CHECK_VERSION) {
    throw new TypeError(`Unsupported claim check version: ${v.version}`);
  }
  if (v.store !== 's3') {
    throw new TypeError(`Unsupported claim check store: ${v.store}`);
  }
  for (const field of ['bucket', 'key', 'encoding', 'contentType'] as const) {
    if (typeof v[field] !== 'string' || !v[field]) {
      throw new TypeError(`Claim check has no ${field}`);
    }
  }
  if (!Number.isSafeInteger(v.size) || (v.size as number) < 0) {
    throw new TypeError('Claim check has an invalid size');
  }
  if (typeof v.sha256 !== 'string' || !HEX_64.test(v.sha256)) {
    throw new TypeError('Claim check has an invalid sha256');
  }
  if (v.metadata !== undefined) {
    if (
      typeof v.metadata !== 'object' ||
      v.metadata === null ||
      Object.values(v.metadata).some(m => typeof m !== 'string')
    ) {
      throw new TypeError('Claim check has invalid metadata');
    }
  }
  return v as ClaimCheck;
}

/**
 * Reads the claim check of a claim check payload (data parsed as JSON and
 * validated).
 *
 * @public
 */
export function parseClaimCheck(payload: Payload): ClaimCheck {
  if (!isClaimCheckPayload(payload)) {
    throw new TypeError('Payload is not a claim check');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payload.data ?? new Uint8Array()));
  } catch {
    throw new TypeError('Claim check is not valid JSON');
  }
  return validateClaimCheck(parsed);
}

/** The claim check payload that stands in for the stored data. */
export function claimCheckPayload(check: ClaimCheck): Payload {
  return {
    metadata: { encoding: encoder.encode(CLAIM_CHECK_ENCODING) },
    data: encoder.encode(JSON.stringify(check)),
  };
}

/** The original payload, from its claim check and the stored data. */
export function restorePayload(check: ClaimCheck, data: Uint8Array): Payload {
  const metadata: Record<string, Uint8Array> = {
    encoding: encoder.encode(check.encoding),
  };
  for (const [key, value] of Object.entries(check.metadata ?? {})) {
    if (key !== 'encoding') metadata[key] = Buffer.from(value, 'base64');
  }
  return { metadata, data };
}

/** Other metadata of a payload than `encoding`, in base64. */
export function extraMetadata(
  payload: Payload,
): Record<string, string> | undefined {
  const entries = Object.entries(payload.metadata ?? {}).filter(
    ([key]) => key !== 'encoding',
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([key, value]) => [key, Buffer.from(value).toString('base64')]),
  );
}

const SIGNATURES: { type: string; bytes: number[]; offset?: number }[] = [
  {
    type: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: 'application/gzip', bytes: [0x1f, 0x8b] },
  { type: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
];

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  if (data.length < offset + bytes.length) return false;
  return bytes.every((b, i) => data[offset + i] === b);
}

/**
 * Media type of payload data: the `contentType` metadata when the payload
 * has one, JSON for `json/*` encodings, the type of well-known binary files
 * (PNG, JPEG, GIF, WebP, PDF, gzip, zip) from their first bytes, and
 * `application/octet-stream` for anything else.
 *
 * @public
 */
export function detectContentType(payload: Payload): string {
  const explicit = payload.metadata?.contentType;
  if (explicit && explicit.length > 0) return decoder.decode(explicit);
  const encoding = payloadEncoding(payload);
  if (encoding.startsWith('json/')) return 'application/json';
  const data = payload.data ?? new Uint8Array();
  if (
    startsWith(data, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  for (const signature of SIGNATURES) {
    if (startsWith(data, signature.bytes, signature.offset)) {
      return signature.type;
    }
  }
  return 'application/octet-stream';
}
