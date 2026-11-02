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
  ClaimCheck,
  CLAIM_CHECK_VERSION,
  claimCheckPayload,
  detectContentType,
  extraMetadata,
  isClaimCheckPayload,
  parseClaimCheck,
  Payload,
  payloadEncoding,
  restorePayload,
  sha256Hex,
} from './claimCheck';
import { S3PayloadStore, S3PayloadStoreOptions } from './S3PayloadStore';

/**
 * Payloads larger than this many bytes are stored in S3 by default (128 KiB).
 *
 * @public
 */
export const DEFAULT_THRESHOLD_BYTES = 128 * 1024;

/**
 * Default key prefix.
 *
 * @public
 */
export const DEFAULT_KEY_PREFIX = 'temporal-payloads';

/**
 * The workflow or activity a payload belongs to. Same shape as the
 * `SerializationContext` that Temporal SDKs pass to codecs; the SDK leaves
 * it out where it has none.
 *
 * @public
 */
export interface PayloadCodecContext {
  namespace?: string;
  workflowId?: string;
}

/**
 * Options of {@link S3PayloadCodec}.
 *
 * @public
 */
export interface S3PayloadCodecOptions {
  /** The store, or the options to create one. */
  store: S3PayloadStore | S3PayloadStoreOptions;
  /**
   * Payloads whose data is larger than this are stored in S3; smaller ones
   * stay in the history. Defaults to {@link DEFAULT_THRESHOLD_BYTES}.
   */
  thresholdBytes?: number;
  /** First part of every key. Defaults to {@link DEFAULT_KEY_PREFIX}. */
  prefix?: string;
}

/** Part of a key: no slashes, no empty or dot segments. */
function keySegment(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const encoded = encodeURIComponent(value);
  return encoded === '.' || encoded === '..'
    ? `%2E${encoded.slice(1)}`
    : encoded;
}

/**
 * Key of stored data: `{prefix}/{namespace}/{workflowId}/{sha256}`.
 * Payloads of one workflow with the same data share one object (retries,
 * repeated results), and everything of a workflow is under one prefix, so
 * it can be listed or deleted together. Payloads without a workflow (no
 * serialization context) use `_` for the missing parts.
 *
 * @public
 */
export function claimCheckKey(
  prefix: string,
  context: PayloadCodecContext | undefined,
  sha256: string,
): string {
  const parts = [
    keySegment(context?.namespace, '_'),
    keySegment(context?.workflowId, '_'),
    sha256,
  ];
  const base = prefix.replace(/^\/+|\/+$/g, '');
  return base ? `${base}/${parts.join('/')}` : parts.join('/');
}

/**
 * Error thrown when stored data does not match its claim check.
 *
 * @public
 */
export class ClaimCheckIntegrityError extends Error {
  readonly name = 'ClaimCheckIntegrityError';
}

/**
 * Verifies stored data against its claim check and restores the payload.
 *
 * @public
 */
export function verifyAndRestore(check: ClaimCheck, data: Uint8Array): Payload {
  if (data.length !== check.size) {
    throw new ClaimCheckIntegrityError(
      `S3 object ${check.key} has ${data.length} bytes, the claim check says ${check.size}`,
    );
  }
  const actual = sha256Hex(data);
  if (actual !== check.sha256) {
    throw new ClaimCheckIntegrityError(
      `S3 object ${check.key} has SHA-256 ${actual}, the claim check says ${check.sha256}`,
    );
  }
  return restorePayload(check, data);
}

/**
 * Payload codec that stores large payloads in S3 (claim check pattern).
 *
 * `encode` uploads the data of every payload larger than `thresholdBytes`
 * and puts a claim check payload (encoding `json/claim-check`) in its
 * place; `decode` downloads the data, checks its size and SHA-256 and
 * restores the original payload. Smaller payloads pass through unchanged.
 *
 * Put it last in `payloadCodecs`, so that it stores what other codecs
 * (compression, encryption) produced: the codecs encode in order and decode
 * in reverse order.
 *
 * @public
 */
export class S3PayloadCodec {
  readonly store: S3PayloadStore;
  readonly thresholdBytes: number;
  readonly prefix: string;

  constructor(options: S3PayloadCodecOptions) {
    this.store =
      options.store instanceof S3PayloadStore
        ? options.store
        : new S3PayloadStore(options.store);
    this.thresholdBytes = options.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
    if (!Number.isSafeInteger(this.thresholdBytes) || this.thresholdBytes < 0) {
      throw new TypeError('thresholdBytes must be a non-negative integer');
    }
    this.prefix = options.prefix ?? DEFAULT_KEY_PREFIX;
  }

  async encode(
    payloads: Payload[],
    context?: PayloadCodecContext,
  ): Promise<Payload[]> {
    return Promise.all(payloads.map(p => this.encodeOne(p, context)));
  }

  async decode(
    payloads: Payload[],
    _context?: PayloadCodecContext,
  ): Promise<Payload[]> {
    return Promise.all(payloads.map(p => this.decodeOne(p)));
  }

  private async encodeOne(
    payload: Payload,
    context: PayloadCodecContext | undefined,
  ): Promise<Payload> {
    const data = payload.data ?? new Uint8Array();
    if (data.length <= this.thresholdBytes || isClaimCheckPayload(payload)) {
      return payload;
    }
    const sha256 = sha256Hex(data);
    const contentType = detectContentType(payload);
    const key = claimCheckKey(this.prefix, context, sha256);
    await this.store.put(key, data, { contentType, sha256 });
    const check: ClaimCheck = {
      version: CLAIM_CHECK_VERSION,
      store: 's3',
      bucket: this.store.bucket,
      key,
      size: data.length,
      sha256,
      encoding: payloadEncoding(payload),
      contentType,
    };
    const metadata = extraMetadata(payload);
    if (metadata) check.metadata = metadata;
    return claimCheckPayload(check);
  }

  private async decodeOne(payload: Payload): Promise<Payload> {
    if (!isClaimCheckPayload(payload)) return payload;
    const check = parseClaimCheck(payload);
    if (check.bucket !== this.store.bucket) {
      throw new Error(
        `Claim check points to bucket ${check.bucket}, this codec reads ${this.store.bucket}`,
      );
    }
    const data = await this.store.get(check.key);
    return verifyAndRestore(check, data);
  }
}

/**
 * A payload codec, same shape as `PayloadCodec` of `@temporalio/common`.
 *
 * @public
 */
export interface PayloadCodecLike {
  encode(payloads: Payload[], context?: any): Promise<Payload[]>;
  decode(payloads: Payload[], context?: any): Promise<Payload[]>;
}

/**
 * Data converter options for a client or worker: `{ payloadCodecs: [codec] }`
 * with an {@link S3PayloadCodec}. Pass `codecs` to run other codecs first.
 *
 * ```js
 * const dataConverter = createS3DataConverter({
 *   store: { endpoint, bucket, forcePathStyle: true, credentials },
 * });
 * await Worker.create({ dataConverter, ... });
 * new Client({ connection, dataConverter });
 * ```
 *
 * @public
 */
export function createS3DataConverter(
  options: S3PayloadCodecOptions & { codecs?: PayloadCodecLike[] },
): { payloadCodecs: PayloadCodecLike[] } {
  const { codecs = [], ...codecOptions } = options;
  return { payloadCodecs: [...codecs, new S3PayloadCodec(codecOptions)] };
}
