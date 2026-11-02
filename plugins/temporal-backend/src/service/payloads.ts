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

import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import type { ExternalPayload } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  ClaimCheck,
  CLAIM_CHECK_ENCODING,
  S3PayloadStore,
  validateClaimCheck,
  verifyAndRestore,
} from '@kwkevinchan/temporal-payload-s3';

/*
 * Claim checks in workflow histories. Payloads larger than the threshold of
 * the worker's codec are stored in S3, and the history holds a claim check
 * (encoding `json/claim-check`) instead. Before the history is converted
 * for display, `ExternalPayloads.resolve` looks at every claim check and attaches
 * what to show (see `ExternalPayload`):
 *
 * - `inline`: JSON data up to `maxInlineBytes` is downloaded, verified and
 *   shown like any other payload;
 * - `preview`: larger data, or data that is not JSON, gets its size, media
 *   type and (for text) the first `previewBytes` bytes, and can be
 *   downloaded through the backend;
 * - `unconfigured`: no S3 is configured; the claim check itself is shown;
 * - `error`: S3 could not be read, or the data did not match the claim
 *   check.
 */

/** Default largest JSON payload downloaded and shown inline (256 KiB). */
export const DEFAULT_MAX_INLINE_BYTES = 256 * 1024;
/** Default number of bytes shown as the preview of a larger payload. */
export const DEFAULT_PREVIEW_BYTES = 2048;
/** Bytes of downloaded data kept in memory, by SHA-256. */
const CACHE_BYTES = 32 * 1024 * 1024;
/** S3 requests of one history read that run at the same time. */
const CONCURRENCY = 8;

/**
 * What the converter shows for a claim check payload, attached to the
 * payload's JSON object by `ExternalPayloads.resolve`.
 */
export const EXTERNAL_PAYLOAD = Symbol('externalPayload');

type Json = any;

function decodeBase64(value: unknown): string {
  return typeof value === 'string'
    ? Buffer.from(value, 'base64').toString('utf8')
    : '';
}

/** The claim check of a payload in protobuf JSON form, if it is one. */
export function claimCheckOf(payload: Json): ClaimCheck | undefined {
  if (decodeBase64(payload?.metadata?.encoding) !== CLAIM_CHECK_ENCODING) {
    return undefined;
  }
  try {
    return validateClaimCheck(JSON.parse(decodeBase64(payload.data ?? '')));
  } catch {
    return undefined;
  }
}

function isPayloadJson(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.metadata === 'object' &&
    value.metadata !== null &&
    'encoding' in value.metadata
  );
}

/** Every claim check payload in a JSON tree (protobuf JSON form). */
export function findClaimCheckPayloads(
  root: Json,
): { payload: Json; check: ClaimCheck }[] {
  const found: { payload: Json; check: ClaimCheck }[] = [];
  const stack: Json[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (isPayloadJson(value)) {
      const check = claimCheckOf(value);
      if (check) found.push({ payload: value, check });
      continue;
    }
    stack.push(...Object.values(value));
  }
  return found;
}

function isJsonEncoding(encoding: string): boolean {
  return (
    encoding === 'json/plain' ||
    encoding === 'json/protobuf' ||
    encoding === 'binary/null'
  );
}

function isTextType(contentType: string): boolean {
  return (
    /^text\//.test(contentType) ||
    /^application\/([\w.+-]+\+)?(json|xml|yaml|x-ndjson)$/.test(contentType)
  );
}

/** UTF-8 text of the first bytes, without a character cut in half. */
function previewText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/�+$/, '');
}

function baseInfo(check: ClaimCheck): ExternalPayload {
  return {
    store: check.store,
    bucket: check.bucket,
    key: check.key,
    size: check.size,
    sha256: check.sha256,
    encoding: check.encoding,
    contentType: check.contentType,
    state: 'unconfigured',
  };
}

/** Least recently used byte arrays, up to a total size. */
class ByteCache {
  private readonly items = new Map<string, Uint8Array>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): Uint8Array | undefined {
    const value = this.items.get(key);
    if (value) {
      this.items.delete(key);
      this.items.set(key, value);
    }
    return value;
  }

  set(key: string, value: Uint8Array) {
    if (value.length > this.maxBytes) return;
    const old = this.items.get(key);
    if (old) {
      this.bytes -= old.length;
      this.items.delete(key);
    }
    this.items.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.items) {
      if (this.bytes <= this.maxBytes) break;
      this.items.delete(k);
      this.bytes -= v.length;
    }
  }
}

async function runLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    })(),
  );
  await Promise.all(workers);
}

/** Options of {@link ExternalPayloads}. */
export interface ExternalPayloadsOptions {
  /** Store of the claim checks; undefined when S3 is not configured. */
  store?: Pick<S3PayloadStore, 'bucket' | 'get' | 'getStart' | 'stream'>;
  maxInlineBytes?: number;
  previewBytes?: number;
  logger?: LoggerService;
}

/**
 * Reads the data behind claim checks for display and download.
 */
export class ExternalPayloads {
  readonly store: ExternalPayloadsOptions['store'];
  readonly maxInlineBytes: number;
  readonly previewBytes: number;
  private readonly logger?: LoggerService;
  private readonly cache = new ByteCache(CACHE_BYTES);
  private readonly previews = new ByteCache(CACHE_BYTES / 8);

  constructor(options: ExternalPayloadsOptions = {}) {
    this.store = options.store;
    this.maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
    this.previewBytes = options.previewBytes ?? DEFAULT_PREVIEW_BYTES;
    this.logger = options.logger;
  }

  /**
   * Reads `temporal.payloads.s3`. Without it, claim checks are shown as
   * "stored externally (not configured)".
   */
  static fromConfig(config: Config, logger?: LoggerService): ExternalPayloads {
    const s3 = config.getOptionalConfig('temporal.payloads.s3');
    if (!s3) return new ExternalPayloads({ logger });
    const credentials = s3.getOptionalConfig('credentials');
    const store = new S3PayloadStore({
      bucket: s3.getString('bucket'),
      endpoint: s3.getOptionalString('endpoint'),
      region: s3.getOptionalString('region'),
      forcePathStyle: s3.getOptionalBoolean('forcePathStyle'),
      credentials: credentials
        ? {
            accessKeyId: credentials.getString('accessKeyId'),
            secretAccessKey: credentials.getString('secretAccessKey'),
            sessionToken: credentials.getOptionalString('sessionToken'),
          }
        : undefined,
    });
    const maxInlineBytes = s3.getOptionalNumber('maxInlineBytes');
    const previewBytes = s3.getOptionalNumber('previewBytes');
    for (const [name, value] of [
      ['maxInlineBytes', maxInlineBytes],
      ['previewBytes', previewBytes],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(
          `temporal.payloads.s3.${name} must be a non-negative integer`,
        );
      }
    }
    return new ExternalPayloads({
      store,
      maxInlineBytes,
      previewBytes,
      logger,
    });
  }

  get configured(): boolean {
    return Boolean(this.store);
  }

  /**
   * Attaches what to show to every claim check payload in `root` (history
   * events or a describe response, protobuf JSON form). JSON data up to
   * `maxInlineBytes` replaces the claim check in place.
   */
  async resolve(root: Json): Promise<void> {
    const found = findClaimCheckPayloads(root);
    if (found.length === 0) return;
    await runLimited(found, CONCURRENCY, async ({ payload, check }) => {
      payload[EXTERNAL_PAYLOAD] = await this.resolveOne(payload, check);
    });
  }

  private async resolveOne(
    payload: Json,
    check: ClaimCheck,
  ): Promise<ExternalPayload> {
    const info = baseInfo(check);
    const store = this.store;
    if (!store) return info;
    if (check.bucket !== store.bucket) {
      return {
        ...info,
        state: 'error',
        error: `Stored in bucket ${check.bucket}; Backstage reads ${store.bucket}`,
      };
    }
    try {
      if (isJsonEncoding(check.encoding) && check.size <= this.maxInlineBytes) {
        const restored = verifyAndRestore(check, await this.download(check));
        // The converter decodes the original payload, then adds `external`.
        payload.metadata = Object.fromEntries(
          Object.entries(restored.metadata ?? {}).map(([k, v]) => [
            k,
            Buffer.from(v).toString('base64'),
          ]),
        );
        payload.data = Buffer.from(restored.data ?? []).toString('base64');
        return { ...info, state: 'inline', downloadable: true };
      }
      const preview: ExternalPayload = {
        ...info,
        state: 'preview',
        downloadable: true,
      };
      if (isTextType(check.contentType) && this.previewBytes > 0) {
        const start = await this.downloadStart(check);
        preview.preview = previewText(start);
        if (check.size > start.length) preview.previewTruncated = true;
      }
      return preview;
    } catch (error) {
      this.logger?.warn(
        `Could not read the S3 payload ${check.key}: ${
          (error as Error)?.message ?? error
        }`,
      );
      return {
        ...info,
        state: 'error',
        error: String((error as Error)?.message ?? error),
        downloadable: false,
      };
    }
  }

  private async download(check: ClaimCheck): Promise<Uint8Array> {
    const cached = this.cache.get(check.sha256);
    if (cached) return cached;
    const data = await this.store!.get(check.key);
    // Cached only after verification, so the cache holds correct data.
    verifyAndRestore(check, data);
    this.cache.set(check.sha256, data);
    return data;
  }

  private async downloadStart(check: ClaimCheck): Promise<Uint8Array> {
    const id = `${check.sha256}:${this.previewBytes}`;
    const cached = this.previews.get(id);
    if (cached) return cached;
    const data = await this.store!.getStart(check.key, this.previewBytes);
    this.previews.set(id, data);
    return data;
  }

  /** Streams the stored data of a claim check. */
  async stream(check: ClaimCheck) {
    if (!this.store) throw new Error('S3 is not configured');
    if (check.bucket !== this.store.bucket) {
      throw new Error(`Stored in bucket ${check.bucket}`);
    }
    return this.store.stream(check.key);
  }
}
