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

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { WorkflowEventGroup, WorkflowGraphResponse } from '../common';
import {
  inferEventGroupParents,
  MAX_EVENT_GROUPS,
  MAX_GROUPS_PER_STEP,
  readEventGroupMarkers,
} from './eventGroups';
import { buildWorkflowGraph, BuildGraphOptions } from './graph';

/** A history of `test-fixtures/<dir>`. */
function fixture(name: string, dir = 'event-groups'): any[] {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../../test-fixtures/${dir}/${name}.json`),
      'utf8',
    ),
  ).events;
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

/** A run of activities, each with the given markers, all completed. */
function activities(...markerLists: unknown[][]): any[] {
  const events: any[] = [
    {
      eventId: '1',
      eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
      workflowExecutionStartedEventAttributes: {},
    },
  ];
  for (const markers of markerLists) {
    const scheduled = events.length + 1;
    events.push(
      {
        eventId: String(scheduled),
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        eventGroupMarkers: markers,
        activityTaskScheduledEventAttributes: {
          activityId: String(scheduled),
          activityType: { name: 'step' },
        },
      },
      {
        eventId: String(scheduled + 1),
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
    expect(round1.startTime).toBe(node('activity-5').startTime);
    expect(round1.endTime).toBe(node('activity-16').endTime);
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

  it('keeps long labels whole', () => {
    expect(graphOf(fixture('long-label')).group('label-4000').name).toBe(
      'x'.repeat(4000),
    );
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
