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
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalAccessServiceFactory } from './alpha';
import { temporalPlugin } from './plugin';
import {
  createFakeConnection,
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
} from './testUtils';
import { loadOpenApiSpec } from './routes/openApiRoutes';

async function start(control?: { enabled: boolean }) {
  const workflowService = createFakeWorkflowService();
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.DENY })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [] }),
      fakeTemporalServiceFactory(workflowService, {
        connection: createFakeConnection(workflowService),
      }),
      permissions.factory,
      mockServices.rootConfig.factory({
        data: control ? { temporal: { control } } : {},
      }),
    ],
  });
  return server;
}

const operationPaths = (paths: Record<string, any>, control: boolean) =>
  Object.entries<any>(paths)
    .filter(([, item]) =>
      Object.values<any>(item).some(o => o['x-temporal-control'] === control),
    )
    .map(([path]) => path);

describe('GET /api/temporal/openapi.json', () => {
  it('serves the spec with the paths under /api/temporal', async () => {
    const server = await start();
    const response = await request(server)
      .get('/api/temporal/openapi.json?x=1')
      .expect(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.1.0');
    const paths = Object.keys(response.body.paths);
    expect(paths.length).toBe(Object.keys(loadOpenApiSpec().paths).length);
    expect(paths.every(p => p.startsWith('/api/temporal/'))).toBe(true);
    expect(paths).toContain('/api/temporal/openapi.json');
    expect(paths).toContain('/api/temporal/workflows');
    expect(response.body.components).toEqual(loadOpenApiSpec().components);
  });

  it('keeps the operations that change workflows by default', async () => {
    const server = await start({ enabled: true });
    const { body } = await request(server).get('/api/temporal/openapi.json');
    expect(operationPaths(body.paths, true).length).toBeGreaterThan(0);
  });

  it('leaves the operations out when temporal.control.enabled is false', async () => {
    const server = await start({ enabled: false });
    const { body } = await request(server)
      .get('/api/temporal/openapi.json')
      .expect(200);
    expect(operationPaths(body.paths, true)).toEqual([]);
    expect(
      JSON.stringify(body.paths).includes('"x-temporal-control":true'),
    ).toBe(false);
    expect(body.paths['/api/temporal/workflows']).toBeDefined();
    // The shared copy is not changed by serving a filtered one.
    expect(
      operationPaths((loadOpenApiSpec() as any).paths, true).length,
    ).toBeGreaterThan(0);
  });

  it('has references that all resolve', async () => {
    const server = await start();
    const { body } = await request(server).get('/api/temporal/openapi.json');
    // Every $ref resolves inside the document.
    const refs = [...JSON.stringify(body).matchAll(/"\$ref":"#\/([^"]+)"/g)];
    expect(refs.length).toBeGreaterThan(0);
    for (const [, ref] of refs) {
      let node: any = body;
      for (const part of ref.split('/')) node = node?.[part];
      expect(node).toBeDefined();
    }
  });

  it('needs credentials', async () => {
    const server = await start();
    await request(server)
      .get('/api/temporal/openapi.json')
      .set('Authorization', mockCredentials.none.header())
      .expect(401);
  });

  it('answers a service with its credentials', async () => {
    const server = await start();
    await request(server)
      .get('/api/temporal/openapi.json')
      .set('Authorization', mockCredentials.service.header())
      .expect(200);
  });
});
