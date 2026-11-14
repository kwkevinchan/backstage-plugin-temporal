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

import { buildWorkflowGraph, BuildGraphOptions } from './graph';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseActivityLoopMarker,
  parseLoopMarker,
  readLoopState,
} from './loops';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const payload = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});

/** History events in protobuf JSON form, numbered from 1. */
function history() {
  const events: any[] = [];
  const base = Date.parse('2026-01-01T00:00:00Z');
  const api = {
    events,
    add(type: string, attributes: Record<string, unknown> = {}) {
      const eventId = events.length + 1;
      const key = `${type.charAt(0).toLowerCase()}${type.slice(
        1,
      )}EventAttributes`;
      events.push({
        eventId: String(eventId),
        eventTime: { seconds: String(base / 1000 + eventId) },
        eventType: `EVENT_TYPE_${type
          .replace(/([a-z])([A-Z])/g, '$1_$2')
          .toUpperCase()}`,
        [key]: attributes,
      });
      return eventId;
    },
    /** An activity from scheduling to completion. */
    activity(type: string, activityId: string, status = 'Completed') {
      const id = api.add('ActivityTaskScheduled', {
        activityId,
        activityType: { name: type },
      });
      api.add('ActivityTaskStarted', {
        scheduledEventId: String(id),
        attempt: 1,
      });
      if (status === 'Completed') {
        api.add('ActivityTaskCompleted', { scheduledEventId: String(id) });
      } else if (status === 'Failed') {
        api.add('ActivityTaskFailed', {
          scheduledEventId: String(id),
          failure: { message: 'boom' },
        });
      }
      return id;
    },
    upsert(state: unknown) {
      return api.add('WorkflowPropertiesModified', {
        upsertedMemo: { fields: { 'temporal.loops': payload(state) } },
      });
    },
  };
  return api;
}

const options = (
  overrides: Partial<BuildGraphOptions> = {},
): BuildGraphOptions => ({
  namespace: 'default',
  workflowId: 'wf-1',
  status: 'Completed',
  truncated: false,
  includePayloads: false,
  ...overrides,
});

const state = (
  iteration: number,
  status: string,
  last?: Record<string, unknown>,
) => ({
  v: 1,
  segment: 1,
  loops: [
    {
      name: 'review',
      iteration,
      maxIterations: 5,
      status,
      decision: last?.decision,
      score: last?.score,
    },
  ],
  last: last
    ? { loop: 'review', iteration, segment: 1, status: 'completed', ...last }
    : undefined,
});

describe('loop groups in the graph', () => {
  it('groups marked activities by round, with decisions from the memo', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('prepare', '1');
    h.activity('draft', 'loop/review/1/draft');
    h.activity('review', 'loop/review/1/review');
    h.upsert(state(1, 'running', { decision: 'revise', score: 0.4 }));
    h.activity('draft', 'loop/review/2/draft');
    h.activity('review', 'loop/review/2/review');
    h.upsert(state(2, 'done', { decision: 'accept', score: 0.9 }));
    h.activity('publish', '9');
    h.add('WorkflowExecutionCompleted', {});

    const graph = buildWorkflowGraph(h.events, options());
    const draft = graph.nodes.find(n => n.stepId === 'loop/review/2/draft');
    expect(draft?.loop).toEqual({
      loop: 'review',
      iteration: 2,
      step: 'draft',
    });
    expect(graph.loops).toEqual([
      {
        name: 'review',
        status: 'done',
        iteration: 2,
        maxIterations: 5,
        decision: 'accept',
        score: 0.9,
        rounds: [
          expect.objectContaining({
            iteration: 1,
            status: 'Completed',
            decision: 'revise',
            score: 0.4,
            steps: [
              expect.objectContaining({ name: 'draft', status: 'Completed' }),
              expect.objectContaining({ name: 'review', status: 'Completed' }),
            ],
          }),
          expect.objectContaining({
            iteration: 2,
            decision: 'accept',
            score: 0.9,
          }),
        ],
      },
    ]);
    // Steps before and after the loop are not in it.
    const ids = graph.loops![0].rounds.flatMap(r => r.steps.map(s => s.nodeId));
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain(graph.nodes.find(n => n.name === 'publish')!.id);
  });

  it('leaves the graph as it is without markers', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', '1');
    h.add('WorkflowExecutionCompleted', {});
    const graph = buildWorkflowGraph(h.events, options());
    expect(graph.loops).toBeUndefined();
    expect(graph.nodes.every(n => n.loop === undefined)).toBe(true);
  });

  it('puts unmarked steps that start during a round into that round', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    const timer = h.add('TimerStarted', { timerId: 't1' });
    h.add('TimerFired', { startedEventId: String(timer) });
    h.activity('draft', 'loop/review/2/draft');
    h.add('WorkflowExecutionSignaled', { signalName: 'feedback' });
    h.activity('draft', 'loop/review/2/draft/2');
    h.add('WorkflowExecutionCompleted', {});
    const graph = buildWorkflowGraph(h.events, options());
    const [loop] = graph.loops!;
    expect(loop.status).toBe('done');
    expect(loop.rounds.map(r => r.steps.map(s => s.name))).toEqual([
      ['draft', 'Timer'],
      ['draft', 'feedback', 'draft'],
    ]);
  });

  it('shows the round that is still open as running', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    h.upsert(state(1, 'running', { score: 0.1 }));
    h.activity('draft', 'loop/review/2/draft', 'Open');
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    const [loop] = graph.loops!;
    expect(loop).toMatchObject({ status: 'running', iteration: 2 });
    expect(loop.rounds.map(r => r.status)).toEqual(['Completed', 'Running']);
    expect(loop.rounds[1].endTime).toBeUndefined();
  });

  it('keeps a round running while the loop state says so, with nothing open', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    h.upsert(state(1, 'running', {}));
    h.activity('draft', 'loop/review/2/draft');
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.loops![0].rounds.map(r => r.status)).toEqual([
      'Completed',
      'Running',
    ]);
  });

  it('marks failed rounds and loops of a failed run', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    h.activity('draft', 'loop/review/2/draft', 'Failed');
    h.add('WorkflowExecutionFailed', { failure: { message: 'boom' } });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Failed' }));
    expect(graph.loops![0]).toMatchObject({ status: 'failed', iteration: 2 });
    expect(graph.loops![0].rounds[1].status).toBe('Failed');
  });

  it('without a loop state, a loop of a running workflow ends when a later step starts', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    h.activity('publish', 'p', 'Open');
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.loops![0].status).toBe('done');
    expect(graph.loops![0].rounds[0].steps).toHaveLength(1);
  });

  it('continues the round count of a run that continued as new', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {
      continuedExecutionRunId: 'run-1',
      memo: {
        fields: {
          'temporal.loops': payload({
            v: 1,
            segment: 2,
            loops: [
              {
                name: 'long',
                iteration: 10,
                maxIterations: 25,
                status: 'running',
              },
            ],
          }),
        },
      },
    });
    h.activity('step', 'loop/long/11/step');
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.loops![0]).toMatchObject({
      name: 'long',
      iteration: 11,
      maxIterations: 25,
      status: 'running',
    });
    expect(graph.loops![0].rounds.map(r => r.iteration)).toEqual([11]);
  });

  it('shows a loop of a run that continued as new as continued, not running', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', { continuedExecutionRunId: 'run-1' });
    h.activity('draft', 'loop/review/11/draft');
    h.activity('review', 'loop/review/11/review');
    h.upsert(state(11, 'running', { decision: 'revise', score: 0.5 }));
    h.activity('draft', 'loop/review/12/draft');
    h.activity('review', 'loop/review/12/review');
    // The memo still says running when the run hands over to the next one.
    h.upsert(state(12, 'running', { decision: 'revise', score: 0.6 }));
    h.add('WorkflowExecutionContinuedAsNew', { newExecutionRunId: 'run-3' });
    const graph = buildWorkflowGraph(
      h.events,
      options({ status: 'ContinuedAsNew' }),
    );
    const [loop] = graph.loops!;
    expect(loop).toMatchObject({ status: 'continued', iteration: 12 });
    expect(loop.rounds.map(r => [r.iteration, r.status])).toEqual([
      [11, 'Completed'],
      [12, 'Completed'],
    ]);
  });

  it('shows a loop without a loop state of a continued run as continued', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.activity('draft', 'loop/review/1/draft');
    h.add('WorkflowExecutionContinuedAsNew', { newExecutionRunId: 'run-2' });
    const graph = buildWorkflowGraph(
      h.events,
      options({ status: 'ContinuedAsNew' }),
    );
    expect(graph.loops![0].status).toBe('continued');
  });

  it('reads child workflow markers from the memo and the workflow ID', () => {
    const h = history();
    h.add('WorkflowExecutionStarted', {});
    h.add('StartChildWorkflowExecutionInitiated', {
      workflowId: 'custom-id',
      workflowType: { name: 'fix' },
      memo: {
        fields: {
          'temporal.loop': payload({
            loop: 'fixes',
            iteration: 1,
            step: 'fix',
          }),
        },
      },
    });
    h.add('StartChildWorkflowExecutionInitiated', {
      workflowId: 'wf-1/loop/fixes/2/fix',
      workflowType: { name: 'fix' },
    });
    const graph = buildWorkflowGraph(h.events, options({ status: 'Running' }));
    expect(graph.nodes.filter(n => n.loop).map(n => n.loop!.iteration)).toEqual(
      [1, 2],
    );
    expect(graph.loops![0].rounds).toHaveLength(2);
  });
});

describe('readLoopState', () => {
  it('keeps valid fields and drops the rest', () => {
    expect(
      readLoopState({
        v: 1,
        segment: 2,
        loops: [
          {
            name: 'a',
            iteration: 3,
            maxIterations: 0,
            status: 'weird',
            score: 'x',
          },
          { iteration: 1 },
          {
            name: 'b',
            status: 'done',
            rounds: [
              { iteration: 1, decision: 'ok', score: 1 },
              { iteration: 0 },
            ],
          },
        ],
        last: { loop: 'b', iteration: 1, decision: 'ok' },
      }),
    ).toEqual({
      segment: 2,
      loops: [
        { name: 'a', iteration: 3 },
        {
          name: 'b',
          status: 'done',
          rounds: [{ iteration: 1, decision: 'ok', score: 1 }],
        },
      ],
      last: { loop: 'b', iteration: 1, decision: 'ok' },
    });
    expect(readLoopState('nope')).toBeUndefined();
    expect(readLoopState({ loops: 'x' })).toBeUndefined();
  });
});

/**
 * Shared examples of the marker format; the loop helpers of
 * `@kwkevinchan/temporal-workflow-kit/loop` are tested against the same file.
 * `applies` says whether a text is read as an activity ID or as a child
 * workflow ID.
 */
const FIXTURE: { text: string; applies: string; marker: unknown }[] =
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../test-fixtures/loop-markers.json'),
      'utf8',
    ),
  ).examples;
const examplesOf = (kind: 'activity' | 'child'): [string, unknown][] =>
  FIXTURE.filter(e => e.applies === kind || e.applies === 'both').map(e => [
    e.text,
    e.marker ?? undefined,
  ]);

describe('parseLoopMarker (child workflow IDs)', () => {
  it.each(examplesOf('child'))('parses %s', (text, marker) => {
    expect(parseLoopMarker(text)).toEqual(marker);
  });

  it('ignores missing IDs', () => {
    expect(parseLoopMarker(undefined)).toBeUndefined();
    expect(parseLoopMarker('')).toBeUndefined();
  });
});

describe('parseActivityLoopMarker', () => {
  it.each(examplesOf('activity'))('parses %s', (text, marker) => {
    expect(parseActivityLoopMarker(text)).toEqual(marker);
  });

  it('reads the marker after the prefix of an LLM step', () => {
    const step = { loop: 'agent', iteration: 3, step: 'callModel' };
    expect(
      parseActivityLoopMarker('llm/plan%2F1/loop/agent/3/callModel'),
    ).toEqual(step);
    expect(
      parseActivityLoopMarker('tool/r2/toolu_01/loop/agent/3/callModel'),
    ).toEqual(step);
    expect(
      parseActivityLoopMarker('llm/agent-1/tenants/loop/agent/1/callModel'),
    ).toBeUndefined();
  });

  it('ignores missing IDs', () => {
    expect(parseActivityLoopMarker(undefined)).toBeUndefined();
    expect(parseActivityLoopMarker('')).toBeUndefined();
  });
});
