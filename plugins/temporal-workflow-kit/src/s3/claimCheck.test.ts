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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  ClaimCheckIntegrityError,
  parseClaimCheck,
  Payload,
  S3PayloadCodec,
  validateClaimCheck,
  verifyAndRestore,
} from './index';

/**
 * The shared examples of the claim check format. The backend of the
 * Backstage plugin reads claim checks with its own code and is tested
 * against the same file.
 */
const fixtures = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../test-fixtures/claim-checks.json'),
    'utf8',
  ),
);

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
const toPayload = (p: {
  metadata: Record<string, string>;
  data: string;
}): Payload => ({
  metadata: Object.fromEntries(
    Object.entries(p.metadata).map(([k, v]) => [k, bytes(v)]),
  ),
  data: bytes(p.data),
});
const base64Map = (m: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, Buffer.from(v).toString('base64')]),
  );

function codec() {
  const objects = new Map<string, Uint8Array>();
  const send = jest.fn(async (command: any) => {
    const { Key } = command.input;
    if (command instanceof PutObjectCommand) {
      objects.set(Key, Buffer.from(command.input.Body as Uint8Array));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(Key)!;
      return { Body: { transformToByteArray: async () => body } };
    }
    throw new Error('Unexpected command');
  });
  return {
    objects,
    codec: new S3PayloadCodec({
      store: { bucket: fixtures.bucket, client: { send } },
      prefix: fixtures.prefix,
      thresholdBytes: 0,
    }),
  };
}

describe('claim check format (shared examples)', () => {
  for (const c of fixtures.valid as any[]) {
    it(`writes and reads ${c.name}`, async () => {
      const { codec: s3, objects } = codec();
      const context = c.context
        ? { type: 'workflow', ...c.context }
        : undefined;
      const [encoded] = await s3.encode([toPayload(c.payload)], context);
      expect(parseClaimCheck(encoded)).toEqual(c.claimCheck);
      expect(
        Buffer.from(objects.get(c.claimCheck.key)!).toString('base64'),
      ).toBe(c.payload.data);

      const [decoded] = await s3.decode([encoded]);
      expect(base64Map(decoded.metadata ?? {})).toEqual(c.payload.metadata);
      expect(Buffer.from(decoded.data!).toString('base64')).toBe(
        c.payload.data,
      );
    });
  }

  for (const c of fixtures.invalid as any[]) {
    it(`rejects ${c.name}`, () => {
      expect(() => validateClaimCheck(c.claimCheck)).toThrow(
        new TypeError(c.error),
      );
    });
  }

  for (const c of fixtures.integrity as any[]) {
    it(`detects ${c.name}`, () => {
      const check = validateClaimCheck(c.claimCheck);
      expect(() => verifyAndRestore(check, bytes(c.data))).toThrow(
        ClaimCheckIntegrityError,
      );
      expect(() => verifyAndRestore(check, bytes(c.data))).toThrow(c.error);
    });
  }
});
