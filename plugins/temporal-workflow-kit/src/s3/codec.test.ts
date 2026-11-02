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

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CLAIM_CHECK_ENCODING,
  ClaimCheckIntegrityError,
  claimCheckKey,
  createS3DataConverter,
  detectContentType,
  parseClaimCheck,
  Payload,
  S3PayloadCodec,
  S3PayloadStore,
  sha256Hex,
  validateClaimCheck,
} from './index';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** In-memory S3: PutObject and GetObject (with Range). */
function mockS3() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  const send = jest.fn(async (command: any) => {
    const { Bucket, Key } = command.input;
    const id = `${Bucket}/${Key}`;
    if (command instanceof PutObjectCommand) {
      objects.set(id, {
        body: Buffer.from(command.input.Body as Uint8Array),
        contentType: command.input.ContentType,
      });
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const object = objects.get(id);
      if (!object)
        throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      let body = object.body;
      const range = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range ?? '');
      if (range) body = body.subarray(Number(range[1]), Number(range[2]) + 1);
      return {
        ContentLength: body.length,
        Body: { transformToByteArray: async () => body },
      };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  return { objects, client: { send } };
}

function jsonPayload(value: unknown): Payload {
  return {
    metadata: { encoding: enc.encode('json/plain') },
    data: enc.encode(JSON.stringify(value)),
  };
}

function sized(bytes: number): Payload {
  // `"` + n x `a` + `"` is n + 2 bytes of JSON.
  return jsonPayload('a'.repeat(bytes - 2));
}

const context = { type: 'workflow', namespace: 'default', workflowId: 'wf/1' };

describe('S3PayloadCodec', () => {
  function setup(thresholdBytes = 100) {
    const s3 = mockS3();
    const store = new S3PayloadStore({ bucket: 'payloads', client: s3.client });
    const codec = new S3PayloadCodec({ store, thresholdBytes, prefix: 'tp' });
    return { s3, codec };
  }

  it('stores a large payload and restores it', async () => {
    const { s3, codec } = setup();
    const original = jsonPayload({ rows: 'x'.repeat(500) });
    const [encoded] = await codec.encode([original], context);
    expect(dec.decode(encoded.metadata!.encoding)).toBe(CLAIM_CHECK_ENCODING);
    const check = parseClaimCheck(encoded);
    const sha = sha256Hex(original.data!);
    expect(check).toEqual({
      version: 1,
      store: 's3',
      bucket: 'payloads',
      key: `tp/default/wf%2F1/${sha}`,
      size: original.data!.length,
      sha256: sha,
      encoding: 'json/plain',
      contentType: 'application/json',
    });
    expect(s3.objects.get(`payloads/${check.key}`)?.contentType).toBe(
      'application/json',
    );
    const [decoded] = await codec.decode([encoded]);
    expect(dec.decode(decoded.metadata!.encoding)).toBe('json/plain');
    expect(Buffer.from(decoded.data!)).toEqual(Buffer.from(original.data!));
  });

  it('keeps payloads at or below the threshold in the history', async () => {
    const { s3, codec } = setup(100);
    const atThreshold = sized(100);
    const above = sized(101);
    expect(atThreshold.data!.length).toBe(100);
    const [a, b] = await codec.encode([atThreshold, above], context);
    expect(a).toBe(atThreshold);
    expect(dec.decode(b.metadata!.encoding)).toBe(CLAIM_CHECK_ENCODING);
    expect(s3.client.send).toHaveBeenCalledTimes(1);
  });

  it('keeps other metadata and binary content types', async () => {
    const { codec } = setup(10);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100, 1),
    ]);
    const original: Payload = {
      metadata: {
        encoding: enc.encode('binary/plain'),
        'encoding-original': enc.encode('x'),
      },
      data: png,
    };
    const [encoded] = await codec.encode([original]);
    const check = parseClaimCheck(encoded);
    expect(check.contentType).toBe('image/png');
    expect(check.key).toBe(`tp/_/_/${sha256Hex(png)}`);
    expect(check.metadata).toEqual({
      'encoding-original': Buffer.from('x').toString('base64'),
    });
    const [decoded] = await codec.decode([encoded]);
    expect(dec.decode(decoded.metadata!['encoding-original'])).toBe('x');
    expect(dec.decode(decoded.metadata!.encoding)).toBe('binary/plain');
  });

  it('fails when the stored data does not match the SHA-256', async () => {
    const { s3, codec } = setup();
    const [encoded] = await codec.encode([sized(300)], context);
    const check = parseClaimCheck(encoded);
    const stored = s3.objects.get(`payloads/${check.key}`)!;
    stored.body = Buffer.from(stored.body);
    stored.body[5] ^= 0xff;
    await expect(codec.decode([encoded])).rejects.toThrow(
      ClaimCheckIntegrityError,
    );
    await expect(codec.decode([encoded])).rejects.toThrow(/SHA-256/);
  });

  it('fails when the stored data has another size', async () => {
    const { s3, codec } = setup();
    const [encoded] = await codec.encode([sized(300)], context);
    const check = parseClaimCheck(encoded);
    s3.objects.get(`payloads/${check.key}`)!.body = new Uint8Array(3);
    await expect(codec.decode([encoded])).rejects.toThrow(/3 bytes/);
  });

  it('refuses claim checks of another bucket', async () => {
    const { codec } = setup();
    const [encoded] = await codec.encode([sized(300)], context);
    const other = new S3PayloadCodec({
      store: new S3PayloadStore({ bucket: 'other', client: mockS3().client }),
    });
    await expect(other.decode([encoded])).rejects.toThrow(/bucket payloads/);
  });

  it('passes other payloads through decode', async () => {
    const { codec } = setup();
    const plain = jsonPayload(1);
    expect(await codec.decode([plain])).toEqual([plain]);
  });

  it('builds data converter options', () => {
    const converter = createS3DataConverter({
      store: { bucket: 'b', client: mockS3().client },
    });
    expect(converter.payloadCodecs).toHaveLength(1);
    expect(converter.payloadCodecs[0]).toBeInstanceOf(S3PayloadCodec);
    expect((converter.payloadCodecs[0] as S3PayloadCodec).thresholdBytes).toBe(
      128 * 1024,
    );
  });
});

describe('S3PayloadStore', () => {
  it('needs credentials without a client', () => {
    expect(() => new S3PayloadStore({ bucket: 'b' })).toThrow(/credentials/);
    expect(
      () =>
        new S3PayloadStore({
          bucket: 'b',
          endpoint: 'http://localhost:9100',
          forcePathStyle: true,
          credentials: { accessKeyId: 'a', secretAccessKey: 's' },
        }),
    ).not.toThrow();
  });

  it('reads the start of an object', async () => {
    const s3 = mockS3();
    const store = new S3PayloadStore({ bucket: 'b', client: s3.client });
    await store.put('k', enc.encode('hello world'), {
      contentType: 'text/plain',
      sha256: 'x',
    });
    expect(dec.decode(await store.getStart('k', 5))).toBe('hello');
    expect(dec.decode(await store.getStart('k', 50))).toBe('hello world');
  });
});

describe('claim checks', () => {
  it('builds keys without slashes in the parts', () => {
    expect(
      claimCheckKey('/p/', { namespace: 'ns', workflowId: '..' }, 'a'),
    ).toBe('p/ns/%2E./a');
    expect(claimCheckKey('', undefined, 'a')).toBe('_/_/a');
  });

  it('validates claim checks', () => {
    const good = {
      version: 1,
      store: 's3',
      bucket: 'b',
      key: 'k',
      size: 1,
      sha256: 'a'.repeat(64),
      encoding: 'json/plain',
      contentType: 'application/json',
    };
    expect(validateClaimCheck(good)).toEqual(good);
    expect(() => validateClaimCheck({ ...good, version: 2 })).toThrow(
      /version/,
    );
    expect(() => validateClaimCheck({ ...good, sha256: 'x' })).toThrow(
      /sha256/,
    );
    expect(() => validateClaimCheck({ ...good, size: -1 })).toThrow(/size/);
    expect(() => validateClaimCheck({ ...good, key: '' })).toThrow(/key/);
    expect(() =>
      parseClaimCheck({
        metadata: { encoding: enc.encode(CLAIM_CHECK_ENCODING) },
        data: enc.encode('{'),
      }),
    ).toThrow(/JSON/);
  });

  it('detects content types', () => {
    const bin = (bytes: number[]) => ({
      metadata: { encoding: enc.encode('binary/plain') },
      data: new Uint8Array(bytes),
    });
    expect(detectContentType(bin([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
    expect(
      detectContentType(
        bin([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
    expect(detectContentType(bin([1, 2]))).toBe('application/octet-stream');
    expect(
      detectContentType({
        metadata: {
          encoding: enc.encode('binary/plain'),
          contentType: enc.encode('text/csv'),
        },
        data: new Uint8Array(),
      }),
    ).toBe('text/csv');
  });
});
