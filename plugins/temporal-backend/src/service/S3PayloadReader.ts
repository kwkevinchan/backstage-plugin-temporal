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

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

/** Connection to the S3-compatible service of the claim checks. */
export interface S3PayloadReaderOptions {
  /** Bucket of the payloads, the same as the workers use. */
  bucket: string;
  /** Endpoint of an S3-compatible service. Leave it out for AWS S3. */
  endpoint?: string;
  /** Region. Defaults to `us-east-1`. */
  region?: string;
  /** Bucket in the path (`endpoint/bucket/key`) instead of the host name. */
  forcePathStyle?: boolean;
  /** Access key with read access. Required unless `client` is given. */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** A ready S3 client, used instead of the options above (tests). */
  client?: Pick<S3Client, 'send'>;
}

/** A stored object as a stream. */
export interface StoredObjectStream {
  body: Readable;
  contentLength?: number;
}

/**
 * Reads payload data from one bucket of an S3-compatible service. Every
 * value comes from the options; AWS environment variables and profiles are
 * not read. The backend only reads; the workers write.
 */
export class S3PayloadReader {
  readonly bucket: string;
  private readonly client: Pick<S3Client, 'send'>;

  constructor(options: S3PayloadReaderOptions) {
    if (!options.bucket) throw new TypeError('S3 bucket is required');
    this.bucket = options.bucket;
    if (options.client) {
      this.client = options.client;
      return;
    }
    if (
      !options.credentials?.accessKeyId ||
      !options.credentials.secretAccessKey
    ) {
      throw new TypeError(
        'S3 credentials (accessKeyId and secretAccessKey) are required',
      );
    }
    this.client = new S3Client({
      endpoint: options.endpoint || undefined,
      region: options.region || 'us-east-1',
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.credentials.accessKeyId,
        secretAccessKey: options.credentials.secretAccessKey,
        sessionToken: options.credentials.sessionToken,
      },
      // Checksums are only sent when the operation requires them, which
      // more S3-compatible services understand.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Reads the whole object. */
  async get(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    return response.Body.transformToByteArray();
  }

  /** Reads the first `bytes` bytes of the object (fewer when it is shorter). */
  async getStart(key: string, bytes: number): Promise<Uint8Array> {
    if (bytes <= 0) return new Uint8Array();
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    const data = await response.Body.transformToByteArray();
    // A service that ignores Range sends the whole object.
    return data.length > bytes ? data.subarray(0, bytes) : data;
  }

  /** Reads the object as a stream, for downloads. */
  async stream(key: string): Promise<StoredObjectStream> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    return {
      body: response.Body as Readable,
      contentLength: response.ContentLength,
    };
  }
}
