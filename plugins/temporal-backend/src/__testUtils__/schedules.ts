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

import { msToTs } from '@temporalio/common/lib/time';

/** A schedule of {@link fakeScheduleService}. */
export interface FakeSchedule {
  scheduleId: string;
  workflowType: string;
  taskQueue?: string;
  paused?: boolean;
  /**
   * Its memo and action arguments are encoded by a payload codec that the
   * plugin does not know (`binary/encrypted`).
   */
  undecodable?: boolean;
}

/** A gRPC error, as the client's connection throws it. */
export function grpcError(code: number, details = `code ${code}`) {
  return Object.assign(new Error(`${code} ${details}`), {
    code,
    details,
    metadata: { get: () => [] },
  });
}

const timestamp = (iso: string) => msToTs(Date.parse(iso));

const encryptedPayload = {
  metadata: { encoding: Buffer.from('binary/encrypted') },
  data: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
};

const rawSpec = {
  interval: [{ interval: msToTs(3600_000), phase: msToTs(0) }],
  structuredCalendar: [
    {
      second: [{ start: 0, end: 0, step: 1 }],
      minute: [{ start: 0, end: 0, step: 1 }],
      hour: [{ start: 2, end: 2, step: 1 }],
      dayOfMonth: [{ start: 1, end: 31, step: 1 }],
      month: [{ start: 1, end: 12, step: 1 }],
      year: [],
      dayOfWeek: [{ start: 1, end: 5, step: 1 }],
    },
  ],
  timezoneName: 'Asia/Taipei',
};

const rawRecentActions = (scheduleId: string) =>
  [1, 2].map(n => ({
    scheduleTime: timestamp(`2026-01-0${n}T02:00:00Z`),
    actualTime: timestamp(`2026-01-0${n}T02:00:01Z`),
    startWorkflowResult: {
      workflowId: `${scheduleId}-${n}`,
      runId: `run-${n}`,
    },
  }));

/**
 * The schedule calls of Temporal's workflow service (`listSchedules`,
 * `describeSchedule`, `patchSchedule`) over some schedules, as the gRPC
 * client answers them. Spread into the fake workflow service. A schedule
 * that is not there is a NOT_FOUND error.
 */
export function fakeScheduleService(schedules: FakeSchedule[]) {
  return {
    listSchedules: jest.fn(async (_req: any) => ({
      schedules: schedules.map(s => ({
        scheduleId: s.scheduleId,
        memo: s.undecodable ? { fields: { owner: encryptedPayload } } : {},
        info: {
          spec: rawSpec,
          workflowType: { name: s.workflowType },
          paused: s.paused ?? false,
          notes: s.paused ? 'maintenance' : '',
          recentActions: rawRecentActions(s.scheduleId),
          futureActionTimes: [timestamp('2026-01-03T02:00:00Z')],
        },
      })),
      nextPageToken: new Uint8Array(),
    })),
    describeSchedule: jest.fn(async (req: any) => {
      const s = schedules.find(f => f.scheduleId === req.scheduleId);
      if (!s) throw grpcError(5, 'schedule not found');
      return {
        memo: s.undecodable ? { fields: { owner: encryptedPayload } } : {},
        schedule: {
          spec: rawSpec,
          action: {
            startWorkflow: {
              workflowId: `${s.scheduleId}-workflow`,
              workflowType: { name: s.workflowType },
              taskQueue: { name: s.taskQueue ?? 'orders' },
              input: s.undecodable ? { payloads: [encryptedPayload] } : {},
              memo: s.undecodable
                ? { fields: { owner: encryptedPayload } }
                : {},
            },
          },
          // BUFFER_ONE: a policy the operations must read from the schedule.
          policies: { overlapPolicy: 2 },
          state: { paused: s.paused ?? false },
        },
        info: {
          createTime: timestamp('2026-01-01T00:00:00Z'),
          recentActions: rawRecentActions(s.scheduleId),
          futureActionTimes: [timestamp('2026-01-03T02:00:00Z')],
        },
      };
    }),
    updateSchedule: jest.fn(async (_req: any) => ({})),
    patchSchedule: jest.fn(async (req: any) => {
      if (!schedules.some(f => f.scheduleId === req.scheduleId)) {
        throw grpcError(5, 'schedule not found');
      }
      return {};
    }),
  };
}
