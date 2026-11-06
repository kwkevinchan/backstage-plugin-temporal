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

import type { Response } from 'express';
import type { ExternalPayloads } from './payloads';
import type { StorageReference } from './storageReference';

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** A media type that is safe to put in a header, or a generic one. */
export function safeContentType(contentType: string): string {
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/i.test(contentType)
    ? contentType.toLowerCase()
    : 'application/octet-stream';
}

/** File name of a download: the SHA-256 with an extension for the type. */
export function downloadFileName(
  reference: StorageReference,
  contentType: string,
): string {
  const ext = EXTENSIONS[safeContentType(contentType)] ?? 'bin';
  return `payload-${reference.sha256.slice(0, 16)}.${ext}`;
}

/**
 * Sends the data of a stored payload as an attachment. The object is
 * downloaded, checked against the SHA-256 of its reference and decoded
 * before anything is sent, so a client never gets wrong data.
 */
export async function sendStoredPayload(
  res: Response,
  reference: StorageReference,
  payloads: ExternalPayloads,
): Promise<void> {
  const stored = await payloads.read(reference);
  const contentType = safeContentType(stored.contentType);
  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadFileName(reference, contentType)}"`,
  );
  // Never rendered as a page of the backend origin.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Payload-Sha256', reference.sha256);
  res.setHeader('Content-Length', String(stored.data.length));
  res.end(Buffer.from(stored.data));
}
