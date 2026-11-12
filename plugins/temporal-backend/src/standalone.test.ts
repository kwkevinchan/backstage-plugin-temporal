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

/*
 * The backend package on its own, without the frontend or any other package
 * of this repository: other backend code reaches Temporal through
 * `temporalServiceRef`, modules can add enrichers and control actions, and
 * a real backend (`createBackend()`) without the catalog plugin starts and
 * skips the catalog module.
 */
import { createBackend } from '@backstage/backend-defaults';
import {
  coreServices,
  createBackendModule,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { mockServices } from '@backstage/backend-test-utils';
import * as grpc from '@grpc/grpc-js';
import { createServer } from 'node:net';
import Router from 'express-promise-router';
import { temporalWorkflowUpdatePermission } from './common';
import { temporalControlExtensionPoint } from './alpha';
import { temporalExtensionPoint, temporalServiceRef } from './node';
import temporalBackend from './index';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
} from './testUtils';

jest.setTimeout(60_000);

/** A gRPC server that records the calls it gets and answers UNIMPLEMENTED. */
async function startRecordingServer() {
  const calls: string[] = [];
  const server = new grpc.Server();
  const names = ['GetSystemInfo', 'ListWorkflowExecutions'];
  const method = (name: string) => ({
    path: `/temporal.api.workflowservice.v1.WorkflowService/${name}`,
    requestStream: false,
    responseStream: false,
    requestSerialize: (v: Buffer) => v,
    requestDeserialize: (v: Buffer) => v,
    responseSerialize: (v: Buffer) => v,
    responseDeserialize: (v: Buffer) => v,
  });
  server.addService(
    Object.fromEntries(names.map(n => [n, method(n)])) as any,
    Object.fromEntries(
      names.map(n => [
        n,
        (_call: any, callback: any) => {
          calls.push(n);
          callback({ code: grpc.status.UNIMPLEMENTED, details: 'test' });
        },
      ]),
    ) as any,
  );
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (error, p) => (error ? reject(error) : resolve(p)),
    ),
  );
  return { calls, address: `127.0.0.1:${port}`, server };
}

/** Another backend plugin that lists workflows with the shared client. */
const consumerPlugin = createBackendPlugin({
  pluginId: 'consumer',
  register(env) {
    env.registerInit({
      deps: {
        temporal: temporalServiceRef,
        httpRouter: coreServices.httpRouter,
      },
      async init({ temporal, httpRouter }) {
        httpRouter.addAuthPolicy({ path: '/list', allow: 'unauthenticated' });
        const router = Router();
        router.get('/list', async (_req, res) => {
          const client = await temporal.getClient();
          const error = await client.workflowService
            .listWorkflowExecutions({ namespace: client.options.namespace })
            .then(
              () => undefined,
              e => String(e),
            );
          res.json({ namespace: client.options.namespace, error });
        });
        httpRouter.use(router);
      },
    });
  },
});

const extensionsModule = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'test-extensions',
  register(reg) {
    reg.registerInit({
      deps: {
        enrichers: temporalExtensionPoint,
        control: temporalControlExtensionPoint,
      },
      async init({ enrichers, control }) {
        enrichers.addWorkflowEnricher({
          id: 'test',
          enrich: async items => items,
        });
        control.addControlAction({
          id: 'escalate',
          permission: temporalWorkflowUpdatePermission,
          handle: async () => ({ ok: true }),
        });
      },
    });
  },
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      s.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

/** Starts a real backend (`createBackend()`) on a free port. */
async function startBackend(features: any[], temporal: object) {
  const port = await freePort();
  const backend = createBackend();
  for (const feature of features) backend.add(feature);
  backend.add(
    mockServices.rootConfig.factory({
      data: {
        backend: {
          baseUrl: `http://127.0.0.1:${port}`,
          listen: { port, host: '127.0.0.1' },
          database: { client: 'better-sqlite3', connection: ':memory:' },
        },
        temporal,
      },
    }),
  );
  await backend.start();
  return { backend, base: `http://127.0.0.1:${port}` };
}

describe('the backend package without anything else of this repository', () => {
  it('gives other backend plugins the Temporal client, and takes enrichers and control actions', async () => {
    const recording = await startRecordingServer();
    const { backend, base } = await startBackend(
      [temporalBackend, consumerPlugin, extensionsModule],
      { connection: { address: recording.address } },
    );
    try {
      const res = await fetch(`${base}/api/consumer/list`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.namespace).toBe('default');
      // The call reached the Temporal server (which answers UNIMPLEMENTED).
      expect(body.error).toMatch(/UNIMPLEMENTED/);
      expect(recording.calls).toContain('ListWorkflowExecutions');
    } finally {
      await backend.stop();
      recording.server.forceShutdown();
    }
  });
});

describe('a real backend without the catalog plugin', () => {
  it('starts and skips the catalog module', async () => {
    const { backend, base } = await startBackend(
      [
        temporalBackend,
        fakeTemporalServiceFactory(createFakeWorkflowService()),
      ],
      { connection: { address: 'localhost:7233' } },
    );
    try {
      // The plugin's routes are there (and ask for credentials).
      expect((await fetch(`${base}/api/temporal/workflows`)).status).toBe(401);
      // No catalog plugin, so no catalog routes.
      expect((await fetch(`${base}/api/catalog/entities`)).status).toBe(404);
    } finally {
      await backend.stop();
    }
  });
});
