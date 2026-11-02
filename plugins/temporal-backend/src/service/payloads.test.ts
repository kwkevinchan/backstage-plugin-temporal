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

import { ConfigReader } from '@backstage/config';
import { createHash } from 'node:crypto';
import { toWorkflowSteps } from './convert';
import { ExternalPayloads, findClaimCheckPayloads } from './payloads';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** In-memory store with the methods the backend uses. */
function fakeStore(bucket = 'payloads') {
  const objects = new Map<string, Buffer>();
  const store = {
    bucket,
    get: jest.fn(async (key: string) => {
      const data = objects.get(key);
      if (!data) throw new Error(`NoSuchKey ${key}`);
      return new Uint8Array(data);
    }),
    getStart: jest.fn(async (key: string, bytes: number) => {
      const data = objects.get(key);
      if (!data) throw new Error(`NoSuchKey ${key}`);
      return new Uint8Array(data.subarray(0, bytes));
    }),
    stream: jest.fn(),
  };
  return { objects, store };
}

/** A claim check payload in protobuf JSON form, and its stored data. */
function claimCheck(
  data: Buffer,
  options: {
    key?: string;
    bucket?: string;
    encoding?: string;
    contentType?: string;
  } = {},
) {
  const check = {
    version: 1,
    store: 's3',
    bucket: options.bucket ?? 'payloads',
    key: options.key ?? `tp/default/wf-1/${sha(data)}`,
    size: data.length,
    sha256: sha(data),
    encoding: options.encoding ?? 'json/plain',
    contentType: options.contentType ?? 'application/json',
  };
  return {
    check,
    payload: {
      metadata: { encoding: b64('json/claim-check') },
      data: b64(JSON.stringify(check)),
    },
  };
}

function startedEvent(payload: unknown) {
  return {
    eventId: '1',
    eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
    workflowExecutionStartedEventAttributes: {
      input: { payloads: [payload] },
    },
  };
}

describe('ExternalPayloads', () => {
  const small = Buffer.from(JSON.stringify({ rows: [1, 2, 3] }));
  const large = Buffer.from(JSON.stringify({ text: 'x'.repeat(5000) }));

  it('shows small JSON payloads inline', async () => {
    const { objects, store } = fakeStore();
    const { check, payload } = claimCheck(small);
    objects.set(check.key, small);
    const payloads = new ExternalPayloads({ store, maxInlineBytes: 1000 });
    const events = [startedEvent(payload)];
    await payloads.resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/plain',
      value: { rows: [1, 2, 3] },
      external: expect.objectContaining({
        state: 'inline',
        key: check.key,
        size: small.length,
        downloadable: true,
      }),
    });
    // The second read comes from the cache.
    await payloads.resolve([startedEvent(claimCheck(small).payload)]);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('shows the size and a preview of larger payloads', async () => {
    const { objects, store } = fakeStore();
    const { check, payload } = claimCheck(large);
    objects.set(check.key, large);
    const payloads = new ExternalPayloads({
      store,
      maxInlineBytes: 1000,
      previewBytes: 20,
    });
    const events = [startedEvent(payload)];
    await payloads.resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/claim-check',
      external: {
        store: 's3',
        bucket: 'payloads',
        key: check.key,
        size: large.length,
        sha256: check.sha256,
        encoding: 'json/plain',
        contentType: 'application/json',
        state: 'preview',
        preview: large.subarray(0, 20).toString(),
        previewTruncated: true,
        downloadable: true,
      },
    });
    expect(store.get).not.toHaveBeenCalled();
  });

  it('gives binary payloads no text preview', async () => {
    const { objects, store } = fakeStore();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const { check, payload } = claimCheck(png, {
      encoding: 'binary/plain',
      contentType: 'image/png',
    });
    objects.set(check.key, png);
    const events = [startedEvent(payload)];
    await new ExternalPayloads({ store }).resolve(events);
    const input = toWorkflowSteps(events, false).input as any;
    expect(input.external.state).toBe('preview');
    expect(input.external.preview).toBeUndefined();
    expect(store.getStart).not.toHaveBeenCalled();
  });

  it('shows the claim check when S3 is not configured', async () => {
    const { check, payload } = claimCheck(large);
    const events = [startedEvent(payload)];
    await new ExternalPayloads().resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/claim-check',
      external: expect.objectContaining({
        state: 'unconfigured',
        key: check.key,
        size: large.length,
      }),
    });
    // Without resolving, the converter shows the same.
    expect(
      toWorkflowSteps([startedEvent(claimCheck(large).payload)], false).input,
    ).toEqual(toWorkflowSteps(events, false).input);
  });

  it('reports data that does not match the SHA-256', async () => {
    const { objects, store } = fakeStore();
    const { check, payload } = claimCheck(small);
    objects.set(check.key, Buffer.from(JSON.stringify({ rows: [9, 9, 9] })));
    const events = [startedEvent(payload)];
    await new ExternalPayloads({ store }).resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/claim-check',
      external: expect.objectContaining({
        state: 'error',
        error: expect.stringMatching(/SHA-256/),
        downloadable: false,
      }),
    });
  });

  it('reports claim checks of another bucket and S3 errors', async () => {
    const { store } = fakeStore();
    const other = claimCheck(small, { bucket: 'elsewhere' });
    const missing = claimCheck(small, { key: 'missing' });
    const events = [startedEvent(other.payload), startedEvent(missing.payload)];
    await new ExternalPayloads({ store }).resolve(events);
    const [a, b] = events.map(e => toWorkflowSteps([e], false).input as any);
    expect(a.external).toMatchObject({
      state: 'error',
      error: 'Stored in bucket elsewhere; Backstage reads payloads',
    });
    expect(b.external).toMatchObject({
      state: 'error',
      error: 'NoSuchKey missing',
    });
  });

  it('finds claim checks anywhere in the events', () => {
    const one = claimCheck(small, { key: 'a' });
    const two = claimCheck(large, { key: 'b' });
    const found = findClaimCheckPayloads([
      startedEvent(one.payload),
      {
        activityTaskCompletedEventAttributes: {
          result: { payloads: [two.payload] },
        },
      },
      startedEvent({
        metadata: { encoding: b64('json/claim-check') },
        data: b64('{'),
      }),
    ]);
    expect(found.map(f => f.check.key).sort()).toEqual(['a', 'b']);
  });

  it('reads its configuration', () => {
    expect(ExternalPayloads.fromConfig(new ConfigReader({})).configured).toBe(
      false,
    );
    const payloads = ExternalPayloads.fromConfig(
      new ConfigReader({
        temporal: {
          payloads: {
            s3: {
              bucket: 'b',
              endpoint: 'http://localhost:9100',
              forcePathStyle: true,
              credentials: { accessKeyId: 'a', secretAccessKey: 's' },
              maxInlineBytes: 10,
            },
          },
        },
      }),
    );
    expect(payloads.configured).toBe(true);
    expect(payloads.maxInlineBytes).toBe(10);
    expect(payloads.previewBytes).toBe(2048);
    expect(() =>
      ExternalPayloads.fromConfig(
        new ConfigReader({
          temporal: {
            payloads: {
              s3: {
                bucket: 'b',
                credentials: { accessKeyId: 'a', secretAccessKey: 's' },
                maxInlineBytes: -1,
              },
            },
          },
        }),
      ),
    ).toThrow(/maxInlineBytes/);
  });
});
