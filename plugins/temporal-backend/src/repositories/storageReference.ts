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

/*
 * The read side of Temporal External Storage (the SDKs' `ExternalStorage`
 * with the S3 driver, public preview): large payloads are stored in S3 and
 * the history holds a reference payload instead. The backend reads the
 * format itself and does not depend on the experimental driver packages;
 * `storageReference.test.ts` checks it against payloads written by the
 * official S3 driver.
 *
 * A reference payload has the metadata `encoding: json/protobuf` and
 * `messageType: temporal.api.sdk.v1.ExternalStorageReference`, and its data
 * is the JSON form of that message:
 *
 *   { "driverName": "aws.s3driver",
 *     "claimData": { "bucket": "…", "key": "v0/…/d/sha256/<hex>",
 *                    "hash_algorithm": "sha256", "hash_value": "<hex>" } }
 *
 * `externalPayloads[0].sizeBytes` is the size of the stored payload. The S3
 * object is the stored payload encoded as a `temporal.api.common.v1.Payload`
 * message (after the codecs of the worker), and `hash_value` is the SHA-256
 * of the object.
 */

/** `encoding` metadata of a reference payload. */
export const REFERENCE_ENCODING = 'json/protobuf';
/** `messageType` metadata of a reference payload. */
export const REFERENCE_MESSAGE_TYPE =
  'temporal.api.sdk.v1.ExternalStorageReference';
/** Driver name the S3 driver writes unless it is given another one. */
export const DEFAULT_S3_DRIVER_NAME = 'aws.s3driver';

/** A Temporal payload: metadata and data as bytes. */
export interface Payload {
  metadata?: Record<string, Uint8Array> | null;
  data?: Uint8Array | null;
}

/** Where a payload is stored, read from its reference payload. */
export interface StorageReference {
  driverName: string;
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
  return { driverName: v.driverName, bucket, key, sha256: hash, sizeBytes };
}

/**
 * Error thrown when a stored object fails the backend's checks: its size,
 * its SHA-256 or its encoding. The message is about the object only, so it
 * is shown to users.
 */
export class StorageIntegrityError extends Error {
  readonly name = 'StorageIntegrityError';
}

/**
 * Verifies a stored object against its reference and decodes the stored
 * payload.
 */
export function verifyAndDecode(
  reference: StorageReference,
  object: Uint8Array,
): Payload {
  const actual = createHash('sha256').update(object).digest('hex');
  if (actual !== reference.sha256) {
    throw new StorageIntegrityError(
      `S3 object ${reference.key} has SHA-256 ${actual}, the reference says ${reference.sha256}`,
    );
  }
  try {
    return decodePayloadMessage(object);
  } catch (error) {
    throw new StorageIntegrityError(
      `S3 object ${reference.key} is not a Temporal payload: ${
        (error as Error).message
      }`,
    );
  }
}

/** Reads protobuf wire format: varints and length-delimited fields. */
class WireReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.bytes.length) throw new Error('truncated varint');
      const b = this.bytes[this.pos++];
      // Up to 2^53: lengths and keys of a payload are far smaller.
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 49) throw new Error('varint too long');
    }
  }

  lengthDelimited(): Uint8Array {
    const length = this.varint();
    const end = this.pos + length;
    if (end > this.bytes.length) throw new Error('truncated field');
    const value = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return value;
  }

  /** Skips a field of another number (unknown fields, as protobuf does). */
  skip(wireType: number) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.advance(8);
    else if (wireType === 2) this.lengthDelimited();
    else if (wireType === 5) this.advance(4);
    else throw new Error(`unsupported wire type ${wireType}`);
  }

  private advance(n: number) {
    if (this.pos + n > this.bytes.length) throw new Error('truncated field');
    this.pos += n;
  }
}

/**
 * Decodes a `temporal.api.common.v1.Payload` message:
 * `map<string, bytes> metadata = 1; bytes data = 2;` (other fields, such as
 * `external_payloads = 3`, are skipped). The backend talks to Temporal
 * through `@temporalio/client` only, so it reads the two fields itself.
 */
export function decodePayloadMessage(bytes: Uint8Array): Payload {
  const reader = new WireReader(bytes);
  const metadata: Record<string, Uint8Array> = {};
  let data = new Uint8Array();
  const text = new TextDecoder('utf-8', { fatal: true });
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (field === 1 && wireType === 2) {
      // A map entry: `string key = 1; bytes value = 2;`.
      const entry = new WireReader(reader.lengthDelimited());
      let key = '';
      let value = new Uint8Array();
      while (!entry.done) {
        const entryTag = entry.varint();
        const entryField = Math.floor(entryTag / 8);
        if (entryField === 1 && entryTag % 8 === 2) {
          key = text.decode(entry.lengthDelimited());
        } else if (entryField === 2 && entryTag % 8 === 2) {
          value = new Uint8Array(entry.lengthDelimited());
        } else {
          entry.skip(entryTag % 8);
        }
      }
      metadata[key] = value;
    } else if (field === 2 && wireType === 2) {
      data = new Uint8Array(reader.lengthDelimited());
    } else {
      reader.skip(wireType);
    }
  }
  return { metadata, data };
}

const IMAGE_SIGNATURES: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
];

/**
 * Media type of a stored payload, for display and download: from its
 * encoding, and for binary data from its first bytes (the SDK payload
 * converters do not record a media type).
 */
export function contentTypeOf(encoding: string, data: Uint8Array): string {
  if (
    encoding === 'json/plain' ||
    encoding === 'json/protobuf' ||
    encoding === 'binary/null'
  ) {
    return 'application/json';
  }
  for (const [type, signature] of IMAGE_SIGNATURES) {
    if (signature.every((b, i) => data[i] === b)) return type;
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}
