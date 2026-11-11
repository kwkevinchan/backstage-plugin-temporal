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

/** Connection to the S3-compatible service of External Storage. */
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

  /**
   * Reads the whole object. With `maxBytes`, an object larger than that is
   * refused, whatever size its reference claims: at most `maxBytes + 1`
   * bytes are asked for.
   */
  async get(key: string, maxBytes?: number): Promise<Uint8Array> {
    const limited = maxBytes !== undefined;
    const response = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(limited ? { Range: `bytes=0-${maxBytes}` } : {}),
        }),
      )
      .catch(error => {
        // A range from byte 0 is only unsatisfiable for an empty object.
        if (limited && isInvalidRange(error)) return undefined;
        throw error;
      });
    if (!response) return new Uint8Array();
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    const tooLarge = () =>
      new Error(`S3 object ${key} is larger than ${maxBytes} bytes`);
    // The whole size: after the slash of `Content-Range`, or the length
    // when the service sent the whole object.
    const total = response.ContentRange
      ? Number(response.ContentRange.split('/')[1])
      : response.ContentLength;
    if (limited && total !== undefined && total > maxBytes) {
      // Not read: closes the connection of the response.
      (response.Body as { destroy?: () => void }).destroy?.();
      throw tooLarge();
    }
    const data = await response.Body.transformToByteArray();
    if (limited && data.length > maxBytes) throw tooLarge();
    return data;
  }
}

/** S3's answer (416) to a range that the object does not have. */
function isInvalidRange(error: unknown): boolean {
  const e = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return e?.name === 'InvalidRange' || e?.$metadata?.httpStatusCode === 416;
}
