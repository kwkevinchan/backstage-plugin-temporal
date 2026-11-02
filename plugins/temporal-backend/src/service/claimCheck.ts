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
import { CLAIM_CHECK_ENCODING } from '../common';

/*
 * The read side of the claim check format of
 * `@kwkevinchan/temporal-workflow-kit/s3`: validating a claim check and
 * restoring the original payload from the stored data. The backend does not
 * depend on the worker package; both implementations are tested against the
 * shared examples in `test-fixtures/claim-checks.json`.
 */

export { CLAIM_CHECK_ENCODING };

/** Version of the claim check format that the backend reads. */
export const CLAIM_CHECK_VERSION = 1;

/** A Temporal payload: metadata and data as bytes. */
export interface Payload {
  metadata?: Record<string, Uint8Array> | null;
  data?: Uint8Array | null;
}

/**
 * What a claim check payload holds instead of the data: where the data is
 * stored and how to restore the original payload.
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

const HEX_64 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

/**
 * Validates a parsed claim check. Throws a `TypeError` for anything that is
 * not a version 1 S3 claim check.
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

/** Error thrown when stored data does not match its claim check. */
export class ClaimCheckIntegrityError extends Error {
  readonly name = 'ClaimCheckIntegrityError';
}

/** Verifies stored data against its claim check and restores the payload. */
export function verifyAndRestore(check: ClaimCheck, data: Uint8Array): Payload {
  if (data.length !== check.size) {
    throw new ClaimCheckIntegrityError(
      `S3 object ${check.key} has ${data.length} bytes, the claim check says ${check.size}`,
    );
  }
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== check.sha256) {
    throw new ClaimCheckIntegrityError(
      `S3 object ${check.key} has SHA-256 ${actual}, the claim check says ${check.sha256}`,
    );
  }
  const metadata: Record<string, Uint8Array> = {
    encoding: encoder.encode(check.encoding),
  };
  for (const [key, value] of Object.entries(check.metadata ?? {})) {
    if (key !== 'encoding') metadata[key] = Buffer.from(value, 'base64');
  }
  return { metadata, data };
}
