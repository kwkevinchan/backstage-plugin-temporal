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

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { WorkflowTypeOverview } from '../common';
import { temporalApiRef } from '../extensions';
import { mockTemporalApi, workflowEntity } from '../testData';
import { TemporalWorkflowStatsCard } from './TemporalWorkflowStatsCard';

const entityRef = 'temporalworkflow:default/order-workflow';

function overview(extra: Partial<WorkflowTypeOverview>): WorkflowTypeOverview {
  return {
    entityRef,
    running: 1,
    completed: 4,
    failed: 2,
    windowDays: 7,
    sampleSize: 7,
    averageDurationMs: 2500,
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

async function render(api: ReturnType<typeof mockTemporalApi>) {
  return renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <EntityProvider entity={workflowEntity}>
        <TemporalWorkflowStatsCard />
      </EntityProvider>
    </TestApiProvider>,
  );
}

describe('TemporalWorkflowStatsCard', () => {
  it('shows the numbers of the workflow overview', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockResolvedValue({ items: [overview({})] });
    await render(api);

    const group = (name: string) => within(screen.getByRole('group', { name }));
    expect(await screen.findByRole('group', { name: 'Running' })).toBeVisible();
    expect(group('Running').getByText('1')).toBeInTheDocument();
    expect(group('Completed').getByText('4')).toBeInTheDocument();
    expect(group('Failed').getByText('2')).toBeInTheDocument();
    expect(group('Average duration').getByText('2.5s')).toBeInTheDocument();
    expect(api.getWorkflowTypeOverview).toHaveBeenCalledWith(
      [entityRef],
      undefined,
    );
  });

  it('reads the numbers again from Temporal when Refresh is pressed', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview
      .mockResolvedValueOnce({ items: [overview({ completed: 4 })] })
      .mockResolvedValueOnce({ items: [overview({ completed: 5 })] });
    await render(api);
    await screen.findByRole('group', { name: 'Completed' });

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'Completed' })).getByText('5'),
      ).toBeInTheDocument(),
    );
    expect(api.getWorkflowTypeOverview).toHaveBeenLastCalledWith([entityRef], {
      refresh: true,
    });
  });

  it('shows the message of numbers that could not be read', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockResolvedValue({
      items: [
        overview({
          running: 0,
          completed: 0,
          failed: 0,
          error: { message: 'Temporal did not answer in time' },
        }),
      ],
    });
    await render(api);

    expect(
      await screen.findByText(/Temporal did not answer in time/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Completed' })).toBeNull();
  });

  it('shows an error when the entity is not in the response', async () => {
    const api = mockTemporalApi();
    api.getWorkflowTypeOverview.mockResolvedValue({ items: [] });
    await render(api);

    expect(await screen.findByText(/No statistics/)).toBeInTheDocument();
  });
});
