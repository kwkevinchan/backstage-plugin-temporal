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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type {
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowNodeKind,
  WorkflowNodeStatus,
} from '../../common';
import {
  buildDefinitionGraph,
  durationText,
  END_ID,
  START_ID,
  taskSubtitle,
} from './dslGraph';
import { pointerOfNode, taskAtLine } from './lines';
import { overlayRun, taskIdentities, zigflowActivityType } from './overlay';

const text = readFileSync(
  join(__dirname, '../../../../../test-fixtures/definitions/every-task.yaml'),
  'utf8',
);
const document = parse(text);

/** The lines the backend finds for the fixture (see its tests). */
const fixtureTasks = [
  ['/do/0/validate', 10, 14],
  ['/do/1/route', 15, 21],
  ['/do/2/packItems', 22, 32],
  ['/do/2/packItems/do/0/pack', 28, 32],
  ['/do/3/checks', 33, 52],
  ['/do/3/checks/fork/branches/0/fraud', 37, 41],
  ['/do/3/checks/fork/branches/1/stock', 42, 52],
  ['/do/3/checks/fork/branches/1/stock/do/0/reserve', 44, 52],
  ['/do/4/waitForPayment', 53, 59],
].map(([pointer, startLine, endLine]) => ({
  pointer: pointer as string,
  name: String(pointer).split('/').pop()!,
  startLine: startLine as number,
  endLine: endLine as number,
}));

describe('definition graph', () => {
  const graph = buildDefinitionGraph(document);
  const node = (id: string) => graph.nodes.find(n => n.id === id);
  const edgesFrom = (id: string) =>
    graph.edges
      .filter(e => e.source === id)
      .map(e => [e.target, e.label ?? '', e.kind]);

  it('draws one box per task, with start, end, join and catch', () => {
    expect(graph.nodes.map(n => [n.id, n.kind])).toEqual([
      [START_ID, 'start'],
      ['/do/0/validate', 'call'],
      ['/do/1/route', 'switch'],
      ['/do/2/packItems', 'for'],
      ['/do/2/packItems/do/0/pack', 'call'],
      ['/do/3/checks', 'fork'],
      ['/do/3/checks#join', 'join'],
      ['/do/3/checks/fork/branches/0/fraud', 'call'],
      ['/do/3/checks/fork/branches/1/stock', 'do'],
      ['/do/3/checks/fork/branches/1/stock/do/0/reserve', 'call'],
      ['/do/4/waitForPayment', 'listen'],
      ['/do/5/charge', 'try'],
      ['/do/5/charge/try/0/chargeCard', 'call'],
      ['/do/5/charge#catch', 'catch'],
      ['/do/5/charge/catch/do/0/refund', 'run'],
      ['/do/6/cooldown', 'wait'],
      ['/do/7/notify', 'run'],
      ['/do/8/summary', 'set'],
      ['/do/9/mystery', 'unsupported'],
      ['/do/10/stop', 'raise'],
      ['/do/11/expressShipping', 'do'],
      ['/do/11/expressShipping/do/0/book', 'call'],
      [END_ID, 'end'],
    ]);
    expect(node('/do/0/validate')?.subtitle).toBe('Activity validateOrder');
    expect(node('/do/2/packItems')?.subtitle).toBe(
      'For each item in $input.items',
    );
    expect(node('/do/2/packItems')?.badges).toEqual(['while']);
    expect(node('/do/2/packItems/do/0/pack')?.subtitle).toBe(
      'HTTP POST packing.example.com/items',
    );
    expect(node('/do/3/checks')?.subtitle).toBe('Parallel · 2 branches');
    expect(
      node('/do/3/checks/fork/branches/1/stock/do/0/reserve')?.subtitle,
    ).toBe('gRPC Stock.Reserve');
    expect(node('/do/4/waitForPayment')?.subtitle).toBe(
      'Signal paymentReceived',
    );
    expect(node('/do/5/charge#catch')).toMatchObject({
      subtitle: 'Errors as error',
      badges: ['retry ×3'],
    });
    expect(node('/do/5/charge/catch/do/0/refund')?.subtitle).toBe(
      'Shell echo refund',
    );
    expect(node('/do/6/cooldown')?.subtitle).toBe('Wait 5s');
    expect(node('/do/7/notify')?.subtitle).toBe(
      'Child workflow notify-customer',
    );
    expect(node('/do/9/mystery')?.subtitle).toBe('Unsupported task (teleport)');
    expect(node('/do/10/stop')?.subtitle).toBe('Raise stopped');
    expect(node(START_ID)?.subtitle).toBe('order-flow');
  });

  it('draws switch cases, loops, branches, errors and jumps', () => {
    expect(edgesFrom(START_ID)).toEqual([['/do/0/validate', '', 'next']]);
    expect(edgesFrom('/do/1/route')).toEqual([
      ['/do/2/packItems', 'default', 'jump'],
      ['/do/11/expressShipping', 'express', 'jump'],
    ]);
    expect(edgesFrom('/do/2/packItems')).toEqual([
      ['/do/2/packItems/do/0/pack', 'each', 'next'],
      ['/do/3/checks', 'done', 'next'],
    ]);
    expect(edgesFrom('/do/2/packItems/do/0/pack')).toEqual([
      ['/do/2/packItems', 'next', 'loop'],
    ]);
    expect(edgesFrom('/do/3/checks')).toEqual([
      ['/do/3/checks/fork/branches/0/fraud', 'fraud', 'next'],
      ['/do/3/checks/fork/branches/1/stock', 'stock', 'next'],
    ]);
    expect(
      edgesFrom('/do/3/checks/fork/branches/1/stock/do/0/reserve'),
    ).toEqual([['/do/3/checks#join', '', 'next']]);
    expect(edgesFrom('/do/3/checks#join')).toEqual([
      ['/do/4/waitForPayment', '', 'next'],
    ]);
    expect(edgesFrom('/do/5/charge')).toEqual([
      ['/do/5/charge/try/0/chargeCard', '', 'next'],
      ['/do/5/charge#catch', 'on error', 'error'],
    ]);
    expect(edgesFrom('/do/5/charge#catch')).toEqual([
      ['/do/5/charge', 'retry', 'loop'],
      ['/do/5/charge/catch/do/0/refund', '', 'next'],
    ]);
    // Both the try body and the catch continue with the next task.
    expect(edgesFrom('/do/5/charge/try/0/chargeCard')).toEqual([
      ['/do/6/cooldown', '', 'next'],
    ]);
    expect(edgesFrom('/do/5/charge/catch/do/0/refund')).toEqual([
      ['/do/6/cooldown', '', 'next'],
    ]);
    // A raise does not continue; `then: end` has nothing left to change.
    expect(edgesFrom('/do/10/stop')).toEqual([]);
    expect(edgesFrom('/do/9/mystery')).toEqual([['/do/10/stop', '', 'next']]);
    expect(edgesFrom('/do/11/expressShipping/do/0/book')).toEqual([
      [END_ID, '', 'next'],
    ]);
  });

  it('follows then directives and ignores unknown targets', () => {
    const jumps = buildDefinitionGraph({
      document: { dsl: '1.0.0', name: 'x' },
      do: [
        { a: { set: { x: 1 }, then: 'c' } },
        { b: { set: { y: 1 }, then: 'end' } },
        { c: { set: { z: 1 }, then: 'nowhere' } },
        {
          d: {
            do: [{ e: { wait: 'PT1S', then: 'exit' } }, { f: { set: {} } }],
          },
        },
      ],
    });
    const from = (id: string) =>
      jumps.edges.filter(e => e.source === id).map(e => e.target);
    expect(from('/do/0/a')).toEqual(['/do/2/c']);
    expect(from('/do/1/b')).toEqual([END_ID]);
    expect(from('/do/2/c')).toEqual([]);
    // `exit` leaves the `do` around the task.
    expect(from('/do/3/d/do/0/e')).toEqual([END_ID]);
    expect(from('/do/3/d/do/1/f')).toEqual([END_ID]);
  });

  it('survives documents of any shape', () => {
    for (const bad of [null, 'text', [], { do: 'x' }, { do: [1, 'a', {}] }]) {
      const result = buildDefinitionGraph(bad);
      expect(result.nodes.map(n => n.id)).toEqual([START_ID, END_ID]);
      expect(result.edges).toHaveLength(1);
    }
    expect(
      buildDefinitionGraph({ do: [{ x: 'not an object' }] }).nodes[1],
    ).toMatchObject({ kind: 'unsupported', subtitle: 'Unsupported task' });
    expect(taskSubtitle({ call: 'openapi', with: {} })).toBe('OpenAPI ?');
    expect(durationText({ minutes: 1, seconds: 30 })).toBe('1m 30s');
    expect(durationText('PT10M')).toBe('PT10M');
    expect(durationText({ seconds: '${ $input.wait }' })).toBe(
      '$input.wait seconds',
    );
  });
});

describe('lines and tasks', () => {
  it('finds the innermost task of a line', () => {
    const at = (line: number) => taskAtLine(fixtureTasks, line)?.pointer;
    expect(at(3)).toBeUndefined();
    expect(at(10)).toBe('/do/0/validate');
    expect(at(14)).toBe('/do/0/validate');
    expect(at(24)).toBe('/do/2/packItems');
    expect(at(30)).toBe('/do/2/packItems/do/0/pack');
    expect(at(36)).toBe('/do/3/checks');
    expect(at(43)).toBe('/do/3/checks/fork/branches/1/stock');
    expect(at(50)).toBe('/do/3/checks/fork/branches/1/stock/do/0/reserve');
  });

  it('maps boxes to their task', () => {
    expect(pointerOfNode('/do/3/checks#join')).toBe('/do/3/checks');
    expect(pointerOfNode('/do/0/validate')).toBe('/do/0/validate');
    expect(pointerOfNode(START_ID)).toBeUndefined();
  });
});

let nextId = 1;
function step(
  kind: WorkflowNodeKind,
  name: string,
  status: WorkflowNodeStatus,
  minute: number,
): WorkflowGraphNode {
  return {
    id: `${kind}-${nextId++}`,
    kind,
    name,
    status,
    startTime: `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`,
    events: [],
  };
}

function run(
  status: WorkflowGraphResponse['status'],
  nodes: WorkflowGraphNode[],
): WorkflowGraphResponse {
  return {
    status,
    nodes: [
      { ...step('workflowStarted', 'order-flow', 'Completed', 0) },
      ...nodes,
    ],
    edges: [],
    completedSteps: 0,
    totalSteps: nodes.length,
    truncated: false,
    payloadsHidden: false,
  };
}

describe('run overlay', () => {
  it('names activities like Zigflow', () => {
    expect(zigflowActivityType('order-flow', ['charge', 'try', 'card'])).toBe(
      'order-flow.charge.try.card',
    );
    expect(zigflowActivityType('wf', ['a.b', 'c\\d'])).toBe('wf.a\\.b.c\\\\d');
    const ids = taskIdentities(document);
    expect(ids.get('/do/0/validate')).toEqual({
      activityType: 'validateOrder',
    });
    expect(ids.get('/do/2/packItems/do/0/pack')).toEqual({
      activityType: 'order-flow.packItems.pack',
    });
    expect(ids.get('/do/3/checks/fork/branches/0/fraud')).toEqual({
      childWorkflowType: 'workflow_fork_checks_fraud',
    });
    expect(ids.get('/do/3/checks/fork/branches/1/stock/do/0/reserve')).toEqual({
      activityType: 'order-flow.checks.stock.reserve',
      maybeInChild: true,
    });
    expect(ids.get('/do/4/waitForPayment')).toEqual({
      signals: ['paymentReceived'],
    });
    expect(ids.get('/do/5/charge/catch/do/0/refund')).toEqual({
      activityType: 'order-flow.charge.catch.refund',
    });
    expect(ids.get('/do/7/notify')).toEqual({
      childWorkflowType: 'notify-customer',
    });
    expect(ids.get('/do/11/expressShipping')).toEqual({
      childWorkflowType: 'expressShipping',
      maybeInChild: true,
    });
    // set, switch, wait, raise and the boxes of do, for, try: no event.
    for (const pointer of [
      '/do/1/route',
      '/do/2/packItems',
      '/do/5/charge',
      '/do/6/cooldown',
      '/do/8/summary',
      '/do/9/mystery',
      '/do/10/stop',
    ]) {
      expect(ids.has(pointer)).toBe(false);
    }
  });

  it('marks done, running, failed and not reached tasks', () => {
    const overlay = overlayRun(
      document,
      run('Failed', [
        step('activity', 'validateOrder', 'Completed', 1),
        step('activity', 'order-flow.packItems.pack', 'Completed', 2),
        step('activity', 'order-flow.packItems.pack', 'Completed', 3),
        step('activity', 'order-flow.packItems.pack', 'Failed', 4),
        step('childWorkflow', 'workflow_fork_checks_fraud', 'Completed', 5),
        step('childWorkflow', 'workflow_fork_checks_stock', 'Failed', 5),
        step('signal', 'paymentReceived', 'Completed', 6),
        step('activity', 'chargeCard', 'Failed', 7),
        step('activity', 'order-flow.charge.catch.refund', 'Completed', 8),
        step('timer', '1', 'Completed', 9),
        step('activity', 'somethingElse', 'Completed', 10),
      ]),
    );
    const mark = (pointer: string) => {
      const m = overlay.marks.get(pointer);
      return m ? [m.status, m.count] : undefined;
    };
    expect(mark('/do/0/validate')).toEqual(['Completed', 1]);
    // The latest of three rounds of the loop.
    expect(mark('/do/2/packItems/do/0/pack')).toEqual(['Failed', 3]);
    expect(mark('/do/3/checks/fork/branches/0/fraud')).toEqual([
      'Completed',
      1,
    ]);
    expect(mark('/do/3/checks/fork/branches/1/stock')).toEqual(['Failed', 1]);
    // Runs in the child: neither found nor reported missing.
    expect(mark('/do/3/checks/fork/branches/1/stock/do/0/reserve')).toBe(
      undefined,
    );
    expect(mark('/do/4/waitForPayment')).toEqual(['Completed', 1]);
    expect(mark('/do/5/charge/try/0/chargeCard')).toEqual(['Failed', 1]);
    expect(mark('/do/5/charge/catch/do/0/refund')).toEqual(['Completed', 1]);
    expect(mark('/do/7/notify')).toEqual(['NotReached', 0]);
    expect(mark('/do/11/expressShipping')).toBeUndefined();
    expect(mark('/do/11/expressShipping/do/0/book')).toBeUndefined();
    expect(mark('/do/6/cooldown')).toBeUndefined();
    expect(overlay.unmatched).toBe(1);
  });

  it('says not yet for a running run, and waits for every event of listen all', () => {
    const doc = {
      document: { dsl: '1.0.0', workflowType: 'w' },
      do: [
        {
          approvals: {
            listen: {
              to: {
                all: [
                  { with: { id: 'first', type: 'signal' } },
                  { with: { id: 'second', type: 'update' } },
                ],
              },
            },
          },
        },
        { later: { call: 'http', with: { method: 'get', endpoint: 'x' } } },
      ],
    };
    const overlay = overlayRun(
      doc,
      run('Running', [step('signal', 'first', 'Completed', 1)]),
    );
    expect(overlay.marks.get('/do/0/approvals')?.status).toBe('Waiting');
    expect(overlay.marks.get('/do/1/later')?.status).toBe('Pending');
  });

  it('does not mark tasks that share a name', () => {
    const doc = {
      document: { dsl: '1.0.0', workflowType: 'w' },
      do: [
        { one: { call: 'activity', with: { name: 'same' } } },
        { two: { call: 'activity', with: { name: 'same' } } },
        { three: { call: 'activity', with: { name: 'other' } } },
      ],
    };
    expect([...taskIdentities(doc).keys()]).toEqual(['/do/2/three']);
    const overlay = overlayRun(
      doc,
      run('Completed', [step('activity', 'same', 'Completed', 1)]),
    );
    expect(overlay.marks.has('/do/0/one')).toBe(false);
    expect(overlay.marks.get('/do/2/three')?.status).toBe('NotReached');
  });
});
