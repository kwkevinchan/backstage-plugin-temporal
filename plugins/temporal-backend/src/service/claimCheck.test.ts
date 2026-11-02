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
import {
  ClaimCheckIntegrityError,
  validateClaimCheck,
  verifyAndRestore,
} from './claimCheck';

/**
 * The shared examples of the claim check format. The S3 codec of
 * `@kwkevinchan/temporal-workflow-kit` is tested against the same file.
 */
const fixtures = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../test-fixtures/claim-checks.json'),
    'utf8',
  ),
);

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
const base64Map = (m: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, Buffer.from(v).toString('base64')]),
  );

describe('claim check format (shared examples)', () => {
  for (const c of fixtures.valid as any[]) {
    it(`restores ${c.name}`, () => {
      const check = validateClaimCheck(c.claimCheck);
      const restored = verifyAndRestore(check, bytes(c.payload.data));
      expect(base64Map(restored.metadata ?? {})).toEqual(c.payload.metadata);
      expect(Buffer.from(restored.data!).toString('base64')).toBe(
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
