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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payload = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});
const ref = 'component:default/orders';

/** Events of one run with one marked activity per round. */
function runEvents(
  rounds: number[],
  options: { previous?: string; next?: string },
) {
  const events: any[] = [];
  const add = (type: string, attributes: Record<string, unknown>) => {
    const key = `${type.charAt(0).toLowerCase()}${type.slice(
      1,
    )}EventAttributes`;
    events.push({ eventId: String(events.length + 1), [key]: attributes });
    return events.length;
  };
  add('WorkflowExecutionStarted', {
    continuedExecutionRunId: options.previous,
  });
  for (const r of rounds) {
    const id = add('ActivityTaskScheduled', {
      activityId: `loop/long/${r}/step`,
      activityType: { name: 'step' },
    });
    add('ActivityTaskCompleted', { scheduledEventId: String(id) });
    add('WorkflowPropertiesModified', {
      upsertedMemo: {
        fields: {
          'temporal.loops': payload({
            v: 1,
            segment: 1,
            loops: [
              {
                name: 'long',
                iteration: r,
                maxIterations: 4,
                status: 'running',
              },
            ],
            last: { loop: 'long', iteration: r, status: 'completed', score: r },
          }),
        },
      },
    });
  }
  if (options.next) {
    add('WorkflowExecutionContinuedAsNew', { newExecutionRunId: options.next });
  }
  return events;
}

async function start(query: 'answers' | 'fails', ai = true) {
  const workflowService: any = createFakeWorkflowService();
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) => ({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: 'wf-1',
          status:
            req.execution.runId === 'run-1'
              ? 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW'
              : 'WORKFLOW_EXECUTION_STATUS_RUNNING',
        }),
        execution: {
          workflowId: 'wf-1',
          runId: req.execution.runId ?? 'run-2',
        },
      },
      pendingActivities: [],
    }),
  );
  workflowService.getWorkflowExecutionHistory.mockImplementation(
    async (req: any) => ({
      history: {
        events:
          req.execution.runId === 'run-1'
            ? runEvents([1, 2], { next: 'run-2' })
            : runEvents([3], { previous: 'run-1' }),
      },
      nextPageToken: new Uint8Array(),
    }),
  );
  workflowService.queryWorkflow = jest.fn(async () => {
    if (query === 'fails') throw new Error('no worker');
    return {
      queryResult: {
        payloads: [
          payload({
            v: 1,
            segment: 2,
            loops: [
              {
                name: 'long',
                iteration: 4,
                maxIterations: 4,
                status: 'running',
                score: 3,
                rounds: [
                  { iteration: 3, segment: 2, status: 'completed', score: 3 },
                  { iteration: 4, segment: 2, status: 'running' },
                ],
              },
            ],
          }),
        ],
      },
    };
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      mockServices.permissions.factory(),
      mockServices.rootConfig.factory({
        data: { temporal: { experimental: { aiWorkflows: ai } } },
      }),
    ],
  });
  return { server: await withOpenApiValidation(server), workflowService };
}

describe('loops route', () => {
  it('is not served unless the AI views are enabled', async () => {
    const { server } = await start('answers', false);
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/run-2/loops?entityRef=${ref}`,
    );
    expect(res.status).toBe(404);
    const graph = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/run-2/graph?entityRef=${ref}`,
    );
    expect(graph.status).toBe(200);
    expect(graph.body.loops).toBeUndefined();
    expect(graph.body.nodes.some((n: { loop?: unknown }) => n.loop)).toBe(
      false,
    );
  });

  it('adds up the rounds of the continue-as-new runs and asks the running one', async () => {
    const { server, workflowService } = await start('answers');
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/run-2/loops?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('query');
    expect(
      res.body.runs.map((r: any) => [r.runId, r.segment, r.status]),
    ).toEqual([
      ['run-1', 1, 'ContinuedAsNew'],
      ['run-2', 2, 'Running'],
    ]);
    const [loop] = res.body.loops;
    expect(loop).toMatchObject({
      name: 'long',
      iteration: 4,
      maxIterations: 4,
      status: 'running',
    });
    expect(
      loop.rounds.map((r: any) => [
        r.iteration,
        r.segment,
        r.status,
        r.score ?? null,
      ]),
    ).toEqual([
      [1, 1, 'Completed', 1],
      [2, 1, 'Completed', 2],
      [3, 2, 'Completed', 3],
      [4, 2, 'Running', null],
    ]);
    expect(workflowService.queryWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ query: { queryType: '__loop_state' } }),
    );
  });

  it('falls back to the histories when the query fails', async () => {
    const { server } = await start('fails');
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/run-1/loops?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('history');
    expect(res.body.loops[0].rounds.map((r: any) => r.iteration)).toEqual([
      1, 2, 3,
    ]);
    expect(res.body.loops[0].iteration).toBe(3);
  });
});
