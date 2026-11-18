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

import type { ExternalPayload } from '../common';

/*
 * References to payloads in Temporal External Storage (the SDKs'
 * `ExternalStorage` with the S3 driver, public preview): large payloads are
 * stored in S3 and the history holds a reference payload instead. The
 * backend only reads the reference, to show where the payload is; it never
 * reads the stored object. `storageReference.test.ts` checks the parser
 * against references written by the official S3 driver.
 *
 * A reference payload has the metadata `encoding: json/protobuf` and
 * `messageType: temporal.api.sdk.v1.ExternalStorageReference`, and its data
 * is the JSON form of that message:
 *
 *   { "driverName": "aws.s3driver",
 *     "claimData": { "bucket": "…", "key": "v0/…/d/sha256/<hex>",
 *                    "hash_algorithm": "sha256", "hash_value": "<hex>" } }
 *
 * `externalPayloads[0].sizeBytes` is the size of the stored payload, and
 * `hash_value` is the SHA-256 of the stored object.
 */

/** `encoding` metadata of a reference payload. */
export const REFERENCE_ENCODING = 'json/protobuf';
/** `messageType` metadata of a reference payload. */
const REFERENCE_MESSAGE_TYPE = 'temporal.api.sdk.v1.ExternalStorageReference';

/** Where a payload is stored, read from its reference payload. */
export interface StorageReference {
  bucket: string;
  key: string;
  /** SHA-256 of the stored object, lowercase hex. */
  sha256: string;
  /** Size of the stored payload in bytes (0 when the reference has none). */
  sizeBytes: number;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Validates the JSON data of a reference payload (an S3 driver claim).
 * Throws a `TypeError` for anything else. Both spellings of the hash fields
 * are read (`hash_value`, and `hashValue` of earlier SDK versions).
 */
export function parseStorageReference(
  value: unknown,
  sizeBytes = 0,
): StorageReference {
  const v = value as {
    driverName?: unknown;
    claimData?: Record<string, unknown>;
  } | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new TypeError('Storage reference is not an object');
  }
  if (typeof v.driverName !== 'string' || !v.driverName) {
    throw new TypeError('Storage reference has no driverName');
  }
  const claim = v.claimData;
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('Storage reference has no claimData');
  }
  const bucket = claim.bucket;
  const key = claim.key;
  const algorithm = claim.hash_algorithm ?? claim.hashAlgorithm;
  const hash = claim.hash_value ?? claim.hashValue;
  if (typeof bucket !== 'string' || !bucket) {
    throw new TypeError('Storage reference has no bucket');
  }
  if (typeof key !== 'string' || !key) {
    throw new TypeError('Storage reference has no key');
  }
  if (algorithm !== 'sha256') {
    throw new TypeError(`Unsupported hash algorithm: ${String(algorithm)}`);
  }
  if (typeof hash !== 'string' || !HEX_64.test(hash)) {
    throw new TypeError('Storage reference has an invalid hash');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new TypeError('Storage reference has an invalid size');
  }
  return { bucket, key, sha256: hash, sizeBytes };
}

function decodeBase64(value: unknown): string {
  return typeof value === 'string'
    ? Buffer.from(value, 'base64').toString('utf8')
    : '';
}

function sizeBytesOf(payload: any): number {
  const size = Number(payload?.externalPayloads?.[0]?.sizeBytes ?? 0);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

/** The storage reference of a payload in protobuf JSON form, if it is one. */
export function referenceOf(payload: any): StorageReference | undefined {
  if (
    decodeBase64(payload?.metadata?.encoding) !== REFERENCE_ENCODING ||
    decodeBase64(payload?.metadata?.messageType) !== REFERENCE_MESSAGE_TYPE
  ) {
    return undefined;
  }
  try {
    return parseStorageReference(
      JSON.parse(decodeBase64(payload.data ?? '')),
      sizeBytesOf(payload),
    );
  } catch {
    return undefined;
  }
}

/** What is shown of a stored payload: where it is. */
export function referenceInfo(reference: StorageReference): ExternalPayload {
  return {
    store: 's3',
    bucket: reference.bucket,
    key: reference.key,
    size: reference.sizeBytes,
    sha256: reference.sha256,
  };
}
