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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';

/** Objects of the mocked S3 service, by key. */
const mockObjects = new Map<string, Buffer>();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: async (command: any) => {
        const data = mockObjects.get(command.input.Key);
        if (!data) throw new Error('NoSuchKey');
        let body = data;
        const range = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range ?? '');
        if (range) body = data.subarray(Number(range[1]), Number(range[2]) + 1);
        const stream = Readable.from([body]) as any;
        stream.transformToByteArray = async () => new Uint8Array(body);
        return { Body: stream, ContentLength: body.length };
      },
    })),
  };
});

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const ref = 'component:default/orders';
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(1000, 7),
]);
const key = `tp/default/wf-1/${sha(png)}`;

function claimCheckPayload(data: Buffer, k: string) {
  return {
    metadata: { encoding: b64('json/claim-check') },
    data: b64(
      JSON.stringify({
        version: 1,
        store: 's3',
        bucket: 'payloads',
        key: k,
        size: data.length,
        sha256: sha(data),
        encoding: 'binary/plain',
        contentType: 'image/png',
      }),
    ),
  };
}

async function start(options: {
  s3?: boolean;
  permission?: AuthorizeResult.ALLOW | AuthorizeResult.DENY;
}) {
  const workflowService = createFakeWorkflowService();
  workflowService.getWorkflowExecutionHistory.mockImplementation(
    async () =>
      ({
        history: {
          events: [
            {
              eventId: '1',
              eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
              workflowExecutionStartedEventAttributes: {
                input: { payloads: [claimCheckPayload(png, key)] },
              },
            },
          ],
        },
        nextPageToken: new Uint8Array(),
      } as any),
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({
        result: options.permission ?? AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const config = options.s3
    ? {
        temporal: {
          payloads: {
            s3: {
              bucket: 'payloads',
              endpoint: 'http://localhost:9100',
              forcePathStyle: true,
              credentials: { accessKeyId: 'a', secretAccessKey: 's' },
            },
          },
        },
      }
    : {};
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      mockServices.rootConfig.factory({ data: config }),
    ],
  });
  return { server, permissions };
}

const download = (k: string) =>
  `/api/temporal/namespaces/default/workflows/wf-1/payloads/download?entityRef=${ref}&key=${encodeURIComponent(
    k,
  )}`;

describe('payload downloads', () => {
  beforeEach(() => {
    mockObjects.clear();
    mockObjects.set(key, png);
  });

  it('downloads a stored payload of the run', async () => {
    const { server, permissions } = await start({ s3: true });
    const res = await request(server)
      .get(download(key))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^attachment; /);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body, png)).toBe(0);
    expect(permissions.authorize).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          permission: expect.objectContaining({
            name: 'temporal.workflow.history.read',
          }),
        }),
      ],
      expect.anything(),
    );
  });

  it('shows the stored payload in the steps', async () => {
    const { server } = await start({ s3: true });
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/steps?entityRef=${ref}`,
    );
    expect(res.body.input).toEqual({
      encoding: 'json/claim-check',
      external: expect.objectContaining({
        state: 'preview',
        contentType: 'image/png',
        downloadable: true,
      }),
    });
  });

  it('only downloads keys of the run', async () => {
    mockObjects.set('other/secret', Buffer.from('secret'));
    const { server } = await start({ s3: true });
    await request(server).get(download('other/secret')).expect(404);
    await request(server)
      .get(`${download(key)}`.replace(/&key=.*/, ''))
      .expect(400);
  });

  it('needs the history permission', async () => {
    const { server } = await start({
      s3: true,
      permission: AuthorizeResult.DENY,
    });
    await request(server).get(download(key)).expect(403);
  });

  it('answers 404 without S3 configuration', async () => {
    const { server } = await start({});
    await request(server).get(download(key)).expect(404);
    const steps = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/steps?entityRef=${ref}`,
    );
    expect(steps.status).toBe(200);
    expect(steps.body.input.external.state).toBe('unconfigured');
  });

  it('aborts a download whose data does not match', async () => {
    mockObjects.set(
      key,
      Buffer.concat([png.subarray(0, 999), Buffer.from([0])]),
    );
    const { server } = await start({ s3: true });
    await expect(request(server).get(download(key))).rejects.toThrow();
  });
});
