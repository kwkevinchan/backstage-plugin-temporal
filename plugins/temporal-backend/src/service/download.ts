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
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { ClaimCheck } from '@kwkevinchan/temporal-payload-s3';
import type { ExternalPayloads } from './payloads';

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/gzip': 'gz',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

/** A media type that is safe to put in a header, or a generic one. */
export function safeContentType(contentType: string): string {
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/i.test(contentType)
    ? contentType.toLowerCase()
    : 'application/octet-stream';
}

/** File name of a download: the SHA-256 with an extension for the type. */
export function downloadFileName(check: ClaimCheck): string {
  const ext = EXTENSIONS[safeContentType(check.contentType)] ?? 'bin';
  return `payload-${check.sha256.slice(0, 16)}.${ext}`;
}

/**
 * Streams the stored data of a claim check as an attachment. The data is
 * hashed while it streams; when the size or SHA-256 differs from the claim
 * check, the response is aborted, so the client sees a failed download
 * instead of wrong data. There is no `Content-Length` for that reason.
 */
export async function sendStoredPayload(
  res: Response,
  check: ClaimCheck,
  payloads: ExternalPayloads,
): Promise<void> {
  const { body } = await payloads.stream(check);
  res.status(200);
  res.setHeader('Content-Type', safeContentType(check.contentType));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadFileName(check)}"`,
  );
  // Never rendered as a page of the backend origin.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Payload-Sha256', check.sha256);

  const hash = createHash('sha256');
  let size = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
    flush(callback) {
      const sha256 = hash.digest('hex');
      if (size !== check.size || sha256 !== check.sha256) {
        callback(
          new Error(
            `Stored payload ${check.key} does not match its claim check`,
          ),
        );
        return;
      }
      callback();
    },
  });
  try {
    await pipeline(body, verify, res);
  } catch (error) {
    // Headers are sent; aborting the connection is the only signal left.
    res.destroy(error as Error);
  }
}
