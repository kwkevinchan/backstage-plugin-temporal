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

import { WorkflowFailedError } from '@temporalio/client';

// The worker and testing packages are loaded without their types: their
// declarations do not pass the repository's full type check (skipLibCheck
// false) with the Node.js types in use.
/* eslint-disable @typescript-eslint/no-require-imports */
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { DefaultLogger, Runtime, Worker } = require('@temporalio/worker');
/* eslint-enable @typescript-eslint/no-require-imports */
type TestEnv = {
  client: import('@temporalio/client').Client;
  nativeConnection: unknown;
  teardown(): Promise<void>;
};
import {
  LOOP_STATE_MEMO_KEY,
  LOOP_STATE_QUERY,
  parseLoopMarker,
} from './marker';
import type { LoopsState } from './state';

jest.setTimeout(240_000);

const taskQueue = 'temporal-loop-test';

const activities = {
  async draft(round: number) {
    return `draft ${round}`;
  },
  async review(_text: string, passAt: number) {
    return { score: passAt <= 0 ? 0 : 1 };
  },
};

/** Activity IDs and child workflow IDs of a run, oldest first. */
async function markers(env: TestEnv, workflowId: string, runId?: string) {
  const handle = env.client.workflow.getHandle(workflowId, runId);
  const history = await handle.fetchHistory();
  return (history.events ?? []).flatMap(e => {
    const id =
      e.activityTaskScheduledEventAttributes?.activityId ??
      e.startChildWorkflowExecutionInitiatedEventAttributes?.workflowId;
    return id ? [id] : [];
  });
}

describe('loop helpers in a workflow', () => {
  let env: TestEnv;
  let worker: { run(): Promise<void>; shutdown(): void };
  let running: Promise<void>;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    env = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('./__fixtures__/workflows'),
      activities,
    });
    running = worker.run();
  });

  afterAll(async () => {
    worker?.shutdown();
    await running;
    await env?.teardown();
  });

  it('marks each activity of each round and stops when a round is done', async () => {
    const handle = await env.client.workflow.start('reviewLoop', {
      taskQueue,
      workflowId: 'review-done',
      args: [{ maxIterations: 5, passAt: 1 }],
    });
    expect(await handle.result()).toEqual({
      status: 'done',
      iterations: 1,
      value: 'draft 1',
      decision: 'accept',
      score: 1,
    });
    expect(await markers(env, 'review-done')).toEqual([
      'loop/review/1/draft',
      'loop/review/1/review',
    ]);
  });

  it('is exhausted after the last round and records the state in the memo', async () => {
    const handle = await env.client.workflow.start('reviewLoop', {
      taskQueue,
      workflowId: 'review-exhausted',
      args: [{ maxIterations: 3, passAt: 0 }],
    });
    const result = await handle.result();
    expect(result).toMatchObject({
      status: 'exhausted',
      iterations: 3,
      value: 'draft 3',
    });
    const ids = await markers(env, 'review-exhausted');
    expect(ids.map(id => parseLoopMarker(id)?.iteration)).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
    const description = await handle.describe();
    const memo = description.memo?.[LOOP_STATE_MEMO_KEY] as LoopsState;
    expect(memo.loops).toEqual([
      expect.objectContaining({
        name: 'review',
        iteration: 3,
        maxIterations: 3,
        status: 'exhausted',
        decision: 'revise',
        score: 0,
      }),
    ]);
    expect(memo.last).toMatchObject({
      loop: 'review',
      iteration: 3,
      status: 'completed',
    });
  });

  it('continues as new and keeps counting the rounds', async () => {
    const handle = await env.client.workflow.start('longLoop', {
      taskQueue,
      workflowId: 'long',
      args: [{ total: 25, every: 10 }],
    });
    const result = await handle.result();
    expect(result).toMatchObject({
      status: 'exhausted',
      iterations: 25,
      value: 25,
    });
    const latest = await env.client.workflow.getHandle('long').describe();
    const memo = latest.memo?.[LOOP_STATE_MEMO_KEY] as LoopsState;
    expect(memo.segment).toBe(3);
    expect(memo.loops[0]).toMatchObject({ iteration: 25, status: 'exhausted' });
    const ids = await markers(env, 'long', latest.runId);
    expect(ids[0]).toBe('loop/long/21/draft');
    expect(ids).toHaveLength(5);
  });

  it('marks the loop failed when a round throws', async () => {
    const handle = await env.client.workflow.start('failingLoop', {
      taskQueue,
      workflowId: 'failing',
    });
    await expect(handle.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    const memo = (await handle.describe()).memo?.[
      LOOP_STATE_MEMO_KEY
    ] as LoopsState;
    expect(memo.loops[0]).toMatchObject({ status: 'failed', iteration: 2 });
  });

  it('answers the loop state query while a round runs', async () => {
    const handle = await env.client.workflow.start('waitingLoop', {
      taskQueue,
      workflowId: 'waiting',
    });
    let state: LoopsState | undefined;
    for (let i = 0; i < 100; i++) {
      state = await handle.query<LoopsState>(LOOP_STATE_QUERY);
      if (state.loops[0]?.iteration === 2) break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(state).toMatchObject({
      v: 1,
      segment: 1,
      loops: [
        {
          name: 'wait',
          iteration: 2,
          maxIterations: 3,
          status: 'running',
          score: 0.1,
          rounds: [
            { iteration: 1, status: 'completed', score: 0.1, segment: 1 },
            { iteration: 2, status: 'running', segment: 1 },
          ],
        },
      ],
    });
    // The same step twice in a round: the second call is numbered.
    expect(await markers(env, 'waiting')).toEqual([
      'loop/wait/1/draft',
      'loop/wait/1/draft/2',
      'loop/wait/2/draft',
      'loop/wait/2/draft/2',
    ]);
    await handle.signal('proceed');
    expect(await handle.result()).toMatchObject({
      status: 'exhausted',
      iterations: 3,
    });
  });

  it('marks child workflows with their ID and memo', async () => {
    const handle = await env.client.workflow.start('childLoop', {
      taskQueue,
      workflowId: 'children',
    });
    expect(await handle.result()).toMatchObject({ value: 4, iterations: 2 });
    expect(await markers(env, 'children')).toEqual([
      'children/loop/children/1/childStep',
      'children/loop/children/2/childStep',
    ]);
    expect(parseLoopMarker('children/loop/children/2/childStep')).toEqual({
      loop: 'children',
      iteration: 2,
      step: 'childStep',
    });
  });
});
