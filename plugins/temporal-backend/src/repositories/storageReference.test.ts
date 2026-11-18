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

import { memoryS3, storeExternally } from '../__testUtils__/externalStorage';
import {
  parseStorageReference,
  referenceInfo,
  referenceOf,
} from './storageReference';

const hash = 'a'.repeat(64);

describe('storage references of the official S3 driver', () => {
  it('reads the reference the driver writes', async () => {
    const value = { rows: [1, 2, 3], text: 'x'.repeat(100) };
    const stored = await storeExternally(memoryS3(), value);
    const reference = referenceOf(stored.payload);
    expect(reference).toEqual({
      bucket: 'payloads',
      key: stored.key,
      sha256: stored.sha256,
      sizeBytes: stored.size,
    });
    expect(reference!.key).toMatch(
      /^v0\/ns\/default\/wt\/exampleWorkflow\/wi\/wf-1\/ri\/run-1\/d\/sha256\/[0-9a-f]{64}$/,
    );
    expect(referenceInfo(reference!)).toEqual({
      store: 's3',
      bucket: 'payloads',
      key: stored.key,
      size: stored.size,
      sha256: stored.sha256,
    });
  });

  it('is not fooled by ordinary payloads', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    expect(
      referenceOf({
        metadata: { encoding: b64('json/plain') },
        data: b64('{}'),
      }),
    ).toBeUndefined();
    // Protobuf JSON of another message type.
    expect(
      referenceOf({
        metadata: {
          encoding: b64('json/protobuf'),
          messageType: b64('example.Other'),
        },
        data: b64('{"driverName":"x","claimData":{}}'),
      }),
    ).toBeUndefined();
  });
});

describe('parseStorageReference', () => {
  const claimData = {
    bucket: 'b',
    key: 'k',
    hash_algorithm: 'sha256',
    hash_value: hash,
  };

  it('reads the hash fields in both spellings', () => {
    expect(
      parseStorageReference({ driverName: 'aws.s3driver', claimData }, 10),
    ).toEqual({
      bucket: 'b',
      key: 'k',
      sha256: hash,
      sizeBytes: 10,
    });
    expect(
      parseStorageReference({
        driverName: 'aws.s3driver',
        claimData: {
          bucket: 'b',
          key: 'k',
          hashAlgorithm: 'sha256',
          hashValue: hash,
        },
      }).sha256,
    ).toBe(hash);
  });

  it.each([
    [null, 'Storage reference is not an object'],
    [{ claimData }, 'Storage reference has no driverName'],
    [{ driverName: 'd' }, 'Storage reference has no claimData'],
    [
      { driverName: 'd', claimData: { ...claimData, bucket: '' } },
      'Storage reference has no bucket',
    ],
    [
      { driverName: 'd', claimData: { ...claimData, key: undefined } },
      'Storage reference has no key',
    ],
    [
      { driverName: 'd', claimData: { ...claimData, hash_algorithm: 'md5' } },
      'Unsupported hash algorithm: md5',
    ],
    [
      { driverName: 'd', claimData: { ...claimData, hash_value: 'xyz' } },
      'Storage reference has an invalid hash',
    ],
  ])('rejects %j', (value, error) => {
    expect(() => parseStorageReference(value)).toThrow(new TypeError(error));
  });
});
