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

import type { WorkflowEventGroup, WorkflowGraphResponse } from '../common';
import { readHistoryFixture } from '../__testUtils__/fixtures';
import {
  inferEventGroupParents,
  MAX_EVENT_GROUPS,
  MAX_GROUPS_PER_STEP,
  readEventGroupMarkers,
} from './eventGroups';
import { buildWorkflowGraph, BuildGraphOptions } from './graph';

/** A history of `test-fixtures/<dir>`. */
function fixture(name: string, dir = 'event-groups'): any[] {
  return readHistoryFixture(dir, name).events;
}

const options: BuildGraphOptions = {
  namespace: 'default',
  workflowId: 'wf',
  status: 'Completed',
  truncated: false,
  includePayloads: false,
};

function graphOf(events: any[], extra: Partial<BuildGraphOptions> = {}) {
  const graph = buildWorkflowGraph(events, { ...options, ...extra });
  const groups = graph.eventGroups ?? [];
  const group = (id: string) => {
    const found = groups.find(g => g.key === id || g.id === id);
    if (!found) throw new Error(`no group ${id}`);
    return found;
  };
  const node = (id: string) => graph.nodes.find(n => n.id === id)!;
  return { graph, groups, group, node };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const label = (id: string, text?: string) => ({
  label: {
    id,
    ...(text === undefined
      ? {}
      : {
          label: {
            metadata: { encoding: b64('json/plain') },
            data: b64(JSON.stringify(text)),
          },
        }),
  },
});

/** The time of event `id`, in protobuf JSON form: seconds after 2026. */
const timeAt = (id: number) => ({ seconds: String(1767225600 + id) });

/** A run of activities, each with the given markers, all completed. */
function activities(...markerLists: unknown[][]): any[] {
  const events: any[] = [
    {
      eventId: '1',
      eventTime: timeAt(1),
      eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
      workflowExecutionStartedEventAttributes: {},
    },
  ];
  for (const markers of markerLists) {
    const scheduled = events.length + 1;
    events.push(
      {
        eventId: String(scheduled),
        eventTime: timeAt(scheduled),
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        eventGroupMarkers: markers,
        activityTaskScheduledEventAttributes: {
          activityId: String(scheduled),
          activityType: { name: 'step' },
        },
      },
      {
        eventId: String(scheduled + 1),
        eventTime: timeAt(scheduled + 1),
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED',
        activityTaskCompletedEventAttributes: {
          scheduledEventId: String(scheduled),
        },
      },
    );
  }
  return events;
}

describe('readEventGroupMarkers', () => {
  it('reads the three kinds of markers, outer first, each once', () => {
    expect(
      readEventGroupMarkers({
        eventGroupMarkers: [
          label('outer', 'Outer'),
          { inboundEvent: { inboundEventId: '29' } },
          { inboundEvent: { inboundEventId: 7 } },
          { inboundUpdate: { inboundUpdateId: 'upd-1' } },
          label('outer'),
          { label: { id: '' } },
          { somethingNew: {} },
        ],
      }).map(m => m.key),
    ).toEqual(['label:outer', 'event:29', 'event:7', 'update:upd-1']);
    expect(readEventGroupMarkers({})).toEqual([]);
  });
});

describe('inferEventGroupParents', () => {
  it('nests a group whose steps all carry an outer group', () => {
    const parents = inferEventGroupParents([
      ['loop', 'r1'],
      ['loop', 'r1'],
      ['loop', 'r2'],
    ]);
    expect(parents.get('loop')).toBeUndefined();
    expect(parents.get('r1')).toBe('loop');
    expect(parents.get('r2')).toBe('loop');
  });

  it('picks the innermost of the groups that contain one', () => {
    const parents = inferEventGroupParents([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b'],
    ]);
    expect(parents.get('b')).toBe('a');
    expect(parents.get('c')).toBe('b');
  });

  it('nests a group tagged inside another one, as the data reads', () => {
    // `z` is unrelated in the workflow code; the history cannot tell.
    const parents = inferEventGroupParents([['a'], ['a', 'z']]);
    expect(parents.get('z')).toBe('a');
  });

  it('nests groups with the same steps in the order of the markers', () => {
    const parents = inferEventGroupParents([
      ['p', 'q'],
      ['p', 'q'],
    ]);
    expect(parents.get('p')).toBeUndefined();
    expect(parents.get('q')).toBe('p');
  });

  it('gives overlapping groups that do not contain each other no parent', () => {
    const parents = inferEventGroupParents([['x', 'y'], ['y'], ['a', 'x']]);
    expect(parents.get('x')).toBeUndefined();
    expect(parents.get('y')).toBeUndefined();
    expect(parents.get('a')).toBeUndefined();
  });

  it('needs the outer group before the inner one in every step', () => {
    const parents = inferEventGroupParents([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(parents.get('a')).toBeUndefined();
    expect(parents.get('b')).toBeUndefined();
  });

  it('never makes a cycle', () => {
    // Every order of three groups on the same steps.
    const orders = [
      ['a', 'b', 'c'],
      ['b', 'c', 'a'],
      ['c', 'a', 'b'],
    ];
    for (const first of orders) {
      for (const second of orders) {
        const parents = inferEventGroupParents([first, second]);
        for (const start of ['a', 'b', 'c']) {
          const seen = new Set<string>();
          let at: string | undefined = start;
          while (at) {
            expect(seen.has(at)).toBe(false);
            seen.add(at);
            at = parents.get(at);
          }
        }
      }
    }
  });

  it('reads a large run in linear time', () => {
    // 5000 steps in 500 rounds of one loop, each step also tagged.
    const memberships = Array.from({ length: 5000 }, (_, i) => [
      'loop',
      `round-${Math.floor(i / 10)}`,
      `tag-${i % 7}`,
    ]);
    const started = Date.now();
    const parents = inferEventGroupParents(memberships);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(parents.get('round-499')).toBe('loop');
    // Every tagged step is in the loop, and no round holds all of a tag.
    expect(parents.get('tag-3')).toBe('loop');
  });
});

describe('event groups in the graph', () => {
  it('reads a loop of three rounds as one group with three', () => {
    const { groups, group, node } = graphOf(fixture('loop-ts-sdk-1.25'));
    expect(groups.map(g => g.key)).toEqual([
      'label:loop:draft-review',
      'label:loop:draft-review:1',
      'label:loop:draft-review:2',
      'event:29',
      'label:loop:draft-review:3',
      'label:wrap-up',
    ]);
    const loop = group('loop:draft-review');
    expect(loop).toMatchObject({
      kind: 'label',
      name: 'Loop draft-review',
      status: 'Completed',
      children: [
        'label:loop:draft-review:1',
        'label:loop:draft-review:2',
        'label:loop:draft-review:3',
      ],
    });
    expect(loop.parent).toBeUndefined();
    expect(loop.nodeIds).toHaveLength(9);
    for (const n of [1, 2, 3]) {
      const round = group(`loop:draft-review:${n}`);
      expect(round.name).toBe(`draft-review · round ${n}`);
      expect(round.parent).toBe('label:loop:draft-review');
      expect(round.children).toEqual([]);
      expect(round.nodeIds).toHaveLength(3);
    }
    expect(group('loop:draft-review:1').nodeIds).toEqual([
      'activity-5',
      'timer-11',
      'activity-16',
    ]);
    // Activities and timers belong to their group from schedule to close.
    expect(node('activity-5').groups).toEqual([
      'label:loop:draft-review',
      'label:loop:draft-review:1',
    ]);
    expect(node('activity-5').events.length).toBeGreaterThan(1);
    expect(node('timer-11').groups).toEqual(node('activity-5').groups);
    // Started and ended with its steps.
    const round1 = group('loop:draft-review:1');
    expect(round1.startTime).toBeDefined();
    expect(round1.endTime).toBeDefined();
    expect(round1.startTime).toBe(node('activity-5').startTime);
    expect(round1.endTime).toBe(node('activity-16').endTime);
    // Each round starts before it ends, and after the round before it.
    const times = [1, 2, 3].map(n => {
      const r = group(`loop:draft-review:${n}`);
      return [Date.parse(r.startTime!), Date.parse(r.endTime!)];
    });
    for (const [start, end] of times) {
      expect(start).not.toBeNaN();
      expect(end).toBeGreaterThan(start);
    }
    expect(times[1][0]).toBeGreaterThanOrEqual(times[0][1]);
    expect(times[2][0]).toBeGreaterThanOrEqual(times[1][1]);
    expect(group('loop:draft-review').startTime).toBe(round1.startTime);
    // The timer of a round has the length of its fixture.
    expect(node('timer-11').name).toBe('Timer 2s');
    expect(round1.usage).toBeUndefined();
    expect(round1.llmCalls).toBeUndefined();
    // Not nested, and the steps outside any group have none.
    expect(group('wrap-up').parent).toBeUndefined();
    expect(node('start').groups).toBeUndefined();
  });

  it('names the commands of a signal handler after the signal', () => {
    const { group, node } = graphOf(fixture('loop-ts-sdk-1.25'));
    expect(group('event:29')).toMatchObject({
      kind: 'event',
      id: '29',
      name: 'hint (29)',
      sourceNodeId: 'signal-29',
      nodeIds: ['activity-33'],
      children: [],
    });
    expect(group('event:29').parent).toBeUndefined();
    // The handler's step does not inherit the round it ran in.
    expect(node('activity-33').groups).toEqual(['event:29']);
  });

  it('reads the same groups from SDK 1.24 and 1.25', () => {
    const withoutTimes = (graph: WorkflowGraphResponse) => ({
      groups: graph.eventGroups!.map(
        ({ startTime: _s, endTime: _e, ...g }) => g,
      ),
      nodes: graph.nodes.map(n => [n.id, n.groups]),
    });
    expect(withoutTimes(graphOf(fixture('loop-ts-sdk-1.24')).graph)).toEqual(
      withoutTimes(graphOf(fixture('loop-ts-sdk-1.25')).graph),
    );
  });

  it('puts child workflows and local activities into the groups of the parent', () => {
    const { group, node } = graphOf(fixture('child-local-activity'));
    expect(group('loop:child:2').nodeIds).toEqual([
      'activity-11',
      'marker-17',
      'child-18',
    ]);
    expect(node('marker-17').name).toBe('Local activity');
    expect(node('child-18')).toMatchObject({
      kind: 'childWorkflow',
      status: 'Completed',
      groups: ['label:loop:child', 'label:loop:child:2'],
    });
    expect(group('loop:child:2').parent).toBe('label:loop:child');
    // A group given as a start option.
    expect(group('extra:child-option')).toMatchObject({
      name: 'child via option',
      nodeIds: ['child-27'],
    });
  });

  it('does not carry the groups of the parent into the child history', () => {
    const { groups, node } = graphOf(fixture('child-local-activity.child'));
    expect(groups.map(g => g.key)).toEqual(['label:child:own']);
    expect(node('activity-5').groups).toBeUndefined();
    expect(node('activity-11').groups).toEqual(['label:child:own']);
  });

  it('keeps parallel groups apart and nests the inner one', () => {
    const { group } = graphOf(fixture('parallel'));
    expect(group('par:a').nodeIds).toEqual([
      'activity-5',
      'activity-18',
      'activity-24',
      'activity-52',
    ]);
    expect(group('par:b').nodeIds).toEqual([
      'activity-6',
      'timer-12',
      'activity-34',
    ]);
    expect(group('par:a:sub').parent).toBe('label:par:a');
    expect(group('par:a').children).toEqual(['label:par:a:sub']);
    for (const id of ['par:a', 'par:b', 'tag:x', 'tag:y']) {
      expect(group(id).parent).toBeUndefined();
    }
    // A step with two groups keeps both.
    expect(group('tag:x').nodeIds).toEqual(['activity-40', 'activity-52']);
    expect(group('tag:y').nodeIds).toEqual(['activity-40', 'activity-46']);
  });

  it('nests the cases the history cannot tell from nesting', () => {
    const { group } = graphOf(fixture('ambiguous'));
    // A group tagged on one step inside another group.
    expect(group('amb:z').parent).toBe('label:amb:a');
    expect(group('amb:a').children).toEqual(['label:amb:z']);
    // Two groups on the same steps: in the order of the markers.
    expect(group('amb:p').nodeIds).toEqual(group('amb:q').nodeIds);
    expect(group('amb:q').parent).toBe('label:amb:p');
    expect(group('amb:p').parent).toBeUndefined();
  });

  it('reads a loop in one group without rounds', () => {
    const { groups, group } = graphOf(fixture('flat'));
    expect(groups).toHaveLength(1);
    expect(group('loop:flat')).toMatchObject({
      name: 'Loop flat',
      children: [],
    });
    expect(group('loop:flat').nodeIds).toHaveLength(6);
  });

  it('names a group without a label by its ID, and one without an ID by its label', () => {
    const noLabel = graphOf(fixture('no-label-ts-sdk-1.25')).group('label-0');
    expect(noLabel.name).toBe('label-0');
    expect(noLabel.labelUnreadable).toBeUndefined();
    const noId = graphOf(fixture('no-id-ts-sdk-1.24')).groups[0];
    expect(noId.id).toMatch(/^[0-9a-f]{40}$/);
    expect(noId.key).toBe(`label:${noId.id}`);
    expect(noId.name).toBe('Group without id');
  });

  it('cuts a label like a step summary: first line, trimmed, no length limit', () => {
    // One line of 4000 characters: summaries have no length limit either.
    expect(graphOf(fixture('long-label')).group('label-4000').name).toBe(
      'x'.repeat(4000),
    );
    // The same label after a first line and blanks.
    const events = fixture('long-label');
    const marker = events.find((e: any) => e.eventGroupMarkers)
      .eventGroupMarkers[0].label;
    const long = JSON.parse(
      Buffer.from(marker.label.data, 'base64').toString(),
    );
    marker.label.data = b64(JSON.stringify(`  Long label \n${long}\nmore`));
    const group = graphOf(events).group('label-4000');
    expect(group.name).toBe('Long label');
    expect(group.labelUnreadable).toBeUndefined();
    // A label of blanks names the group by its ID.
    marker.label.data = b64(JSON.stringify(' \n '));
    expect(graphOf(events).group('label-4000').name).toBe('label-4000');
  });

  it('names groups whose label a codec encoded by their ID', () => {
    const { groups, group } = graphOf(fixture('codec-loop'));
    expect(groups).toHaveLength(5);
    for (const g of groups) {
      expect(g.name).toBe(g.id);
      expect(g.labelUnreadable).toBe(true);
    }
    expect(group('loop:draft-review').children).toHaveLength(3);
  });

  it('counts the continued-as-new event in the group it was called in', () => {
    const { graph, group, node } = graphOf(fixture('continue-as-new'), {
      status: 'ContinuedAsNew',
    });
    expect(node('end')).toMatchObject({
      status: 'ContinuedAsNew',
      groups: ['label:loop:can'],
    });
    expect(group('loop:can')).toMatchObject({
      status: 'Completed',
      children: ['label:loop:can:1', 'label:loop:can:2'],
    });
    expect(group('loop:can').nodeIds).toContain('end');
    expect(graph.runChain?.nextRunId).toBeTruthy();
  });

  it('adds up the tokens of the model calls of each group', () => {
    const sum = (
      g: WorkflowEventGroup,
      graph: WorkflowGraphResponse,
      key: 'inputTokens' | 'outputTokens',
    ) =>
      g.nodeIds
        .map(id => graph.nodes.find(n => n.id === id)!.llm?.usage?.[key] ?? 0)
        .reduce((a, b) => a + b, 0);
    for (const [name, rounds] of [
      [
        'vercel-ai-sdk-agent',
        [
          { inputTokens: 643, outputTokens: 90 },
          { inputTokens: 646, outputTokens: 90 },
        ],
      ],
      [
        'openai-agents-agent',
        [
          { inputTokens: 372, outputTokens: 65 },
          { inputTokens: 374, outputTokens: 65 },
        ],
      ],
    ] as const) {
      const { graph, group } = graphOf(fixture(name, 'llm-integrations'));
      const loop = group('loop:agent');
      expect(loop.children).toEqual([
        'label:loop:agent:1',
        'label:loop:agent:2',
      ]);
      rounds.forEach((usage, i) => {
        const round = group(`loop:agent:${i + 1}`);
        expect(round.usage).toMatchObject(usage);
        expect(round.usage!.inputTokens).toBe(sum(round, graph, 'inputTokens'));
      });
      expect(loop.usage!.inputTokens).toBe(
        rounds[0].inputTokens + rounds[1].inputTokens,
      );
      expect(loop.llmCalls).toBe(graph.nodes.filter(n => n.llm).length);
    }
  });

  it('names update groups after the update, and start groups after the event', () => {
    const events = [
      {
        eventId: '1',
        eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
        workflowExecutionStartedEventAttributes: {},
      },
      {
        eventId: '2',
        eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_UPDATE_ACCEPTED',
        workflowExecutionUpdateAcceptedEventAttributes: {
          protocolInstanceId: 'upd-1',
          acceptedRequest: {
            meta: { updateId: 'upd-1' },
            input: { name: 'setLimit' },
          },
        },
      },
      {
        eventId: '3',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        eventGroupMarkers: [{ inboundUpdate: { inboundUpdateId: 'upd-1' } }],
        activityTaskScheduledEventAttributes: {
          activityId: '3',
          activityType: { name: 'apply' },
        },
      },
      {
        eventId: '4',
        eventType: 'EVENT_TYPE_TIMER_STARTED',
        eventGroupMarkers: [{ inboundEvent: { inboundEventId: '1' } }],
        timerStartedEventAttributes: { timerId: '1' },
      },
      {
        eventId: '5',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        eventGroupMarkers: [{ inboundUpdate: { inboundUpdateId: 'gone' } }],
        activityTaskScheduledEventAttributes: {
          activityId: '5',
          activityType: { name: 'apply' },
        },
      },
    ];
    const { group } = graphOf(events, { status: 'Running' });
    expect(group('update:upd-1')).toMatchObject({
      kind: 'update',
      name: 'setLimit (upd-1)',
      sourceNodeId: 'update-2',
      nodeIds: ['activity-3'],
      status: 'Running',
    });
    expect(group('update:upd-1').endTime).toBeUndefined();
    expect(group('event:1')).toMatchObject({
      name: 'WorkflowExecutionStarted',
      sourceNodeId: 'start',
    });
    expect(group('update:gone').name).toBe('gone');
  });

  it('derives the status from the steps', () => {
    const events = activities([label('ok')], [label('bad')]);
    events[4] = {
      eventId: '5',
      eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED',
      activityTaskFailedEventAttributes: {
        scheduledEventId: '4',
        failure: { message: 'boom' },
      },
    };
    const { group } = graphOf(events, { status: 'Failed' });
    expect(group('ok').status).toBe('Completed');
    expect(group('bad').status).toBe('Failed');
  });

  it('ends the groups with steps left open when the run ended', () => {
    // An activity that never closed, a timer that never fired.
    const events = activities(
      [label('done')],
      [label('open')],
      [label('open')],
    );
    events.splice(4, 1);
    events.push({
      eventId: '9',
      eventType: 'EVENT_TYPE_TIMER_STARTED',
      eventTime: timeAt(9),
      eventGroupMarkers: [label('timer')],
      timerStartedEventAttributes: { timerId: '1' },
    });
    const closing = (type: string, attributes: string) => ({
      eventId: '10',
      eventType: `EVENT_TYPE_WORKFLOW_EXECUTION_${type}`,
      eventTime: timeAt(10),
      [attributes]: {},
    });
    const timedOut = graphOf(
      [
        ...events,
        closing('TIMED_OUT', 'workflowExecutionTimedOutEventAttributes'),
      ],
      { status: 'TimedOut' },
    );
    expect(timedOut.node('activity-4').status).toBe('Scheduled');
    expect(timedOut.group('open')).toMatchObject({
      status: 'Failed',
      endTime: '2026-01-01T00:00:10.000Z',
    });
    expect(timedOut.group('timer').status).toBe('Failed');
    expect(timedOut.group('done')).toMatchObject({
      status: 'Completed',
      startTime: '2026-01-01T00:00:02.000Z',
      endTime: '2026-01-01T00:00:03.000Z',
    });

    const completed = graphOf(
      [
        ...events,
        closing('COMPLETED', 'workflowExecutionCompletedEventAttributes'),
      ],
      { status: 'Completed' },
    );
    expect(completed.group('open')).toMatchObject({
      status: 'Canceled',
      endTime: '2026-01-01T00:00:10.000Z',
    });
    expect(completed.group('timer').status).toBe('Canceled');
    expect(completed.group('done').status).toBe('Completed');

    // A history cut before the end: no end time.
    const cut = graphOf(events, { status: 'Terminated', truncated: true });
    expect(cut.group('open').status).toBe('Failed');
    expect(cut.group('open').endTime).toBeUndefined();

    // While the run runs, nothing changes.
    const running = graphOf(events, { status: 'Running' });
    expect(running.group('open').status).toBe('Running');
    expect(running.group('open').endTime).toBeUndefined();
    expect(running.group('timer').status).toBe('Running');
    expect(running.group('done').status).toBe('Completed');
  });

  it('keeps a failed step of a group whose other step was left open', () => {
    // One activity failed, the next never closed, in the same group.
    const events = activities([label('mixed')], [label('mixed')]);
    events[2] = {
      eventId: '3',
      eventTime: timeAt(3),
      eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED',
      activityTaskFailedEventAttributes: {
        scheduledEventId: '2',
        failure: { message: 'boom' },
      },
    };
    events.splice(4, 1);
    const closing = (type: string, attributes: string) => ({
      eventId: '10',
      eventType: `EVENT_TYPE_WORKFLOW_EXECUTION_${type}`,
      eventTime: timeAt(10),
      [attributes]: {},
    });
    const ended = [
      ['COMPLETED', 'workflowExecutionCompletedEventAttributes', 'Completed'],
      ['CANCELED', 'workflowExecutionCanceledEventAttributes', 'Canceled'],
      ['FAILED', 'workflowExecutionFailedEventAttributes', 'Failed'],
    ] as const;
    for (const [type, attributes, status] of ended) {
      const { group, node } = graphOf([...events, closing(type, attributes)], {
        status,
      });
      expect(node('activity-2').status).toBe('Failed');
      expect(node('activity-4').status).toBe('Scheduled');
      expect(group('mixed').status).toBe('Failed');
    }
    // While the run runs, the open step decides.
    expect(graphOf(events, { status: 'Running' }).group('mixed').status).toBe(
      'Running',
    );
  });

  it('leaves the status of a group to its steps when the run status is unknown', () => {
    const events = activities([label('done')], [label('open')]);
    events.splice(4, 1);
    const { group } = graphOf(events, { status: 'Unknown' });
    expect(group('open').status).toBe('Running');
    expect(group('open').endTime).toBeUndefined();
    expect(group('done').status).toBe('Completed');
  });

  it('nests a group opened in a signal handler in the handler group', () => {
    const { group, node } = graphOf(
      activities(
        [label('loop')],
        [{ inboundEvent: { inboundEventId: '1' } }, label('in-handler')],
        [{ inboundEvent: { inboundEventId: '1' } }],
      ),
    );
    expect(node('activity-4').groups).toEqual(['event:1', 'label:in-handler']);
    expect(group('in-handler').parent).toBe('event:1');
    expect(group('event:1').children).toEqual(['label:in-handler']);
    expect(group('event:1').nodeIds).toEqual(['activity-4', 'activity-6']);
    expect(group('loop').parent).toBeUndefined();
  });

  it('nests in each of two parallel branches', () => {
    const { group } = graphOf(
      activities(
        [label('a'), label('a:1')],
        [label('b'), label('b:1')],
        [label('a'), label('a:1')],
        [label('b'), label('b:2')],
        [label('a'), label('a:2')],
      ),
    );
    expect(group('a').children).toEqual(['label:a:1', 'label:a:2']);
    expect(group('b').children).toEqual(['label:b:1', 'label:b:2']);
    expect(group('a').parent).toBeUndefined();
    expect(group('b').parent).toBeUndefined();
    expect(group('b:2').parent).toBe('label:b');
  });

  it('keeps parents, children and members consistent', () => {
    const histories: [string, any[]][] = [
      ...[
        'loop-ts-sdk-1.24',
        'loop-ts-sdk-1.25',
        'child-local-activity',
        'child-local-activity.child',
        'parallel',
        'ambiguous',
        'flat',
        'no-label-ts-sdk-1.25',
        'no-id-ts-sdk-1.24',
        'long-label',
        'continue-as-new',
        'codec-loop',
      ].map(name => [name, fixture(name)] as [string, any[]]),
      ...['vercel-ai-sdk-agent', 'openai-agents-agent'].map(
        name => [name, fixture(name, 'llm-integrations')] as [string, any[]],
      ),
      [
        'too many groups',
        activities(
          ...Array.from({ length: MAX_EVENT_GROUPS + 5 }, (_, i) => [
            label('all'),
            label(`g-${i}`),
          ]),
        ),
      ],
      [
        'too many groups of a step',
        activities(
          Array.from({ length: MAX_GROUPS_PER_STEP + 3 }, (_, i) =>
            label(`d-${i}`),
          ),
          [label('d-0'), label('d-1')],
        ),
      ],
    ];
    for (const [name, events] of histories) {
      const { graph, groups } = graphOf(events);
      // Every broken link, as text: the list must stay empty.
      const problems: string[] = [];
      const byKey = new Map(groups.map(g => [g.key, g]));
      const byId = new Map(graph.nodes.map(n => [n.id, n]));
      for (const g of groups) {
        if (g.parent && !byKey.get(g.parent)?.children.includes(g.key)) {
          problems.push(`${g.key}: not a child of its parent ${g.parent}`);
        }
        for (const child of g.children) {
          if (byKey.get(child)?.parent !== g.key) {
            problems.push(`${g.key}: child ${child} has another parent`);
          }
        }
        for (const id of g.nodeIds) {
          const node = byId.get(id);
          if (!node) problems.push(`${g.key}: no node ${id}`);
          else if (!node.groups?.includes(g.key)) {
            problems.push(`${g.key}: node ${id} lacks the group`);
          }
        }
      }
      for (const node of graph.nodes) {
        for (const key of node.groups ?? []) {
          if (!byKey.get(key)?.nodeIds.includes(node.id)) {
            problems.push(`${node.id}: not a member of ${key}`);
          }
        }
      }
      expect({ name, groups: groups.length > 0, problems }).toEqual({
        name,
        groups: true,
        problems: [],
      });
    }
  });

  it('reads at most a fixed number of groups', () => {
    const many = activities(
      ...Array.from({ length: MAX_EVENT_GROUPS + 1 }, (_, i) => [
        label(`g-${i}`),
      ]),
    );
    const { graph, groups } = graphOf(many);
    expect(groups).toHaveLength(MAX_EVENT_GROUPS);
    expect(graph.eventGroupsTruncated).toBe(true);
    expect(
      graph.nodes.find(n => n.id === `activity-${many.length - 1}`)?.groups,
    ).toBeUndefined();

    const deep = graphOf(
      activities(
        Array.from({ length: MAX_GROUPS_PER_STEP + 1 }, (_, i) =>
          label(`d-${i}`),
        ),
      ),
    );
    expect(deep.groups).toHaveLength(MAX_GROUPS_PER_STEP);
    expect(deep.graph.eventGroupsTruncated).toBe(true);
  });

  it('leaves a graph without groups as it was', () => {
    for (const name of [
      'loop-ts-sdk-1.25',
      'parallel',
      'child-local-activity',
    ]) {
      const events = fixture(name);
      const stripped = structuredClone(events).map((e: any) => {
        delete e.eventGroupMarkers;
        return e;
      });
      const plain = buildWorkflowGraph(stripped, options);
      expect(plain.eventGroups).toBeUndefined();
      expect(plain.eventGroupsTruncated).toBeUndefined();
      expect(plain.nodes.some(n => n.groups)).toBe(false);
      const grouped = buildWorkflowGraph(events, options);
      const { eventGroups: _g, ...rest } = grouped;
      expect({
        ...rest,
        nodes: rest.nodes.map(({ groups: _n, ...node }) => node),
      }).toEqual(plain);
    }
  });

  it('does not depend on the experimental switch', () => {
    const events = fixture('loop-ts-sdk-1.25');
    expect(graphOf(events, { aiWorkflows: false }).graph.eventGroups).toEqual(
      graphOf(events, { aiWorkflows: true }).graph.eventGroups,
    );
  });
});
