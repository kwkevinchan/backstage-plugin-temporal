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

import { render, screen, within } from '@testing-library/react';
import type { PendingActivity } from '../common';
import { PendingActivities } from './PendingActivities';

const activity: PendingActivity = {
  activityId: 'charge-1',
  activityType: 'chargeCard',
  state: 'Started',
  attempt: 2,
  scheduledTime: '2026-01-01T00:00:00.000Z',
  lastHeartbeatTime: '2026-01-01T00:00:10.000Z',
} as PendingActivity;

describe('PendingActivities', () => {
  it('shows the last heartbeat of an activity, empty when there is none', () => {
    render(
      <PendingActivities
        activities={[
          activity,
          {
            ...activity,
            activityId: 'ship-1',
            lastHeartbeatTime: undefined,
          },
        ]}
      />,
    );
    const table = screen.getByRole('grid', { name: 'Pending activities' });
    expect(
      within(table).getByRole('columnheader', { name: 'Last heartbeat' }),
    ).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(
      new Date(activity.lastHeartbeatTime!).toLocaleString(),
    );
    expect(within(rows[2]).getAllByRole('gridcell')[5]).toHaveTextContent('');
  });
});
