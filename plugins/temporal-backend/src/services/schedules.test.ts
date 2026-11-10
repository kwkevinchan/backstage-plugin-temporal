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

import { scheduleSummary } from '../testUtils';
import { calendarText, durationText, toTemporalSchedule } from './schedules';

describe('schedules', () => {
  it('describes when a schedule runs', () => {
    const schedule = toTemporalSchedule(
      'default',
      scheduleSummary('nightly', 'orderWorkflow') as any,
    );
    expect(schedule).toEqual({
      namespace: 'default',
      scheduleId: 'nightly',
      workflowType: 'orderWorkflow',
      spec: ['every 1h', '02:00 on MONDAY-FRIDAY'],
      timezone: 'Asia/Taipei',
      paused: false,
      nextActionTimes: ['2026-01-03T02:00:00.000Z'],
      recentActions: [
        {
          scheduledAt: '2026-01-02T02:00:00.000Z',
          takenAt: '2026-01-02T02:00:01.000Z',
          workflowId: 'nightly-2',
          runId: 'run-2',
        },
        {
          scheduledAt: '2026-01-01T02:00:00.000Z',
          takenAt: '2026-01-01T02:00:01.000Z',
          workflowId: 'nightly-1',
          runId: 'run-1',
        },
      ],
    });
  });

  it('writes calendars and durations', () => {
    const every = [{ start: 0, end: 59, step: 1 }];
    expect(
      calendarText({
        second: [{ start: 0 }],
        minute: [{ start: 0, end: 59, step: 15 }],
        hour: [{ start: 0, end: 23, step: 1 }],
        dayOfMonth: [{ start: 1 }],
        month: [{ start: 'JANUARY', end: 'DECEMBER' }],
        year: [],
        dayOfWeek: [{ start: 'SUNDAY', end: 'SATURDAY' }],
      } as any),
    ).toBe('*:0-59/15 day 1');
    expect(calendarText({ comment: 'Month end', minute: every } as any)).toBe(
      'Month end',
    );
    expect(durationText(90 * 60 * 1000)).toBe('1h 30m');
    expect(durationText(2 * 86400 * 1000)).toBe('2d');
  });
});
