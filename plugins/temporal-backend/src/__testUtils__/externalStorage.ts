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

import {
  defaultPayloadConverter,
  StorageDriverClaim,
} from '@temporalio/common';
import { encodeReferencePayload } from '@temporalio/common/lib/internal-non-workflow';
import { S3StorageDriver } from '@temporalio/external-storage-s3';
import { temporal } from '@temporalio/proto';

/*
 * Test data of Temporal External Storage, written by the official S3 driver
 * of the TypeScript SDK into an in-memory S3, so the tests read exactly what
 * workers store.
 */

/** An in-memory S3: objects by bucket and key. */
export function memoryS3() {
  const objects = new Map<string, Uint8Array>();
  const id = (bucket: string, key: string) => `${bucket}/${key}`;
  return {
    objects,
    /** The client the S3 driver writes with. */
    client: {
      async putObject(bucket: string, key: string, data: Uint8Array) {
        objects.set(id(bucket, key), new Uint8Array(data));
      },
      async objectExists(bucket: string, key: string) {
        return objects.has(id(bucket, key));
      },
      async getObject(bucket: string, key: string) {
        const data = objects.get(id(bucket, key));
        if (!data) throw new Error(`NoSuchKey ${key}`);
        return data;
      },
    },
    /** What `PayloadStore` reads with, for one bucket. */
    store(bucket = 'payloads') {
      return {
        bucket,
        get: jest.fn(async (key: string) => {
          const data = objects.get(id(bucket, key));
          if (!data) throw new Error(`NoSuchKey ${key}`);
          return data;
        }),
      };
    },
  };
}

type MemoryS3 = ReturnType<typeof memoryS3>;

/**
 * Stores a value (JSON, or bytes for a binary payload) with the S3 driver
 * and returns the reference payload in the protobuf JSON form of a history.
 */
export async function storeExternally(
  s3: MemoryS3,
  value: unknown,
  options: { bucket?: string; driverName?: string; workflowId?: string } = {},
) {
  const driver = new S3StorageDriver({
    client: s3.client,
    bucket: options.bucket ?? 'payloads',
    driverName: options.driverName,
  });
  const stored = defaultPayloadConverter.toPayload(value);
  const [claim] = await driver.store(
    {
      target: {
        kind: 'workflow',
        namespace: 'default',
        type: 'exampleWorkflow',
        id: options.workflowId ?? 'wf-1',
        runId: 'run-1',
      },
    } as any,
    [stored],
  );
  const size = temporal.api.common.v1.Payload.encode(stored).finish().length;
  const reference = encodeReferencePayload({
    driverName: driver.name,
    claim: new StorageDriverClaim(claim.claimData),
    sizeBytes: size,
  });
  const payload = temporal.api.common.v1.Payload.create(reference).toJSON();
  return {
    payload,
    key: claim.claimData.key,
    sha256: claim.claimData.hash_value,
    /** Size of the stored payload (the object). */
    size,
    /** Size of the data of the stored payload. */
    dataSize: stored.data?.length ?? 0,
  };
}
