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
import type { Entity } from '@backstage/catalog-model';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import request from 'supertest';
import { createBackendPlugin } from '@backstage/backend-plugin-api';
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

async function start(result?: AuthorizeResult.ALLOW | AuthorizeResult.DENY) {
  const readUrl = jest.fn(async () => ({
    buffer: async () => Buffer.from(text),
  }));
  const { server } = await startTestBackend({
    features: [
      temporalPluginStandIn,
      temporalModuleZigflow,
      catalogServiceMock.factory({
        entities: [
          ordersEntity,
          orderWorkflowEntity,
          yamlWorkflow,
          badDefinition,
        ],
      }),
      mockServices.permissions.factory(result ? { result } : undefined),
      mockServices.urlReader.mock({ readUrl }).factory,
    ],
  });
  return { server: await withOpenApiValidation(server), readUrl };
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
      entityRef: 'temporalworkflow:default/yaml-flow',
      content: text,
      tasks: [
        { pointer: '/do/0/first', name: 'first', startLine: 4, endLine: 6 },
      ],
    });
  });

  it('needs the read permission', async () => {
    const { server, readUrl } = await start(AuthorizeResult.DENY);
    const res = await request(server).get(path('yaml-flow'));
    expect(res.status).toBe(403);
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('answers 404 for code workflows and other kinds, 400 for a bad spec', async () => {
    const { server, readUrl } = await start();
    expect((await request(server).get(path('order-workflow'))).status).toBe(
      404,
    );
    expect(
      (await request(server).get(path('orders', 'component'))).status,
    ).toBe(404);
    expect((await request(server).get(path('bad-flow'))).status).toBe(400);
    expect(readUrl).not.toHaveBeenCalled();
  });
});
