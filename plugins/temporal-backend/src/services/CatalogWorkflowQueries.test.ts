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

import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import type { WorkflowDetail } from '../common';
import type { TemporalEntityContext } from '../node/alpha';
import {
  orderWorkflowEntity,
  ordersEntity,
  paymentWorkflowEntity,
} from '../testUtils';
import { CatalogWorkflowQueries } from './CatalogWorkflowQueries';

const credentials = mockCredentials.user();

const workflow = {
  namespace: 'default',
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowType: 'orderWorkflow',
  taskQueue: 'orders',
  status: 'Running',
} as WorkflowDetail;

const ordersRef = stringifyEntityRef(ordersEntity);
const orderWorkflowRef = stringifyEntityRef(orderWorkflowEntity);
const paymentWorkflowRef = stringifyEntityRef(paymentWorkflowEntity);

const context = (
  entity = ordersEntity,
  related = [orderWorkflowEntity],
): TemporalEntityContext => ({
  entity,
  entityRef: stringifyEntityRef(entity),
  namespace: 'default',
  relatedWorkflowEntities: related,
});

function setup(
  fakes: {
    access?: object;
    link?: jest.Mock;
    queries?: object;
    lists?: object;
  } = {},
) {
  const logger = mockServices.logger.mock();
  const link = fakes.link ?? jest.fn(async (items: unknown[]) => items);
  const queries = new CatalogWorkflowQueries(
    (fakes.access ?? {}) as any,
    { link: link as any },
    {
      relatedWorkflowEntity: () => undefined,
      messageDefinitions: async () => ({
        signals: [{ name: 'approve' }],
        updates: [],
        queries: [],
      }),
      ...fakes.queries,
    } as any,
    (fakes.lists ?? {}) as any,
    logger,
  );
  return { queries, link, logger };
}

describe('CatalogWorkflowQueries', () => {
  describe('detail', () => {
    it('links the related entity the run matches, and looks for no entity of the type', async () => {
      const { queries, link } = setup({
        queries: { relatedWorkflowEntity: () => orderWorkflowRef },
      });
      await expect(
        queries.detail({ credentials, workflow, context: context() }),
      ).resolves.toEqual({ ...workflow, workflowEntityRef: orderWorkflowRef });
      expect(link).not.toHaveBeenCalled();
    });

    it('links the entity an ancestor matched, when it is not the opened entity', async () => {
      const { queries } = setup();
      await expect(
        queries.detail({
          credentials,
          workflow,
          context: context(),
          matchedEntityRef: orderWorkflowRef,
        }),
      ).resolves.toEqual({ ...workflow, workflowEntityRef: orderWorkflowRef });
      await expect(
        queries.detail({
          credentials,
          workflow,
          context: context(),
          matchedEntityRef: ordersRef,
        }),
      ).resolves.toEqual(workflow);
    });

    it('links the entity of the workflow type of a run without an entity link', async () => {
      const link = jest.fn(async (items: WorkflowDetail[]) =>
        items.map(i => ({ ...i, workflowTypeEntityRef: orderWorkflowRef })),
      );
      const { queries } = setup({ link });
      await expect(queries.detail({ credentials, workflow })).resolves.toEqual({
        ...workflow,
        workflowTypeEntityRef: orderWorkflowRef,
      });
      expect(link).toHaveBeenCalledWith([workflow], 'default', credentials);
    });

    it('looks for no entity of the type when the opened entity describes it', async () => {
      const { queries, link } = setup();
      await expect(
        queries.detail({
          credentials,
          workflow,
          context: context(orderWorkflowEntity, []),
        }),
      ).resolves.toEqual(workflow);
      expect(link).not.toHaveBeenCalled();

      // A child workflow of another type, opened with the parent's entity.
      await queries.detail({
        credentials,
        workflow: { ...workflow, workflowType: 'paymentWorkflow' },
        context: context(orderWorkflowEntity, []),
      });
      expect(link).toHaveBeenCalledTimes(1);
    });
  });

  describe('messageDefinitions', () => {
    const described = {
      ...paymentWorkflowEntity,
      spec: {
        ...paymentWorkflowEntity.spec,
        messages: {
          signals: [{ name: 'approve', description: 'Approves the payment' }],
        },
      },
    };
    const merged = {
      signals: [{ name: 'approve', description: 'Approves the payment' }],
      updates: [],
      queries: [],
    };

    it('uses the opened TemporalWorkflow entity', async () => {
      const { queries, link } = setup();
      await expect(
        queries.messageDefinitions({
          credentials,
          workflow,
          context: context(described, []),
        }),
      ).resolves.toEqual(merged);
      expect(link).not.toHaveBeenCalled();
    });

    it('prefers the related entity the run matched to the entity of its type', async () => {
      const { queries, link } = setup();
      await expect(
        queries.messageDefinitions({
          credentials,
          workflow,
          context: context(ordersEntity, [orderWorkflowEntity, described]),
          matchedEntityRef: paymentWorkflowRef,
        }),
      ).resolves.toEqual(merged);
      expect(link).not.toHaveBeenCalled();
    });

    it('loads the entity of the workflow type with the read permission', async () => {
      const loadEntity = jest.fn(async () => context(described, []));
      const { queries } = setup({
        access: { loadEntity },
        link: jest.fn(async (items: WorkflowDetail[]) =>
          items.map(i => ({ ...i, workflowTypeEntityRef: paymentWorkflowRef })),
        ),
      });
      await expect(
        queries.messageDefinitions({ credentials, workflow }),
      ).resolves.toEqual(merged);
      expect(loadEntity).toHaveBeenCalledWith(
        paymentWorkflowRef,
        expect.objectContaining({ name: 'temporal.workflow.read' }),
        credentials,
      );
    });

    it.each([new NotAllowedError(), new NotFoundError('gone')])(
      'keeps what the workflow reports when the entity of its type cannot be read (%s)',
      async error => {
        const { queries } = setup({
          access: {
            loadEntity: async () => {
              throw error;
            },
          },
          link: jest.fn(async (items: WorkflowDetail[]) =>
            items.map(i => ({
              ...i,
              workflowTypeEntityRef: paymentWorkflowRef,
            })),
          ),
        });
        await expect(
          queries.messageDefinitions({ credentials, workflow }),
        ).resolves.toEqual({
          signals: [{ name: 'approve' }],
          updates: [],
          queries: [],
        });
      },
    );
  });

  describe('overview', () => {
    it('gives an item with an error for an entity whose workflows cannot be shown, and logs it', async () => {
      const error = new InputError('Temporal namespace is not allowed: other');
      const overview = jest.fn(async (c: TemporalEntityContext) => ({
        entityRef: c.entityRef,
        running: 2,
      }));
      const { queries, logger } = setup({
        access: {
          loadWorkflowEntities: async () => [
            {
              entityRef: orderWorkflowRef,
              context: context(orderWorkflowEntity),
            },
            { entityRef: paymentWorkflowRef, error },
          ],
        },
        lists: { overview },
      });
      const response = await queries.overview(
        [orderWorkflowRef, paymentWorkflowRef],
        credentials,
        { refresh: true },
      );
      expect(response.items).toEqual([
        { entityRef: orderWorkflowRef, running: 2 },
        expect.objectContaining({
          entityRef: paymentWorkflowRef,
          running: 0,
          error: { message: 'The numbers could not be read' },
        }),
      ]);
      expect(overview).toHaveBeenCalledWith(
        expect.objectContaining({ entityRef: orderWorkflowRef }),
        { queueTimeouts: 0 },
        { refresh: true },
      );
      expect(logger.child).toHaveBeenCalledWith({
        entityRef: paymentWorkflowRef,
      });
    });

    it('warns once when rows waited in the queue until their deadline', async () => {
      const { queries, logger } = setup({
        access: {
          loadWorkflowEntities: async () => [
            {
              entityRef: orderWorkflowRef,
              context: context(orderWorkflowEntity),
            },
            {
              entityRef: paymentWorkflowRef,
              context: context(paymentWorkflowEntity),
            },
          ],
        },
        lists: {
          overview: async (
            c: TemporalEntityContext,
            request: { queueTimeouts: number },
          ) => {
            request.queueTimeouts += 1;
            return { entityRef: c.entityRef };
          },
        },
      });
      await queries.overview(
        [orderWorkflowRef, paymentWorkflowRef],
        credentials,
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('was not read in time'),
        { entities: 2, queueTimeouts: 2 },
      );
    });
  });

  describe('workflowRuns', () => {
    const page = { pageSize: 20, pageToken: 'next' };

    it('lists the runs of the entity, with the read permission on it', async () => {
      const loadEntity = jest.fn(async () => context());
      const listEntityWorkflows = jest.fn(async () => ({ items: [] }));
      const { queries, link } = setup({
        access: { loadEntity },
        lists: { listEntityWorkflows },
      });
      await queries.workflowRuns(
        { namespace: 'default', workflowId: 'wf-1', entityRef: ordersRef },
        page,
        credentials,
      );
      expect(loadEntity).toHaveBeenCalledWith(
        ordersRef,
        expect.objectContaining({ name: 'temporal.workflow.read' }),
        credentials,
      );
      expect(listEntityWorkflows).toHaveBeenCalledWith(
        expect.objectContaining({ entityRef: ordersRef }),
        { workflowId: 'wf-1', ...page },
      );
      expect(link).not.toHaveBeenCalled();
    });

    it('finds no workflow of an entity in another namespace', async () => {
      const listEntityWorkflows = jest.fn();
      const { queries } = setup({
        access: { loadEntity: async () => context() },
        lists: { listEntityWorkflows },
      });
      await expect(
        queries.workflowRuns(
          { namespace: 'other', workflowId: 'wf-1', entityRef: ordersRef },
          page,
          credentials,
        ),
      ).rejects.toThrow(
        new NotFoundError(`Workflow wf-1 was not found for ${ordersRef}`),
      );
      expect(listEntityWorkflows).not.toHaveBeenCalled();
    });

    it('lists the runs of the namespace with the conditions of the list permission, and links the entities of their types', async () => {
      const item = { ...workflow };
      const listNamespaceWorkflows = jest.fn(async () => ({
        items: [item],
        namespace: 'default',
      }));
      const link = jest.fn(async (items: WorkflowDetail[]) =>
        items.map(i => ({ ...i, workflowTypeEntityRef: orderWorkflowRef })),
      );
      const { queries } = setup({
        access: { authorizeWorkflowList: async () => `WorkflowType = 'a'` },
        lists: { listNamespaceWorkflows },
        link,
      });
      await expect(
        queries.workflowRuns(
          { namespace: 'default', workflowId: 'wf-1' },
          page,
          credentials,
        ),
      ).resolves.toEqual({
        items: [{ ...item, workflowTypeEntityRef: orderWorkflowRef }],
        namespace: 'default',
      });
      expect(listNamespaceWorkflows).toHaveBeenCalledWith(
        'default',
        { workflowId: 'wf-1', permissionFilter: `WorkflowType = 'a'` },
        page,
      );
      expect(link).toHaveBeenCalledWith([item], 'default', credentials);
    });
  });
});
