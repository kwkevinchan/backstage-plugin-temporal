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
import { memoryS3, storeExternally } from '../__testUtils__/externalStorage';
import { toWorkflowSteps } from '../services/convert';
import { findReferencePayloads, PayloadStore } from './PayloadStore';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

function startedEvent(payload: unknown) {
  return {
    eventId: '1',
    eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
    workflowExecutionStartedEventAttributes: {
      input: { payloads: [payload] },
    },
  };
}

describe('PayloadStore', () => {
  const small = { rows: [1, 2, 3] };
  const large = { text: 'x'.repeat(5000) };
  const largeJson = JSON.stringify(large);

  it('shows small JSON payloads inline', async () => {
    const s3 = memoryS3();
    const store = s3.store();
    const stored = await storeExternally(s3, small);
    const payloads = new PayloadStore({ store, maxInlineBytes: 1000 });
    const events = [startedEvent(stored.payload)];
    await payloads.resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/plain',
      value: { rows: [1, 2, 3] },
      external: expect.objectContaining({
        state: 'inline',
        key: stored.key,
        size: JSON.stringify(small).length,
        encoding: 'json/plain',
        contentType: 'application/json',
        downloadable: true,
      }),
    });
    // The second read comes from the cache.
    const again = await storeExternally(s3, small);
    await payloads.resolve([startedEvent(again.payload)]);
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('shows the size and a preview of larger payloads', async () => {
    const s3 = memoryS3();
    const stored = await storeExternally(s3, large);
    const payloads = new PayloadStore({
      store: s3.store(),
      maxInlineBytes: 1000,
      previewBytes: 20,
    });
    const events = [startedEvent(stored.payload)];
    await payloads.resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/plain',
      external: {
        store: 's3',
        bucket: 'payloads',
        key: stored.key,
        size: largeJson.length,
        sha256: stored.sha256,
        encoding: 'json/plain',
        contentType: 'application/json',
        state: 'preview',
        preview: largeJson.slice(0, 20),
        previewTruncated: true,
        downloadable: true,
      },
    });
  });

  it('gives binary payloads a media type and no text preview', async () => {
    const s3 = memoryS3();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
    ]);
    const stored = await storeExternally(s3, png);
    const events = [startedEvent(stored.payload)];
    await new PayloadStore({ store: s3.store() }).resolve(events);
    const input = toWorkflowSteps(events, false).input as any;
    expect(input.encoding).toBe('binary/plain');
    expect(input.external).toMatchObject({
      state: 'preview',
      contentType: 'image/png',
      size: png.length,
    });
    expect(input.external.preview).toBeUndefined();
  });

  it('shows the reference when S3 is not configured', async () => {
    const s3 = memoryS3();
    const stored = await storeExternally(s3, large);
    const events = [startedEvent(stored.payload)];
    await new PayloadStore().resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/protobuf',
      external: {
        store: 's3',
        bucket: 'payloads',
        key: stored.key,
        size: stored.size,
        sha256: stored.sha256,
        encoding: '',
        contentType: '',
        state: 'unconfigured',
      },
    });
    // Without resolving, the converter shows the same.
    expect(
      toWorkflowSteps([startedEvent(stored.payload)], false).input,
    ).toEqual(toWorkflowSteps(events, false).input);
  });

  it('reports objects that do not match the SHA-256', async () => {
    const s3 = memoryS3();
    const stored = await storeExternally(s3, small);
    const other = await storeExternally(s3, { rows: [9, 9, 9] });
    s3.objects.set(
      `payloads/${stored.key}`,
      s3.objects.get(`payloads/${other.key}`)!,
    );
    const events = [startedEvent(stored.payload)];
    await new PayloadStore({ store: s3.store() }).resolve(events);
    expect(toWorkflowSteps(events, false).input).toEqual({
      encoding: 'json/protobuf',
      external: expect.objectContaining({
        state: 'error',
        error: expect.stringMatching(/SHA-256/),
        downloadable: false,
      }),
    });
  });

  it('reports another bucket, another driver and S3 errors', async () => {
    const s3 = memoryS3();
    const elsewhere = await storeExternally(s3, small, { bucket: 'elsewhere' });
    const driver = await storeExternally(s3, small, { driverName: 'reports' });
    const missing = await storeExternally(s3, { a: 1 });
    s3.objects.clear();
    const events = [elsewhere, driver, missing].map(s =>
      startedEvent(s.payload),
    );
    const logger = { warn: jest.fn() };
    await new PayloadStore({
      store: s3.store(),
      logger: logger as any,
    }).resolve(events);
    const [a, b, c] = events.map(
      e => (toWorkflowSteps([e], false).input as any).external,
    );
    expect(a).toMatchObject({
      state: 'error',
      error: 'Stored in bucket elsewhere; Backstage reads payloads',
    });
    expect(b).toMatchObject({
      state: 'error',
      error:
        'Stored with the storage driver reports; Backstage reads aws.s3driver',
    });
    // The error of S3 stays in the backend log.
    expect(c).toMatchObject({
      state: 'error',
      error: 'Could not read the stored payload from S3; see the backend log',
      downloadable: false,
    });
    expect(JSON.stringify(c)).not.toContain('NoSuchKey');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      `Could not read the stored payload ${missing.key} from S3: Error: NoSuchKey ${missing.key}`,
    );
  });

  it('finds references anywhere in the events', async () => {
    const s3 = memoryS3();
    const one = await storeExternally(s3, small, { workflowId: 'a' });
    const two = await storeExternally(s3, large, { workflowId: 'b' });
    const found = findReferencePayloads([
      startedEvent(one.payload),
      {
        activityTaskCompletedEventAttributes: {
          result: { payloads: [two.payload] },
        },
      },
      startedEvent({
        metadata: {
          encoding: b64('json/protobuf'),
          messageType: b64('temporal.api.sdk.v1.ExternalStorageReference'),
        },
        data: b64('{'),
      }),
    ]);
    expect(found.map(f => f.reference.key).sort()).toEqual(
      [one.key, two.key].sort(),
    );
  });

  it('reads its configuration', () => {
    expect(PayloadStore.fromConfig(new ConfigReader({})).configured).toBe(
      false,
    );
    const payloads = PayloadStore.fromConfig(
      new ConfigReader({
        temporal: {
          externalStorage: {
            s3: {
              bucket: 'b',
              driverName: 'reports',
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
    expect(payloads.driverName).toBe('reports');
    expect(payloads.maxInlineBytes).toBe(10);
    expect(payloads.previewBytes).toBe(2048);
    expect(
      PayloadStore.fromConfig(
        new ConfigReader({
          temporal: {
            externalStorage: {
              s3: {
                bucket: 'b',
                credentials: { accessKeyId: 'a', secretAccessKey: 's' },
              },
            },
          },
        }),
      ).driverName,
    ).toBe('aws.s3driver');
    expect(() =>
      PayloadStore.fromConfig(
        new ConfigReader({
          temporal: {
            externalStorage: {
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
    expect(() =>
      PayloadStore.fromConfig(
        new ConfigReader({
          temporal: { externalStorage: { s3: { bucket: 'b' } } },
        }),
      ),
    ).toThrow(/needs exactly one source of S3 credentials/);
  });
});
