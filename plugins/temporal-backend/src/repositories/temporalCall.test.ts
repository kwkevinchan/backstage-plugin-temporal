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

import { Connection } from '@temporalio/client';
import { mapTemporalError } from './errors';
import { callTemporal } from './temporalCall';

describe('callTemporal', () => {
  it('runs the call under the deadline and maps its errors', async () => {
    const withDeadline = jest.fn(
      async (_at: number, fn: () => Promise<unknown>) => await fn(),
    );
    const connection = { withDeadline } as unknown as Connection;
    const temporal = { getConnection: async () => connection };
    const before = Date.now();
    await expect(
      callTemporal(temporal, 10_000, mapTemporalError, async c => {
        expect(c).toBe(connection);
        throw Object.assign(new Error('slow'), { code: 4 });
      }),
    ).rejects.toMatchObject({
      name: 'ServiceUnavailableError',
      message: 'Temporal did not answer in time: slow',
    });
    const at = withDeadline.mock.calls[0][0];
    expect(at).toBeGreaterThanOrEqual(before + 10_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it('answers 503 when the connection cannot be opened', async () => {
    const call = jest.fn();
    const temporal = {
      getConnection: async () => {
        throw new Error('Failed to connect before the deadline');
      },
    };
    await expect(
      callTemporal(temporal, 10_000, mapTemporalError, call),
    ).rejects.toMatchObject({
      name: 'ServiceUnavailableError',
      message:
        'Temporal is not reachable: Failed to connect before the deadline',
    });
    expect(call).not.toHaveBeenCalled();
  });

  it('times out a call to a server that does not answer', async () => {
    // A real client: the deadline reaches the gRPC request made inside the
    // call (no server listens on the address, and the client retries until
    // the deadline).
    const connection = Connection.lazy({ address: '127.0.0.1:1' });
    try {
      const started = Date.now();
      await expect(
        callTemporal(
          { getConnection: async () => connection },
          300,
          mapTemporalError,
          c => c.workflowService.getSystemInfo({}),
        ),
      ).rejects.toMatchObject({
        name: 'ServiceUnavailableError',
        message: expect.stringContaining('Temporal did not answer in time'),
      });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await connection.close();
    }
  });
});
