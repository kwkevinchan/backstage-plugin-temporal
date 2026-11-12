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
 * The module without the Temporal backend plugin, in a real backend
 * (`createBackend()`): the backend starts and skips the module, so the
 * definition route does not exist.
 */
import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';
import { createServer } from 'node:net';
import temporalModuleZigflow from './index';

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

describe('the Zigflow module without the Temporal backend plugin', () => {
  it('lets the backend start and serves nothing', async () => {
    const port = await freePort();
    const backend = createBackend();
    backend.add(temporalModuleZigflow);
    backend.add(
      mockServices.rootConfig.factory({
        data: {
          backend: {
            baseUrl: `http://127.0.0.1:${port}`,
            listen: { port, host: '127.0.0.1' },
            database: { client: 'better-sqlite3', connection: ':memory:' },
          },
        },
      }),
    );
    await backend.start();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/temporal/entities/temporalworkflow/default/flow/definition`,
      );
      expect(res.status).toBe(404);
    } finally {
      await backend.stop();
    }
  });
});
