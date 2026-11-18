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
import { recordingLogger } from '../__testUtils__/recordingLogger';
import { callTemporal, QUERY_CALL } from './temporalCall';

const options = (
  logger = recordingLogger(),
  more: { temporalCall?: string; timeoutMs?: number } = {},
) => ({
  timeoutMs: more.timeoutMs ?? 10_000,
  mapError: mapTemporalError,
  temporalCall: more.temporalCall ?? 'describeWorkflowExecution',
  namespace: 'default',
  logger,
});

describe('callTemporal', () => {
  it('runs the call under the deadline and maps its errors', async () => {
    const withDeadline = jest.fn(
      async (_at: number, fn: () => Promise<unknown>) => await fn(),
    );
    const connection = { withDeadline } as unknown as Connection;
    const temporal = { getConnection: async () => connection };
    const before = Date.now();
    await expect(
      callTemporal(temporal, options(), async c => {
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
    await expect(callTemporal(temporal, options(), call)).rejects.toMatchObject(
      {
        name: 'ServiceUnavailableError',
        message:
          'Temporal is not reachable: Failed to connect before the deadline',
      },
    );
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
          options(undefined, { timeoutMs: 300 }),
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

  describe('logs', () => {
    const withConnection = () => {
      const connection = {
        withDeadline: async (_at: number, fn: () => Promise<unknown>) =>
          await fn(),
      } as unknown as Connection;
      return { getConnection: async () => connection };
    };

    it('logs every call at debug with its category, namespace and duration', async () => {
      const logger = recordingLogger();
      await callTemporal(withConnection(), options(logger), async () => 1);
      expect(logger.records).toEqual([
        {
          level: 'debug',
          message: 'Called Temporal',
          meta: {
            temporalCall: 'describeWorkflowExecution',
            namespace: 'default',
            durationMs: expect.any(Number),
          },
        },
      ]);
    });

    it('logs the gRPC status of a refusal of the backend credentials at warn, and keeps it out of the error', async () => {
      const logger = recordingLogger();
      const grpc = Object.assign(new Error('7 PERMISSION_DENIED: no'), {
        code: 7,
        metadata: { 'x-secret': 'abc' },
      });
      const error = await callTemporal(
        withConnection(),
        options(logger),
        async () => {
          throw grpc;
        },
      ).catch(e => e);
      expect(error).toMatchObject({
        name: 'ServiceUnavailableError',
        message: expect.stringContaining('refused the credentials'),
      });
      // The gRPC error is not kept on the Backstage error, which would put
      // its metadata into the HTTP response.
      expect(error.cause).toBeUndefined();
      expect(logger.records).toEqual([
        {
          level: 'warn',
          message: 'Call to Temporal failed',
          meta: {
            temporalCall: 'describeWorkflowExecution',
            namespace: 'default',
            durationMs: expect.any(Number),
            timeoutMs: 10_000,
            errorName: 'Error',
            grpcCode: 7,
            grpcStatus: 'PERMISSION_DENIED',
          },
        },
      ]);
    });

    it.each([
      ['UNAVAILABLE', 14, 'warn'],
      ['RESOURCE_EXHAUSTED', 8, 'warn'],
      ['UNAUTHENTICATED', 16, 'warn'],
      ['INTERNAL', 13, 'warn'],
      ['UNKNOWN', 2, 'warn'],
      ['UNIMPLEMENTED', 12, 'warn'],
      ['DEADLINE_EXCEEDED', 4, 'warn'],
      ['NOT_FOUND', 5, 'debug'],
      ['INVALID_ARGUMENT', 3, 'debug'],
      ['ALREADY_EXISTS', 6, 'debug'],
      ['FAILED_PRECONDITION', 9, 'debug'],
    ])('logs %s at %s', async (status, code, level) => {
      const logger = recordingLogger();
      await callTemporal(withConnection(), options(logger), async () => {
        throw Object.assign(new Error('x'), { code });
      }).catch(() => undefined);
      expect(logger.records).toHaveLength(1);
      expect(logger.records[0]).toMatchObject({
        level,
        meta: { grpcCode: code, grpcStatus: status },
      });
    });

    it('logs the status of an error that wraps the gRPC error (the schedule client)', async () => {
      const logger = recordingLogger();
      const wrapped = Object.assign(new Error('Failed to list schedules'), {
        cause: { code: 14, details: 'down' },
      });
      await callTemporal(
        withConnection(),
        options(logger, { temporalCall: 'schedule.list' }),
        async () => {
          throw wrapped;
        },
      ).catch(() => undefined);
      expect(logger.records[0]).toMatchObject({
        level: 'warn',
        meta: { temporalCall: 'schedule.list', grpcStatus: 'UNAVAILABLE' },
      });
    });

    it('logs a schedule or a namespace that is not found at debug', async () => {
      const logger = recordingLogger();
      for (const name of ['ScheduleNotFoundError', 'NamespaceNotFoundError']) {
        await callTemporal(withConnection(), options(logger), async () => {
          throw Object.assign(new Error('gone'), { name });
        }).catch(() => undefined);
      }
      expect(logger.records.map(r => r.level)).toEqual(['debug', 'debug']);
      expect(logger.records[0].meta.errorName).toBe('ScheduleNotFoundError');
    });

    it('logs a query that no worker answers at debug, and a missed deadline of an operation at warn', async () => {
      const logger = recordingLogger();
      const deadline = async () => {
        throw Object.assign(new Error('late'), { code: 4 });
      };
      await callTemporal(
        withConnection(),
        { ...options(logger, { temporalCall: QUERY_CALL }) },
        deadline,
      ).catch(() => undefined);
      await callTemporal(
        withConnection(),
        options(logger, { temporalCall: 'signalWorkflowExecution' }),
        deadline,
      ).catch(() => undefined);
      expect(logger.records.map(r => r.level)).toEqual(['debug', 'warn']);
    });

    it('logs nothing when the connection cannot be opened (the service logs that)', async () => {
      const logger = recordingLogger();
      await callTemporal(
        {
          getConnection: async () => {
            throw new Error('refused');
          },
        },
        options(logger),
        jest.fn(),
      ).catch(() => undefined);
      expect(logger.records).toEqual([]);
    });
  });
});
