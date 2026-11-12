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
import * as grpc from '@grpc/grpc-js';
import { Connection } from '@temporalio/client';
import {
  DefaultTemporalService,
  readTemporalServiceOptions,
} from './TemporalService';

describe('readTemporalServiceOptions', () => {
  it('reads defaults', () => {
    const options = readTemporalServiceOptions(
      new ConfigReader({
        temporal: { connection: { address: 'localhost:7233' } },
      }),
    );
    expect(options).toEqual({
      address: 'localhost:7233',
      auth: { type: 'none' },
      tls: false,
      defaultNamespace: 'default',
      namespaces: ['default'],
      webUiBaseUrl: undefined,
      searchAttributes: { entityRef: undefined, initiator: undefined },
    });
  });

  it('reads namespaces and optional settings', () => {
    const options = readTemporalServiceOptions(
      new ConfigReader({
        temporal: {
          connection: {
            address: 'temporal:7233',
            namespaces: ['team-a'],
            defaultNamespace: 'team-b',
            auth: { type: 'none' },
            tls: true,
          },
          webUi: { baseUrl: 'https://ui.example.com/' },
          searchAttributes: { entityRef: 'BackstageEntityRef' },
        },
      }),
    );
    expect(options.namespaces).toEqual(['team-a', 'team-b']);
    expect(options.tls).toBe(true);
    expect(options.webUiBaseUrl).toBe('https://ui.example.com');
    expect(options.searchAttributes.entityRef).toBe('BackstageEntityRef');
  });

  it('rejects invalid names', () => {
    expect(() =>
      readTemporalServiceOptions(
        new ConfigReader({
          temporal: { connection: { address: 'x:1', namespaces: ["a' OR 1"] } },
        }),
      ),
    ).toThrow(/Invalid Temporal namespace/);
    expect(() =>
      readTemporalServiceOptions(
        new ConfigReader({
          temporal: {
            connection: { address: 'x:1' },
            searchAttributes: { entityRef: 'Bad Name' },
          },
        }),
      ),
    ).toThrow(/Invalid search attribute/);
    expect(() =>
      readTemporalServiceOptions(
        new ConfigReader({
          temporal: { connection: { address: 'x:1', auth: { type: 'mtls' } } },
        }),
      ),
    ).toThrow(/Unsupported temporal.connection.auth.type/);
  });

  it('reads a bearer token', () => {
    const read = (auth: object) =>
      readTemporalServiceOptions(
        new ConfigReader({
          temporal: { connection: { address: 'x:1', auth } },
        }),
      );
    expect(read({ type: 'bearer', token: ' abc.def ' }).auth).toEqual({
      type: 'bearer',
      token: 'abc.def',
    });
    expect(() => read({ type: 'bearer' })).toThrow(/auth.token is required/);
    expect(() => read({ type: 'bearer', token: 'a b' })).toThrow(
      /must not contain spaces/,
    );
    expect(read({ type: 'none', token: 'ignored' }).auth).toEqual({
      type: 'none',
    });
  });
});

/**
 * A plain-text gRPC server that records the metadata of every call. Every
 * call fails with UNIMPLEMENTED, which the client accepts on connect (as from
 * an old server).
 */
async function startRecordingServer() {
  const calls: { path: string; authorization: grpc.MetadataValue[] }[] = [];
  const server = new grpc.Server();
  const unimplemented = (path: string) => (call: any, callback: any) => {
    calls.push({ path, authorization: call.metadata.get('authorization') });
    callback({ code: grpc.status.UNIMPLEMENTED, details: 'test server' });
  };
  const method = (name: string) => {
    const path = `/temporal.api.workflowservice.v1.WorkflowService/${name}`;
    return {
      path,
      requestStream: false,
      responseStream: false,
      requestSerialize: (v: Buffer) => v,
      requestDeserialize: (v: Buffer) => v,
      responseSerialize: (v: Buffer) => v,
      responseDeserialize: (v: Buffer) => v,
    };
  };
  const names = ['GetSystemInfo', 'ListWorkflowExecutions'];
  server.addService(
    Object.fromEntries(names.map(n => [n, method(n)])) as any,
    Object.fromEntries(
      names.map(n => [n, unimplemented(method(n).path)]),
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

describe('connection authentication', () => {
  let recording: Awaited<ReturnType<typeof startRecordingServer>>;
  beforeEach(async () => {
    recording = await startRecordingServer();
  });
  afterEach(() => {
    recording.server.forceShutdown();
  });

  function service(
    auth?: { type: 'none' } | { type: 'bearer'; token: string },
  ) {
    return new DefaultTemporalService({
      address: recording.address,
      auth,
      defaultNamespace: 'default',
      namespaces: ['default'],
      searchAttributes: {},
    });
  }

  it('sends the bearer token in the Authorization header, without TLS', async () => {
    const temporal = service({ type: 'bearer', token: 'test-token' });
    const connection = await temporal.getConnection();
    await expect(
      connection.workflowService.listWorkflowExecutions({
        namespace: 'default',
      }),
    ).rejects.toThrow();
    await temporal.close();
    expect(recording.calls.map(c => c.path)).toEqual([
      expect.stringMatching(/GetSystemInfo$/),
      expect.stringMatching(/ListWorkflowExecutions$/),
    ]);
    for (const call of recording.calls) {
      expect(call.authorization).toEqual(['Bearer test-token']);
    }
  });

  it('sends no Authorization header without authentication', async () => {
    const temporal = service();
    await temporal.getConnection();
    await temporal.close();
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0].authorization).toEqual([]);
  });
});

describe('DefaultTemporalService', () => {
  const service = new DefaultTemporalService({
    address: 'localhost:7233',
    defaultNamespace: 'default',
    namespaces: ['default', 'other'],
    webUiBaseUrl: 'http://localhost:8080',
    searchAttributes: {},
  });

  it('checks namespaces', async () => {
    expect(service.isNamespaceAllowed('other')).toBe(true);
    expect(service.isNamespaceAllowed('secret')).toBe(false);
    await expect(service.getClient({ namespace: 'secret' })).rejects.toThrow(
      /not allowed/,
    );
  });

  it('builds Web UI links', () => {
    expect(
      service.getWebUiUrl({
        namespace: 'default',
        workflowId: 'a b',
        runId: 'r1',
      }),
    ).toBe(
      'http://localhost:8080/namespaces/default/workflows/a%20b/r1/history',
    );
    expect(
      service.getWebUiUrl({ namespace: 'default', workflowId: 'wf' }),
    ).toBe('http://localhost:8080/namespaces/default/workflows/wf');
  });
});

describe('connection options', () => {
  afterEach(() => jest.restoreAllMocks());

  async function connectOptions(options: {
    tls?: boolean;
    auth?: { type: 'none' } | { type: 'bearer'; token: string };
  }) {
    jest.restoreAllMocks();
    const connect = jest
      .spyOn(Connection, 'connect')
      .mockResolvedValue({} as Connection);
    await new DefaultTemporalService({
      address: 'temporal.example.com:7233',
      defaultNamespace: 'default',
      namespaces: ['default'],
      searchAttributes: {},
      ...options,
    }).getConnection();
    expect(connect).toHaveBeenCalledTimes(1);
    return connect.mock.calls[0][0];
  }

  it('connects without TLS by default, also with a bearer token', async () => {
    expect(await connectOptions({})).toEqual({
      address: 'temporal.example.com:7233',
      tls: false,
    });
    // The client would turn TLS on for an API key by itself.
    expect(
      await connectOptions({ auth: { type: 'bearer', token: 'test-token' } }),
    ).toEqual({
      address: 'temporal.example.com:7233',
      tls: false,
      apiKey: 'test-token',
    });
  });

  it('connects with TLS when configured', async () => {
    expect(
      await connectOptions({
        tls: true,
        auth: { type: 'bearer', token: 'test-token' },
      }),
    ).toEqual({
      address: 'temporal.example.com:7233',
      tls: true,
      apiKey: 'test-token',
    });
  });
});
