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

import { recordingLogger } from '../__testUtils__/recordingLogger';
import { fakeScheduleService, grpcError } from '../__testUtils__/schedules';
import { TemporalScheduleRepository } from './TemporalScheduleRepository';

const GRPC_FAILED_PRECONDITION = 9;

function setup(workflowService: Record<string, any>) {
  const deadlines: number[] = [];
  const connection = {
    workflowService,
    withDeadline: async (at: number, fn: () => Promise<unknown>) => {
      deadlines.push(at - Date.now());
      return fn();
    },
  };
  const temporal = { getConnection: async () => connection } as any;
  return {
    schedules: new TemporalScheduleRepository(temporal, recordingLogger()),
    deadlines,
  };
}

const three = [
  { scheduleId: 'a', workflowType: 'orderWorkflow', taskQueue: 'orders' },
  { scheduleId: 'b', workflowType: 'orderWorkflow', taskQueue: 'orders' },
  { scheduleId: 'c', workflowType: 'billingWorkflow', taskQueue: 'billing' },
];

describe('TemporalScheduleRepository', () => {
  it('lists the first schedules of a namespace and tells when there are more', async () => {
    const service = fakeScheduleService(three);
    const { schedules, deadlines } = setup(service);

    const all = await schedules.list('default', 3);
    expect(all.summaries.map(s => s.scheduleId)).toEqual(['a', 'b', 'c']);
    expect(all.more).toBe(false);

    const cut = await schedules.list('default', 2);
    expect(cut.summaries.map(s => s.scheduleId)).toEqual(['a', 'b']);
    expect(cut.more).toBe(true);
    // The deadline of a list, for all its pages.
    expect(deadlines.map(ms => Math.round(ms / 1000))).toEqual([15, 15]);
  });

  it('reads the task queue of a schedule, and none for a schedule that is gone', async () => {
    const { schedules } = setup(fakeScheduleService(three));
    await expect(schedules.taskQueue('default', 'c')).resolves.toBe('billing');
    await expect(
      schedules.taskQueue('default', 'gone'),
    ).resolves.toBeUndefined();
  });

  it('reads the schedule to operate, and does not find one that is gone', async () => {
    const { schedules } = setup(fakeScheduleService(three));
    await expect(schedules.target('default', 'c')).resolves.toMatchObject({
      namespace: 'default',
      scheduleId: 'c',
      workflowType: 'billingWorkflow',
      taskQueue: 'billing',
    });
    await expect(schedules.target('default', 'gone')).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'No schedule gone',
    });
  });

  it('pauses, unpauses and triggers with patches, and maps their errors like those of operations', async () => {
    const service = fakeScheduleService(three);
    const { schedules, deadlines } = setup(service);
    const target = await schedules.target('default', 'a');
    deadlines.length = 0;

    await schedules.pause(target, 'maintenance');
    await schedules.unpause(target, 'done');
    await schedules.trigger(target);
    expect(service.patchSchedule.mock.calls.map(c => c[0].patch)).toEqual([
      expect.objectContaining({ pause: 'maintenance' }),
      expect.objectContaining({ unpause: 'done' }),
      expect.objectContaining({ triggerImmediately: expect.anything() }),
    ]);
    expect(deadlines.map(ms => Math.round(ms / 1000))).toEqual([10, 10, 10]);

    service.patchSchedule.mockRejectedValueOnce(
      grpcError(GRPC_FAILED_PRECONDITION),
    );
    await expect(schedules.pause(target, 'again')).rejects.toMatchObject({
      name: 'ConflictError',
      message: 'The resource is not in a state that allows this',
    });
  });
});
