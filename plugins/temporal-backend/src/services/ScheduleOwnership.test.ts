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

import { mockCredentials } from '@backstage/backend-test-utils';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import type { TemporalEntityContext } from '../node/alpha';
import { ordersEntity } from '../testUtils';
import { ScheduleOwnership } from './ScheduleOwnership';

const credentials = mockCredentials.user();
const ordersRef = stringifyEntityRef(ordersEntity);

const context = {
  entity: ordersEntity,
  entityRef: ordersRef,
  namespace: 'default',
  relatedWorkflowEntities: [],
} as TemporalEntityContext;

const schedule = (more: object = {}) => ({
  namespace: 'default',
  scheduleId: 'nightly',
  workflowType: 'orderWorkflow',
  taskQueue: 'orders',
  ...more,
});

function setup(
  fakes: {
    access?: object;
    workflowSources?: { taskQueue?: string; workflowTypes: string[] }[];
    describeSchedule?: jest.Mock;
  } = {},
) {
  const access = {
    loadEntity: jest.fn(async () => context),
    canListAll: jest.fn(async () => true),
    authorizeOn: jest.fn(async () => undefined),
    ...fakes.access,
  };
  const checkRequestedNamespace = jest.fn((namespace: string) => {
    if (namespace !== 'default') {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
  });
  const describeSchedule =
    fakes.describeSchedule ?? jest.fn(async () => schedule());
  const ownership = new ScheduleOwnership(
    access as any,
    {
      workflowSourcesOf: () =>
        fakes.workflowSources ?? [
          { taskQueue: 'orders', workflowTypes: ['orderWorkflow'] },
        ],
      checkRequestedNamespace,
    } as any,
    { describeSchedule } as any,
  );
  return { ownership, access, describeSchedule, checkRequestedNamespace };
}

const request = (more: object = {}) => ({
  namespace: 'default',
  scheduleId: 'nightly',
  credentials,
  ...more,
});

describe('ScheduleOwnership', () => {
  it('gives a schedule that starts a workflow of the entity, with the start permission on the entity', async () => {
    const { ownership, access } = setup();
    await expect(
      ownership.operable(request({ entityRef: ordersRef })),
    ).resolves.toEqual(schedule());
    expect(access.loadEntity).toHaveBeenCalledWith(
      ordersRef,
      expect.objectContaining({ name: 'temporal.workflow.start' }),
      credentials,
    );
    expect(access.canListAll).not.toHaveBeenCalled();
  });

  it.each([
    ['another workflow type', { workflowType: 'billingWorkflow' }],
    ['another task queue', { taskQueue: 'billing' }],
  ])('finds no schedule of the entity for %s', async (_name, more) => {
    const { ownership } = setup({
      describeSchedule: jest.fn(async () => schedule(more)),
    });
    await expect(
      ownership.operable(request({ entityRef: ordersRef })),
    ).rejects.toThrow(
      new NotFoundError(
        `Schedule nightly does not start a workflow of ${ordersRef}`,
      ),
    );
  });

  it('finds no schedule of an entity in another namespace, without reading the schedule', async () => {
    const { ownership, describeSchedule } = setup({
      access: {
        loadEntity: async () => ({ ...context, namespace: 'other' }),
      },
    });
    await expect(
      ownership.operable(request({ entityRef: ordersRef })),
    ).rejects.toThrow(
      new NotFoundError(
        `Schedule nightly does not start a workflow of ${ordersRef}`,
      ),
    );
    expect(describeSchedule).not.toHaveBeenCalled();
  });

  it('checks the permission before the namespace', async () => {
    const denied = setup({
      access: {
        loadEntity: async () => {
          throw new NotAllowedError();
        },
      },
    });
    await expect(
      denied.ownership.operable(
        request({ namespace: 'secret', entityRef: ordersRef }),
      ),
    ).rejects.toThrow(NotAllowedError);
    expect(denied.checkRequestedNamespace).not.toHaveBeenCalled();

    const allowed = setup();
    await expect(
      allowed.ownership.operable(
        request({ namespace: 'secret', entityRef: ordersRef }),
      ),
    ).rejects.toThrow(
      new InputError('Temporal namespace is not allowed: secret'),
    );
    expect(allowed.describeSchedule).not.toHaveBeenCalled();
  });

  it('gives any schedule of the namespace to a caller who lists every workflow and may start workflows of every entity', async () => {
    const { ownership, access } = setup({
      describeSchedule: jest.fn(async () =>
        schedule({ workflowType: 'billingWorkflow' }),
      ),
    });
    await expect(ownership.operable(request())).resolves.toEqual(
      schedule({ workflowType: 'billingWorkflow' }),
    );
    expect(access.authorizeOn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'temporal.workflow.start' }),
      undefined,
      credentials,
    );
    expect(access.loadEntity).not.toHaveBeenCalled();
  });

  it('refuses a caller without an entity who sees only some workflows', async () => {
    const { ownership, access, describeSchedule } = setup({
      access: { canListAll: jest.fn(async () => false) },
    });
    await expect(ownership.operable(request())).rejects.toThrow(
      NotAllowedError,
    );
    expect(access.authorizeOn).not.toHaveBeenCalled();
    expect(describeSchedule).not.toHaveBeenCalled();
  });
});
