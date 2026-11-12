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
import {
  coreServices,
  createBackendModule,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { NotAllowedError } from '@backstage/errors';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { TemporalAccessService, temporalAccessServiceRef } from '../node/alpha';
import Router from 'express-promise-router';
import request from 'supertest';
import temporalBackend from '../index';
import { temporalPlugin } from '../plugin';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
  ordersEntity,
} from '../testUtils';
import { temporalAccessServiceFactory } from './temporalAccessServiceFactory';

/**
 * A module of the temporal plugin that serves one route with the shared
 * access service, like a module that adds routes would.
 */
function accessModule(seen: TemporalAccessService[]) {
  return createBackendModule({
    pluginId: 'temporal',
    moduleId: 'access-test',
    register(reg) {
      reg.registerInit({
        deps: {
          access: temporalAccessServiceRef,
          httpAuth: coreServices.httpAuth,
          httpRouter: coreServices.httpRouter,
        },
        async init({ access, httpAuth, httpRouter }) {
          seen.push(access);
          const router = Router();
          router.get('/module/:workflowId', async (req, res) => {
            const { context, workflow } = await access.loadWorkflow(
              {
                namespace: 'default',
                workflowId: req.params.workflowId,
              },
              {
                entityRef: 'component:default/orders',
                level: 'read',
                credentials: await httpAuth.credentials(req),
              },
            );
            res.json({
              entityRef: context?.entityRef,
              namespace: context?.namespace,
              workflowId: workflow.workflowId,
            });
          });
          httpRouter.use(router);
        },
      });
    },
  });
}

async function start(permission: AuthorizeResult.ALLOW | AuthorizeResult.DENY) {
  const seen: TemporalAccessService[] = [];
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      accessModule(seen),
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(createFakeWorkflowService()),
      mockServices.permissions.factory({ result: permission }),
    ],
  });
  return { server, seen };
}

describe('temporalAccessServiceRef', () => {
  it('gives modules the access checks of the plugin', async () => {
    const { server, seen } = await start(AuthorizeResult.ALLOW);
    const res = await request(server).get('/api/temporal/module/wf-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entityRef: 'component:default/orders',
      namespace: 'default',
      workflowId: 'wf-1',
    });
    expect(seen).toHaveLength(1);
  });

  it('denies a module route without the permission', async () => {
    const { server } = await start(AuthorizeResult.DENY);
    const res = await request(server).get('/api/temporal/module/wf-1');
    expect(res.status).toBe(403);
  });

  it('uses an access factory the backend adds instead of the default', async () => {
    const authorizeWorkflowList = jest.fn(async () => {
      throw new NotAllowedError('custom rules');
    });
    const custom = {
      authorizeWorkflowList,
    } as unknown as TemporalAccessService;
    const { server } = await startTestBackend({
      features: [
        // The package's default export: the plugin and the default factory,
        // which is skipped because the backend has one already.
        temporalBackend,
        createServiceFactory({
          service: temporalAccessServiceRef,
          deps: {},
          factory: () => custom,
        }),
        catalogServiceMock.factory({ entities: [ordersEntity] }),
        fakeTemporalServiceFactory(createFakeWorkflowService()),
        mockServices.permissions.factory({ result: AuthorizeResult.ALLOW }),
      ],
    });
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(403);
    expect(authorizeWorkflowList).toHaveBeenCalledWith(
      'default',
      expect.anything(),
    );
  });
});
