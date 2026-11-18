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

import { fakeScheduleService } from '../__testUtils__/schedules';
import { scheduleClientOf } from './scheduleClient';

describe('scheduleClientOf', () => {
  const setup = () => {
    const workflowService = fakeScheduleService([
      {
        scheduleId: 'secret',
        workflowType: 'orderWorkflow',
        undecodable: true,
      },
    ]);
    const client = scheduleClientOf({ workflowService } as any, 'default');
    return { workflowService, client };
  };

  it('describes a schedule whose payloads cannot be decoded', async () => {
    const { client } = setup();
    const description = await client.getHandle('secret').describe();
    expect(description.action).toMatchObject({
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    });
    expect(description.memo?.owner).toEqual({
      encoding: 'binary/encrypted',
      size: 4,
      undecodable: true,
    });
  });

  it('does not write schedules back with their payloads replaced', async () => {
    const { client, workflowService } = setup();
    await expect(
      client.getHandle('secret').update(current => current as any),
    ).rejects.toThrow('only reads schedules');
    expect(workflowService.updateSchedule).not.toHaveBeenCalled();
  });
});
