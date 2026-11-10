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

import { screen, within } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import type { Entity } from '@backstage/catalog-model';
import {
  temporalApiRef,
  temporalWorkflowExtensionsApiRef,
} from '../extensions';
import { mockTemporalApi, scheduleListResponse } from '../testData';
import { SchedulesCard } from './SchedulesCard';

const entity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: { owner: 'group:default/a', workflowType: 'orderWorkflow' },
};

async function render(api = mockTemporalApi(), props: object = {}) {
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [
          temporalWorkflowExtensionsApiRef,
          {
            getActions: () => [],
            getSections: () => [],
            getListActions: () => [],
            getScheduleActions: () => [
              {
                id: 'shared',
                component: ({ schedule }) => (
                  <button type="button">Act on {schedule.scheduleId}</button>
                ),
                filter: s => !s.paused,
              },
            ],
          },
        ],
      ]}
    >
      <SchedulesCard {...props} />
    </TestApiProvider>,
  );
  return api;
}

describe('SchedulesCard', () => {
  it('lists the schedules of the namespace with when they run', async () => {
    const api = await render();
    const card = await screen.findByTestId('temporal-schedules');
    expect(api.listSchedules).toHaveBeenCalled();
    const row = (await within(card).findByText('nightly-orders')).closest(
      '[role="row"]',
    ) as HTMLElement;
    expect(row).toHaveTextContent('orderWorkflow');
    expect(row).toHaveTextContent('02:00 on MONDAY-FRIDAY');
    expect(row).toHaveTextContent('Asia/Taipei');
    expect(
      within(row).getByTestId('schedule-state-nightly-orders'),
    ).toHaveTextContent('Active');
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining(
        'namespaces/default/workflows/nightly-orders-2026-01-01T02%3A00%3A00Z/runs/run-n1',
      ),
    );
    // The shared action shows on active schedules only.
    expect(
      within(row).getByRole('button', { name: 'Act on nightly-orders' }),
    ).toBeInTheDocument();
    const paused = screen.getByTestId('schedule-state-weekly-report');
    expect(paused).toHaveTextContent('Paused');
    expect(
      screen.getByText('Paused from Backstage by user:default/alice'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Act on weekly-report' }),
    ).toBeNull();
  });

  it('is left out on the Workflows page without the list permission', async () => {
    const api = mockTemporalApi();
    api.listSchedules.mockRejectedValue(
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
    );
    await render(api);
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByTestId('temporal-schedules')).toBeNull();
  });

  it('shows the schedules of an entity, and nothing when it has none', async () => {
    const api = mockTemporalApi();
    api.listEntitySchedules.mockResolvedValue(scheduleListResponse);
    await render(api, { entity });
    expect(await screen.findByTestId('temporal-schedules')).toBeInTheDocument();
    expect(api.listEntitySchedules).toHaveBeenCalledWith(
      'temporalworkflow:default/order-workflow',
    );
  });

  it('is left out for an entity without schedules', async () => {
    const api = mockTemporalApi();
    await render(api, { entity });
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByTestId('temporal-schedules')).toBeNull();
  });
});
