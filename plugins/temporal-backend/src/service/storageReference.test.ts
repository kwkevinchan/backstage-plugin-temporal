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

import { temporal } from '@temporalio/proto';
import { memoryS3, storeExternally } from '../__testUtils__/externalStorage';
import { referenceOf } from './payloads';
import {
  contentTypeOf,
  decodePayloadMessage,
  parseStorageReference,
  StorageIntegrityError,
  verifyAndDecode,
} from './storageReference';

const hash = 'a'.repeat(64);

describe('storage references of the official S3 driver', () => {
  it('reads a reference and restores the stored payload', async () => {
    const s3 = memoryS3();
    const value = { rows: [1, 2, 3], text: 'x'.repeat(100) };
    const stored = await storeExternally(s3, value);
    const reference = referenceOf(stored.payload);
    expect(reference).toEqual({
      driverName: 'aws.s3driver',
      bucket: 'payloads',
      key: stored.key,
      sha256: stored.sha256,
      sizeBytes: stored.size,
    });
    expect(reference!.key).toMatch(
      /^v0\/ns\/default\/wt\/exampleWorkflow\/wi\/wf-1\/ri\/run-1\/d\/sha256\/[0-9a-f]{64}$/,
    );
    const object = s3.objects.get(`payloads/${stored.key}`)!;
    const payload = verifyAndDecode(reference!, object);
    expect(Buffer.from(payload.metadata!.encoding).toString()).toBe(
      'json/plain',
    );
    expect(JSON.parse(Buffer.from(payload.data!).toString())).toEqual(value);
  });

  it('keeps the driver name the workers chose', async () => {
    const stored = await storeExternally(
      memoryS3(),
      { a: 1 },
      {
        driverName: 'reports',
      },
    );
    expect(referenceOf(stored.payload)?.driverName).toBe('reports');
  });

  it('rejects objects that do not match the reference', async () => {
    const s3 = memoryS3();
    const stored = await storeExternally(s3, { a: 1 });
    const reference = referenceOf(stored.payload)!;
    const object = new Uint8Array(s3.objects.get(`payloads/${stored.key}`)!);
    object[object.length - 1] ^= 1;
    expect(() => verifyAndDecode(reference, object)).toThrow(
      StorageIntegrityError,
    );
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
      driverName: 'aws.s3driver',
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

describe('contentTypeOf', () => {
  it('knows JSON encodings and common binary formats', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
    ]);
    const webp = new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 '));
    expect(contentTypeOf('json/plain', new Uint8Array())).toBe(
      'application/json',
    );
    expect(contentTypeOf('binary/plain', png)).toBe('image/png');
    expect(
      contentTypeOf('binary/plain', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe('image/jpeg');
    expect(contentTypeOf('binary/plain', webp)).toBe('image/webp');
    expect(
      contentTypeOf('binary/plain', new Uint8Array(Buffer.from('%PDF-1.7'))),
    ).toBe('application/pdf');
    expect(contentTypeOf('binary/encrypted', new Uint8Array([1, 2, 3]))).toBe(
      'application/octet-stream',
    );
  });
});

describe('decodePayloadMessage', () => {
  const Payload = temporal.api.common.v1.Payload;

  it('reads what the SDK encodes, skipping other fields', () => {
    const data = new Uint8Array(300).map((_, i) => i % 256);
    const bytes = Payload.encode(
      Payload.create({
        metadata: {
          encoding: Buffer.from('binary/plain'),
          'x-empty': new Uint8Array(),
        },
        data,
        // A 64-bit field the decoder skips (a number is enough here).
        externalPayloads: [{ sizeBytes: 123456789 as any }],
      }),
    ).finish();
    const decoded = decodePayloadMessage(bytes);
    expect(Buffer.from(decoded.metadata!.encoding).toString()).toBe(
      'binary/plain',
    );
    expect(decoded.metadata!['x-empty']).toEqual(new Uint8Array());
    expect(decoded.data).toEqual(data);
  });

  it('reads an empty payload', () => {
    expect(decodePayloadMessage(new Uint8Array())).toEqual({
      metadata: {},
      data: new Uint8Array(),
    });
  });

  it('rejects data that is not a payload message', () => {
    expect(() => decodePayloadMessage(new Uint8Array([0x12, 0x05, 1]))).toThrow(
      'truncated field',
    );
    expect(() => decodePayloadMessage(new Uint8Array([0x0b]))).toThrow(
      'unsupported wire type 3',
    );
  });
});
