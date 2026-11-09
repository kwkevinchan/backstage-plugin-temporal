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
  contentTypeOf,
  DEFAULT_S3_DRIVER_NAME,
  parseStorageReference,
  Payload,
  REFERENCE_ENCODING,
  REFERENCE_MESSAGE_TYPE,
  StorageReference,
  verifyAndDecode,
} from './storageReference';
import { S3PayloadReader } from './S3PayloadReader';

/*
 * Payloads in Temporal External Storage. Workers with `ExternalStorage` and
 * the S3 driver store payloads above a threshold in S3, and the history
 * holds a reference payload instead (see `storageReference.ts`). Before the
 * history is converted for display, `PayloadStore.resolve` looks at
 * every reference and attaches what to show (see `ExternalPayload`):
 *
 * - `inline`: JSON data up to `maxInlineBytes` is downloaded, verified and
 *   shown like any other payload;
 * - `preview`: larger data, or data that is not JSON, gets its size, media
 *   type and (for text) the first `previewBytes` bytes, and can be
 *   downloaded through the backend;
 * - `unconfigured`: no S3 is configured; the reference itself is shown;
 * - `error`: S3 could not be read, or the object did not match the
 *   reference.
 */

/** Default largest JSON payload shown inline (256 KiB). */
export const DEFAULT_MAX_INLINE_BYTES = 256 * 1024;
/** Default number of bytes shown as the preview of a larger payload. */
export const DEFAULT_PREVIEW_BYTES = 2048;
/**
 * Largest stored payload the backend downloads, the default limit of the
 * S3 driver (50 MiB). Larger ones are shown without their data.
 */
export const MAX_STORED_BYTES = 50 * 1024 * 1024;
/** Bytes of downloaded objects kept in memory, by SHA-256. */
const CACHE_BYTES = 32 * 1024 * 1024;
/** S3 requests of one history read that run at the same time. */
const CONCURRENCY = 8;

/**
 * What the converter shows for a reference payload, attached to the
 * payload's JSON object by `PayloadStore.resolve`.
 */
export const EXTERNAL_PAYLOAD = Symbol('externalPayload');

type Json = any;

function decodeBase64(value: unknown): string {
  return typeof value === 'string'
    ? Buffer.from(value, 'base64').toString('utf8')
    : '';
}

function sizeBytesOf(payload: Json): number {
  const raw = payload?.externalPayloads?.[0]?.sizeBytes;
  const size = Number(raw ?? 0);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

/** The storage reference of a payload in protobuf JSON form, if it is one. */
export function referenceOf(payload: Json): StorageReference | undefined {
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

/** Every reference payload in a JSON tree (protobuf JSON form). */
export function findReferencePayloads(
  root: Json,
): { payload: Json; reference: StorageReference }[] {
  const found: { payload: Json; reference: StorageReference }[] = [];
  const stack: Json[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (isPayloadJson(value)) {
      const reference = referenceOf(value);
      if (reference) found.push({ payload: value, reference });
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

/** What is known of a stored payload before it is downloaded. */
export function referenceInfo(reference: StorageReference): ExternalPayload {
  return {
    store: 's3',
    bucket: reference.bucket,
    key: reference.key,
    size: reference.sizeBytes,
    sha256: reference.sha256,
    encoding: '',
    contentType: '',
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

/** A stored payload, downloaded and verified. */
export interface StoredPayload {
  payload: Payload;
  encoding: string;
  contentType: string;
  data: Uint8Array;
}

/** Options of {@link PayloadStore}. */
export interface PayloadStoreOptions {
  /** The S3 bucket of the payloads; undefined when S3 is not configured. */
  store?: Pick<S3PayloadReader, 'bucket' | 'get'>;
  /** Driver name of the workers' S3 driver (default `aws.s3driver`). */
  driverName?: string;
  maxInlineBytes?: number;
  previewBytes?: number;
  logger?: LoggerService;
}

/**
 * Reads payloads in Temporal External Storage for display and download.
 */
export class PayloadStore {
  readonly store: PayloadStoreOptions['store'];
  readonly driverName: string;
  readonly maxInlineBytes: number;
  readonly previewBytes: number;
  private readonly logger?: LoggerService;
  private readonly cache = new ByteCache(CACHE_BYTES);

  constructor(options: PayloadStoreOptions = {}) {
    this.store = options.store;
    this.driverName = options.driverName ?? DEFAULT_S3_DRIVER_NAME;
    this.maxInlineBytes = options.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
    this.previewBytes = options.previewBytes ?? DEFAULT_PREVIEW_BYTES;
    this.logger = options.logger;
  }

  /**
   * Reads `temporal.externalStorage.s3`. Without it, stored payloads are
   * shown as "stored externally (not configured)".
   */
  static fromConfig(config: Config, logger?: LoggerService): PayloadStore {
    const s3 = config.getOptionalConfig('temporal.externalStorage.s3');
    if (!s3) return new PayloadStore({ logger });
    const credentials = s3.getOptionalConfig('credentials');
    const store = new S3PayloadReader({
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
          `temporal.externalStorage.s3.${name} must be a non-negative integer`,
        );
      }
    }
    return new PayloadStore({
      store,
      driverName: s3.getOptionalString('driverName'),
      maxInlineBytes,
      previewBytes,
      logger,
    });
  }

  get configured(): boolean {
    return Boolean(this.store);
  }

  /**
   * Attaches what to show to every reference payload in `root` (history
   * events or a describe response, protobuf JSON form). JSON data up to
   * `maxInlineBytes` replaces the reference in place.
   */
  async resolve(
    root: Json,
    options: { maxInlineBytes?: number } = {},
  ): Promise<void> {
    const found = findReferencePayloads(root);
    if (found.length === 0) return;
    const maxInline = options.maxInlineBytes ?? this.maxInlineBytes;
    await runLimited(found, CONCURRENCY, async ({ payload, reference }) => {
      payload[EXTERNAL_PAYLOAD] = await this.resolveOne(
        payload,
        reference,
        maxInline,
      );
    });
  }

  /** Why the backend does not read a reference, or undefined when it does. */
  private notReadable(reference: StorageReference): string | undefined {
    const store = this.store;
    if (!store) return undefined;
    if (reference.driverName !== this.driverName) {
      return `Stored with the storage driver ${reference.driverName}; Backstage reads ${this.driverName}`;
    }
    if (reference.bucket !== store.bucket) {
      return `Stored in bucket ${reference.bucket}; Backstage reads ${store.bucket}`;
    }
    if (reference.sizeBytes > MAX_STORED_BYTES) {
      return `Stored payload of ${reference.sizeBytes} bytes is larger than ${MAX_STORED_BYTES} bytes`;
    }
    return undefined;
  }

  private async resolveOne(
    payload: Json,
    reference: StorageReference,
    maxInlineBytes: number,
  ): Promise<ExternalPayload> {
    const info = referenceInfo(reference);
    if (!this.store) return info;
    const problem = this.notReadable(reference);
    if (problem) return { ...info, state: 'error', error: problem };
    try {
      const stored = await this.read(reference);
      const known: ExternalPayload = {
        ...info,
        size: stored.data.length,
        encoding: stored.encoding,
        contentType: stored.contentType,
        downloadable: true,
      };
      if (
        isJsonEncoding(stored.encoding) &&
        stored.data.length <= maxInlineBytes
      ) {
        // The converter decodes the stored payload, then adds `external`.
        payload.metadata = Object.fromEntries(
          Object.entries(stored.payload.metadata ?? {}).map(([k, v]) => [
            k,
            Buffer.from(v).toString('base64'),
          ]),
        );
        payload.data = Buffer.from(stored.data).toString('base64');
        delete payload.externalPayloads;
        return { ...known, state: 'inline' };
      }
      const preview: ExternalPayload = { ...known, state: 'preview' };
      if (isTextType(stored.contentType) && this.previewBytes > 0) {
        preview.preview = previewText(
          stored.data.subarray(0, this.previewBytes),
        );
        if (stored.data.length > this.previewBytes) {
          preview.previewTruncated = true;
        }
      }
      return preview;
    } catch (error) {
      this.logger?.warn(
        `Could not read the stored payload ${reference.key}: ${
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

  /** Downloads, verifies and decodes a stored payload. */
  async read(reference: StorageReference): Promise<StoredPayload> {
    if (!this.store) throw new Error('S3 is not configured');
    const problem = this.notReadable(reference);
    if (problem) throw new Error(problem);
    const cached = this.cache.get(reference.sha256);
    const object = cached ?? (await this.store.get(reference.key));
    const payload = verifyAndDecode(reference, object);
    // Cached once verified, so the cache holds correct objects only.
    if (!cached) this.cache.set(reference.sha256, object);
    const encoding = new TextDecoder().decode(
      payload.metadata?.encoding ?? new Uint8Array(),
    );
    const data = payload.data ?? new Uint8Array();
    return {
      payload,
      encoding,
      contentType: contentTypeOf(encoding, data),
      data,
    };
  }
}
