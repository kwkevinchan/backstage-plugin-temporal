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

import { WorkflowRef } from '../common';
import { WorkflowQueries } from './WorkflowQueries';

function setup() {
  const describeExecution = jest.fn(async (ref: WorkflowRef) => ({
    workflowExecutionInfo: {
      execution: { workflowId: ref.workflowId, runId: ref.runId ?? 'run-1' },
      status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
    },
  }));
  const queries = new WorkflowQueries(
    {
      getSearchAttributeNames: () => ({}),
      getWebUiUrl: () => undefined,
    } as any,
    [],
    { warn: jest.fn() } as any,
    { checkNamespace: jest.fn() } as any,
    undefined,
    { describeExecution, lastEvent: jest.fn() } as any,
  );
  return { queries, describeExecution };
}

describe('WorkflowQueries.withPayloads', () => {
  const ref = { namespace: 'default', workflowId: 'wf-1' };

  it('reuses the response of describe for the workflow it was loaded with', async () => {
    const { queries, describeExecution } = setup();
    const workflow = await queries.describe(ref);
    const detail = await queries.withPayloads(workflow, ref);
    expect(detail).toMatchObject({ workflowId: 'wf-1', runId: 'run-1' });
    expect(describeExecution).toHaveBeenCalledTimes(1);
  });

  it('describes again, on the run of the workflow, for another reference', async () => {
    const { queries, describeExecution } = setup();
    const workflow = await queries.describe(ref);
    const detail = await queries.withPayloads(workflow, {
      ...ref,
      workflowId: 'wf-2',
    });
    expect(describeExecution).toHaveBeenCalledTimes(2);
    expect(describeExecution).toHaveBeenLastCalledWith({
      namespace: 'default',
      workflowId: 'wf-2',
      runId: 'run-1',
    });
    expect(detail.workflowId).toBe('wf-2');
  });
});
