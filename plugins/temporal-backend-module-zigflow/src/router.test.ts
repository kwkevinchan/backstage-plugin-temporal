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

import { temporalWorkflowReadPermission } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  temporalAccessServiceFactory,
  temporalAccessServiceRef,
  type TemporalAccessService,
} from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import type { JsonObject } from '@backstage/types';
import request from 'supertest';
import {
  createBackendPlugin,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { temporalModuleZigflow } from './module';
import { withOpenApiValidation } from './__testUtils__/openapi';

// The module adds a route to the Temporal backend plugin; a stand-in plugin
// with the same id is enough to mount it.
const temporalPluginStandIn = createBackendPlugin({
  pluginId: 'temporal',
  register(env) {
    env.registerInit({ deps: {}, async init() {} });
  },
});

// The default access factory depends on Temporal, even though authorizeOn
// itself only uses the permissions service.
const fakeTemporalService = createServiceFactory({
  service: temporalServiceRef,
  deps: {},
  factory: () =>
    ({
      getClient: async () => {
        throw new Error('not used');
      },
      getConnection: async () => {
        throw new Error('not used');
      },
      getDefaultNamespace: () => 'default',
      getAllowedNamespaces: () => ['default'],
      isNamespaceAllowed: (ns: string) => ns === 'default',
      getSearchAttributeNames: () => ({
        entityRef: 'BackstageEntityRef',
        initiator: 'BackstageInitiator',
      }),
      getWebUiUrl: () => undefined,
    } as any),
});

const ordersEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders', namespace: 'default' },
  spec: { type: 'service', owner: 'group:default/team-a' },
};

/** A workflow written in code: no spec.definition. */
const orderWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
  },
};

const yamlWorkflow: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'yaml-flow',
    namespace: 'default',
    annotations: {
      'backstage.io/managed-by-location':
        'url:https://git.example.com/org/repo/blob/main/catalog-info.yaml',
    },
  },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'yaml-flow',
    definition: { format: 'serverless-workflow', target: './flow.yaml' },
  },
};

const remoteWorkflow: Entity = {
  ...yamlWorkflow,
  metadata: {
    name: 'remote-flow',
    namespace: 'default',
  },
  spec: {
    ...yamlWorkflow.spec,
    definition: {
      format: 'serverless-workflow',
      target: 'https://raw.example.com/flow.yaml',
    },
  },
};

const badDefinition: Entity = {
  ...yamlWorkflow,
  metadata: { ...yamlWorkflow.metadata, name: 'bad-flow' },
  spec: {
    ...yamlWorkflow.spec,
    definition: { format: 'bpmn', target: './flow.bpmn' },
  },
};

const text =
  'document:\n  dsl: 1.0.0\ndo:\n  - first:\n      wait:\n        seconds: 1\n';

async function start(options?: {
  result?: AuthorizeResult.ALLOW | AuthorizeResult.DENY;
  config?: JsonObject;
  accessFactory?: ReturnType<typeof createServiceFactory>;
}) {
  const readUrl = jest.fn(async () => ({
    buffer: async () => Buffer.from(text),
  }));
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({
        result: options?.result ?? AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPluginStandIn,
      fakeTemporalService,
      options?.accessFactory ?? temporalAccessServiceFactory,
      temporalModuleZigflow,
      catalogServiceMock.factory({
        entities: [
          ordersEntity,
          orderWorkflowEntity,
          yamlWorkflow,
          remoteWorkflow,
          badDefinition,
        ],
      }),
      permissions.factory,
      mockServices.urlReader.mock({ readUrl }).factory,
      ...(options?.config
        ? [mockServices.rootConfig.factory({ data: options.config })]
        : []),
    ],
  });
  return {
    backend: server,
    server: await withOpenApiValidation(server),
    readUrl,
    permissions,
  };
}

const path = (name: string, kind = 'temporalworkflow') =>
  `/api/temporal/entities/${kind}/default/${name}/definition`;

describe('definition route', () => {
  it('reads the definition with the URL reader', async () => {
    const { server, readUrl } = await start();
    const res = await request(server).get(path('yaml-flow'));
    expect(res.status).toBe(200);
    expect(readUrl).toHaveBeenCalledWith(
      'https://git.example.com/org/repo/blob/main/flow.yaml',
    );
    expect(res.body).toMatchObject({
      content: text,
      tasks: [{ pointer: '/do/0/first', startLine: 4, endLine: 6 }],
    });
  });

  it('needs the read permission with resourceRef on the entity', async () => {
    const allowed = await start();
    await request(allowed.server).get(
      '/api/temporal/entities/TemporalWorkflow/Default/Yaml-Flow/definition',
    );
    expect(allowed.permissions.authorize).toHaveBeenCalledWith(
      [
        {
          permission: temporalWorkflowReadPermission,
          resourceRef: 'temporalworkflow:default/yaml-flow',
        },
      ],
      expect.anything(),
    );

    const { server, readUrl } = await start({ result: AuthorizeResult.DENY });
    const res = await request(server).get(path('yaml-flow'));
    expect(res.status).toBe(403);
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('returns 403 when a custom access service denies the request', async () => {
    const accessFactory = createServiceFactory({
      service: temporalAccessServiceRef,
      deps: {},
      factory(): TemporalAccessService {
        return {
          authorizeOn: async () => {
            throw new NotAllowedError();
          },
        } as unknown as TemporalAccessService;
      },
    });
    const { server, readUrl, permissions } = await start({ accessFactory });
    const res = await request(server).get(path('yaml-flow'));
    expect(res.status).toBe(403);
    expect(readUrl).not.toHaveBeenCalled();
    expect(permissions.authorize).not.toHaveBeenCalled();
  });

  it('answers 404 for missing entities, code workflows, and other kinds, and 400 for a bad spec', async () => {
    const { server, readUrl } = await start();
    expect((await request(server).get(path('missing-entity'))).status).toBe(
      404,
    );
    expect((await request(server).get(path('order-workflow'))).status).toBe(
      404,
    );
    expect(
      (await request(server).get(path('orders', 'component'))).status,
    ).toBe(404);
    expect((await request(server).get(path('bad-flow'))).status).toBe(400);
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('wires temporal.definitions config into temporalModuleZigflow', async () => {
    const { server, readUrl } = await start({
      config: {
        temporal: {
          definitions: {
            maxBytes: 16,
            allow: [{ host: 'raw.example.com' }],
          },
        },
      },
    });
    const res = await request(server).get(path('remote-flow'));
    expect(res.status).toBe(200);
    expect(readUrl).toHaveBeenCalledWith('https://raw.example.com/flow.yaml');
    expect(res.body).toMatchObject({
      error: {
        kind: 'tooLarge',
        message: 'The file is larger than 16 bytes',
      },
    });

    await expect(
      start({
        config: {
          temporal: {
            definitions: { maxBytes: 0 },
          },
        },
      }),
    ).rejects.toThrow(/temporal\.definitions\.maxBytes must be between/);
  });
});
