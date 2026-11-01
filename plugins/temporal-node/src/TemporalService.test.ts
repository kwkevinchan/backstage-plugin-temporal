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
          },
          webUi: { baseUrl: 'https://ui.example.com/' },
          searchAttributes: { entityRef: 'BackstageEntityRef' },
        },
      }),
    );
    expect(options.namespaces).toEqual(['team-a', 'team-b']);
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
