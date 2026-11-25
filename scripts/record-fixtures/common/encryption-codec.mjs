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

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const METADATA_ENCODING_KEY = 'encoding';
const METADATA_ENCRYPTION_KEY_ID = 'encryption-key-id';
const ENCRYPTED_ENCODING = Buffer.from('binary/encrypted', 'utf8');
const DEFAULT_KEY_ID = 'test-key-id';
// The 32-byte test-only key of the `encryption` sample in
// `temporalio/samples-typescript`; the committed encrypted fixtures were
// written with it.
const DEFAULT_KEY = Buffer.from('test-key-test-key-test-key-test!', 'utf8');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * AES-256-GCM PayloadCodec in the format of the `encryption` sample: the data
 * is `iv (12 bytes) | ciphertext | auth tag (16 bytes)`, and the metadata
 * carries `binary/encrypted` and `encryption-key-id`.
 */
export function createEncryptionCodec({
  Payload,
  defaultKeyId = DEFAULT_KEY_ID,
  key = DEFAULT_KEY,
}) {
  return {
    async encode(payloads) {
      return payloads.map(payload => {
        const bytes = Payload.encode(payload).finish();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
          metadata: {
            [METADATA_ENCODING_KEY]: ENCRYPTED_ENCODING,
            [METADATA_ENCRYPTION_KEY_ID]: Buffer.from(defaultKeyId, 'utf8'),
          },
          data: Buffer.concat([iv, encrypted, tag]),
        };
      });
    },
    async decode(payloads) {
      return payloads.map(payload => {
        const encoding = payload.metadata?.[METADATA_ENCODING_KEY];
        if (
          !encoding ||
          Buffer.from(encoding).toString('utf8') !== 'binary/encrypted'
        ) {
          return payload;
        }
        const buf = Buffer.from(payload.data);
        const iv = buf.subarray(0, IV_LENGTH);
        const tag = buf.subarray(buf.length - TAG_LENGTH);
        const encrypted = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]);
        return Payload.decode(decrypted);
      });
    },
  };
}
