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

import { mockServices } from '@backstage/backend-test-utils';
import type { WorkflowDetail } from '../common';
import { WorkflowListQueries } from './WorkflowListQueries';

function listsWith(graph: jest.Mock) {
  return new WorkflowListQueries(
    {} as any,
    {} as any,
    {} as any,
    { graph } as any,
    mockServices.logger.mock(),
  );
}

const run = (status: WorkflowDetail['status']): WorkflowDetail =>
  ({
    namespace: 'default',
    workflowId: 'wf',
    runId: `run-${status}`,
    status,
  } as WorkflowDetail);

describe('the progress cache', () => {
  const graph = () =>
    jest.fn(async () => ({
      status: 'Completed',
      completedSteps: 1,
      totalSteps: 1,
      truncated: false,
    }));

  it.each(['Completed', 'Failed', 'Canceled', 'TimedOut'] as const)(
    'keeps the progress of a %s run',
    async status => {
      const read = graph();
      const lists = listsWith(read);
      await lists.progress(run(status));
      await lists.progress(run(status));
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['Running', 'Unknown'] as const)(
    'does not keep the progress of a %s run',
    async status => {
      const read = graph();
      const lists = listsWith(read);
      await lists.progress(run(status));
      await lists.progress(run(status));
      expect(read).toHaveBeenCalledTimes(2);
    },
  );
});
