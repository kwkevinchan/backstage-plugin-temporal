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

import type {
  WorkflowEventGroup,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphResponse,
} from '../../common';
import {
  boxSize,
  FRAME_PADDING,
  FRAME_TOP,
  layoutGraph,
  layoutSteps,
  LLM_NODE_HEIGHT,
  LLM_NODE_WIDTH,
  NODE_HEIGHT,
  StepGraphLayout,
  wrapColumns,
  stepSize,
  visibleSteps,
} from './layout';
import {
  framableSource,
  GroupedLayout,
  groupHues,
  groupNodeId,
  GroupViews,
  layoutGroupedSteps,
  planGroups,
} from './eventGroups';
import { agentGraph } from '../../testGraphs/agentGraph';
import { ambiguousGraph } from '../../testGraphs/ambiguousGraph';
import { layoutBaseline } from './layoutBaseline';
import { layoutNotices, refusedNotice } from './groupNotice';
import { loopGraph } from '../../testGraphs/loopGraph';
import { parallelGraph } from '../../testGraphs/parallelGraph';

function laidOut(
  graph: Pick<WorkflowGraphResponse, 'nodes' | 'edges' | 'eventGroups'>,
  views: GroupViews = {},
  width?: number,
): GroupedLayout {
  const visible = visibleSteps(graph.nodes, graph.edges);
  return layoutGroupedSteps(
    visible.nodes.map(n => ({
      id: n.id,
      size: stepSize(n),
      // As the graph of the page marks them.
      ...(framableSource(n) ? { framable: true } : {}),
    })),
    visible.edges,
    graph.eventGroups ?? [],
    views,
    width,
  );
}

function rect(result: GroupedLayout, id: string) {
  const p = result.layout.positions.get(id);
  if (!p) throw new Error(`${id} is not laid out`);
  const size = boxSize(result.layout, id);
  return { ...p, right: p.x + size.width, bottom: p.y + size.height };
}

type Rect = ReturnType<typeof rect>;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.right <= outer.right &&
  inner.y >= outer.y &&
  inner.bottom <= outer.bottom;
const overlap = (a: Rect, b: Rect) =>
  a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

/**
 * Every frame holds the boxes in it and leaves out every other box; frames
 * next to each other do not overlap.
 */
function expectCleanFrames(result: GroupedLayout) {
  const { graph } = result;
  const parentOf = new Map<string, string | undefined>([
    ...graph.frames.map(f => [f.id, f.parent] as const),
    ...graph.nodes.map(n => [n.id, n.parent] as const),
  ]);
  const inside = (id: string, frame: string): boolean => {
    const p = parentOf.get(id);
    return p === frame || (p !== undefined && inside(p, frame));
  };
  for (const frame of graph.frames) {
    const box = rect(result, frame.id);
    if (frame.parent) {
      expect(contains(rect(result, frame.parent), box)).toBe(true);
    }
    for (const node of graph.nodes) {
      const r = rect(result, node.id);
      if (inside(node.id, frame.id)) {
        expect({ node: node.id, in: frame.id, ok: contains(box, r) }).toEqual({
          node: node.id,
          in: frame.id,
          ok: true,
        });
      } else {
        expect({ node: node.id, out: frame.id, ok: !overlap(box, r) }).toEqual({
          node: node.id,
          out: frame.id,
          ok: true,
        });
      }
    }
    for (const other of graph.frames) {
      if (
        other.id === frame.id ||
        inside(other.id, frame.id) ||
        inside(frame.id, other.id)
      ) {
        continue;
      }
      expect({
        frames: [frame.id, other.id],
        ok: !overlap(box, rect(result, other.id)),
      }).toEqual({ frames: [frame.id, other.id], ok: true });
    }
  }
}

const kinds: Record<string, 'workflowStarted' | 'workflowClosed'> = {
  start: 'workflowStarted',
  end: 'workflowClosed',
};

/** A chain of activities `a1` to `aN` from `start` to `end`. */
function chain(count: number): {
  nodes: WorkflowGraphResponse['nodes'];
  edges: WorkflowGraphEdge[];
} {
  const ids = [
    'start',
    ...Array.from({ length: count }, (_, i) => `a${i + 1}`),
    'end',
  ];
  return {
    nodes: ids.map(id => ({
      id,
      kind: kinds[id] ?? 'activity',
      name: id,
      status: 'Completed',
      events: [],
    })),
    edges: ids
      .slice(1)
      .map((id, i) => ({ id: `${ids[i]}->${id}`, source: ids[i], target: id })),
  };
}

function group(
  key: string,
  nodeIds: string[],
  extra: Partial<WorkflowEventGroup> = {},
): WorkflowEventGroup {
  return {
    key: `label:${key}`,
    kind: 'label',
    id: key,
    name: key,
    nodeIds,
    children: [],
    status: 'Completed',
    ...extra,
  };
}

/** Groups with their `parent` and `children` filled in from a list. */
function nest(
  groups: WorkflowEventGroup[],
  parents: Record<string, string>,
): WorkflowEventGroup[] {
  return groups.map(g => {
    const parent = parents[g.id];
    return {
      ...g,
      ...(parent ? { parent: `label:${parent}` } : {}),
      children: groups.filter(c => parents[c.id] === g.id).map(c => c.key),
    };
  });
}

describe('layoutGroupedSteps', () => {
  it('nests frames three deep, each inside the one around it', () => {
    const { nodes, edges } = chain(6);
    const eventGroups = nest(
      [
        group('outer', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']),
        group('middle', ['a2', 'a3', 'a4']),
        group('inner', ['a3']),
      ],
      { middle: 'outer', inner: 'middle' },
    );
    const result = laidOut({ nodes, edges, eventGroups });
    expect(result.graph.frames).toEqual([
      { id: 'group:label:outer' },
      { id: 'group:label:middle', parent: 'group:label:outer' },
      { id: 'group:label:inner', parent: 'group:label:middle' },
    ]);
    const parents = Object.fromEntries(
      result.graph.nodes.map(n => [n.id, n.parent]),
    );
    expect(parents).toMatchObject({
      start: undefined,
      a1: 'group:label:outer',
      a2: 'group:label:middle',
      a3: 'group:label:inner',
      a5: 'group:label:outer',
      end: undefined,
    });
    expectCleanFrames(result);
    // The title bar of a frame is above its steps.
    const inner = rect(result, 'group:label:inner');
    expect(rect(result, 'a3').y - inner.y).toBeGreaterThanOrEqual(30);
  });

  it('collapses a group into one box, with the arrows into and out of it', () => {
    const { nodes, edges } = chain(4);
    const eventGroups = nest(
      [group('outer', ['a2', 'a3']), group('inner', ['a3'])],
      { inner: 'outer' },
    );
    const result = laidOut(
      { nodes, edges, eventGroups },
      { 'label:outer': false },
    );
    expect(result.graph.nodes.map(n => n.id)).toEqual([
      'start',
      'a1',
      'a4',
      'end',
      'group:label:outer',
    ]);
    expect(result.graph.frames).toEqual([]);
    expect(result.graph.edges.map(e => `${e.source}>${e.target}`)).toEqual([
      'start>a1',
      'a1>group:label:outer',
      'group:label:outer>a4',
      'a4>end',
    ]);
    // The inner group is hidden with its outer one.
    expect(result.layout.positions.has('group:label:inner')).toBe(false);
  });

  it('draws a frame around a group of one step', () => {
    const { nodes, edges } = chain(3);
    const result = laidOut({
      nodes,
      edges,
      eventGroups: [group('one', ['a2'])],
    });
    expect(result.graph.frames).toEqual([{ id: 'group:label:one' }]);
    expectCleanFrames(result);
  });

  it('leaves out internal steps, and groups with internal steps only', () => {
    const { nodes, edges } = chain(3);
    const withInternal = [
      ...nodes,
      {
        id: 'memo-9',
        kind: 'event' as const,
        name: 'Memo',
        status: 'Completed' as const,
        internal: true,
        events: [],
      },
    ];
    const result = laidOut({
      nodes: withInternal,
      edges,
      eventGroups: [
        group('steps', ['a1', 'memo-9', 'a2']),
        group('hidden', ['memo-9']),
      ],
    });
    expect(result.graph.frames).toEqual([{ id: 'group:label:steps' }]);
    expect(result.plan.boxes.get('group:label:steps')!.stepIds).toEqual([
      'a1',
      'a2',
    ]);
    expect(result.layout.positions.has('memo-9')).toBe(false);
  });

  it('shows many rounds as a row of collapsed boxes, the running one open', () => {
    const { nodes, edges } = chain(40);
    const rounds = Array.from({ length: 20 }, (_, i) =>
      group(`r${i + 1}`, [`a${2 * i + 1}`, `a${2 * i + 2}`], {
        status: i === 19 ? 'Running' : 'Completed',
      }),
    );
    const eventGroups = nest(
      [
        group(
          'loop',
          rounds.flatMap(r => r.nodeIds),
        ),
        ...rounds,
      ],
      Object.fromEntries(rounds.map(r => [r.id, 'loop'])),
    );
    const result = laidOut({ nodes, edges, eventGroups }, {}, 1200);
    expect(result.graph.frames.map(f => f.id)).toEqual([
      'group:label:loop',
      'group:label:r20',
    ]);
    expect(result.graph.collapsed.map(b => b.id)).toEqual(
      Array.from({ length: 19 }, (_, i) => groupNodeId(`label:r${i + 1}`)),
    );
    expectCleanFrames(result);
  });

  it('puts groups that run in parallel side by side', () => {
    // start → a1 → a2 → end and start → a3 → end, one group each.
    const nodes = chain(3).nodes;
    const edges: WorkflowGraphEdge[] = [
      { id: '1', source: 'start', target: 'a1' },
      { id: '2', source: 'a1', target: 'a2' },
      { id: '3', source: 'a2', target: 'end' },
      { id: '4', source: 'start', target: 'a3' },
      { id: '5', source: 'a3', target: 'end' },
    ];
    const result = laidOut({
      nodes,
      edges,
      eventGroups: [group('left', ['a1', 'a2']), group('right', ['a3'])],
    });
    expect(result.graph.frames.map(f => f.id)).toEqual([
      'group:label:left',
      'group:label:right',
    ]);
    expectCleanFrames(result);
    // One above the other, both after the start.
    const left = rect(result, 'group:label:left');
    const right = rect(result, 'group:label:right');
    expect(left.x < right.right && right.x < left.right).toBe(true);
  });

  it('keeps the frames of the parallel groups of a recorded run apart', () => {
    const result = laidOut(parallelGraph, {}, 1400);
    expectCleanFrames(result);
    // Tag X shares a step with Parallel A without being inside it: a label.
    expect(result.plan.boxes.has('group:label:tag:x')).toBe(false);
    expect(result.plan.tags.get('activity-52')!.map(g => g.key)).toContain(
      'label:tag:x',
    );
    expect(result.plan.boxes.has('group:label:par:a:sub')).toBe(true);
  });

  it('draws groups whose steps take turns in frames that stay apart', () => {
    const { nodes, edges } = chain(4);
    const result = laidOut({
      nodes,
      edges,
      eventGroups: [group('odd', ['a1', 'a3']), group('even', ['a2', 'a4'])],
    });
    expectCleanFrames(result);
    // Each step is in one frame or carries its group as a label.
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      expect(
        result.plan.boxOf.has(id) || result.plan.tags.has(id),
      ).toBeTruthy();
    }
  });

  it('opens the outer group of a recorded loop and collapses its rounds', () => {
    const result = laidOut(loopGraph);
    const boxes = [...result.plan.boxes.values()].map(b => [
      b.group.key,
      b.expanded,
    ]);
    expect(boxes).toEqual([
      ['label:loop:draft-review', true],
      ['label:loop:draft-review:1', false],
      ['label:loop:draft-review:2', false],
      ['label:loop:draft-review:3', false],
      ['event:29', true],
      ['label:wrap-up', true],
    ]);
    expectCleanFrames(result);
    // Expanded, every round is a frame inside the loop.
    const open = laidOut(loopGraph, {
      'label:loop:draft-review:1': true,
      'label:loop:draft-review:2': true,
      'label:loop:draft-review:3': true,
    });
    expect(open.graph.frames).toHaveLength(6);
    expectCleanFrames(open);
    // Wrapped into rows, a frame stays in one row.
    const narrow = laidOut(
      loopGraph,
      {
        'label:loop:draft-review:1': true,
        'label:loop:draft-review:2': true,
        'label:loop:draft-review:3': true,
      },
      900,
    );
    expectCleanFrames(narrow);
  });

  it('nests groups given to single steps inside the group around them', () => {
    const result = laidOut(ambiguousGraph);
    expect(result.graph.frames).toEqual([
      { id: 'group:label:amb:a' },
      { id: 'group:label:amb:z', parent: 'group:label:amb:a' },
      { id: 'group:label:amb:p' },
      { id: 'group:label:amb:q', parent: 'group:label:amb:p' },
    ]);
    expectCleanFrames(result);
  });

  it('lays out the rounds of an agent with model and tool calls', () => {
    const result = laidOut(agentGraph, {
      'label:loop:agent:1': true,
      'label:loop:agent:2': true,
    });
    expect(result.graph.frames.map(f => f.id)).toEqual([
      'group:label:loop:agent',
      'group:label:loop:agent:1',
      'group:label:loop:agent:2',
    ]);
    expectCleanFrames(result);
  });

  it('lays out a thousand steps in a hundred groups', () => {
    const { nodes, edges } = chain(1000);
    const groups = Array.from({ length: 100 }, (_, i) =>
      group(
        `g${i}`,
        Array.from({ length: 10 }, (__, j) => `a${i * 10 + j + 1}`),
      ),
    );
    const started = Date.now();
    const result = laidOut({ nodes, edges, eventGroups: groups }, {}, 1400);
    // The first groups open until the frames hold 200 boxes; the others
    // start collapsed, and can be opened.
    expect(result.graph.frames).toHaveLength(20);
    expect(result.graph.collapsed).toHaveLength(80);
    expect(result.notice).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
    expectCleanFrames(result);

    // A group the user opens comes before those that open by default.
    const late = laidOut(
      { nodes, edges, eventGroups: groups },
      { 'label:g90': true },
      1400,
    );
    expect(late.graph.frames.map(f => f.id)).toContain('group:label:g90');
    expect(late.graph.frames).toHaveLength(20);
    expect(late.refused).toEqual([]);
  });

  it('lines up the rows of fifty frames, each next to a step outside it', () => {
    // r1 → r2 → r3 in each frame, and r2 → s outside it: dagre moves a box
    // of each row for s, and each row is checked and lined up.
    const nodes: { id: string }[] = [];
    const edges: WorkflowGraphEdge[] = [];
    const groups: WorkflowEventGroup[] = [];
    const link = (source: string, target: string) =>
      edges.push({ id: `${source}->${target}`, source, target });
    for (let i = 0; i < 50; i++) {
      const [start, r1, r2, r3, s, t] = ['st', 'r1', 'r2', 'r3', 's', 't'].map(
        id => `${id}${i}`,
      );
      nodes.push(...[start, r1, r2, r3, s, t].map(id => ({ id })));
      link(start, r1);
      link(r1, r2);
      link(r2, r3);
      link(r2, s);
      link(s, t);
      if (i < 49) {
        link(r3, `st${i + 1}`);
        link(t, `st${i + 1}`);
      }
      groups.push(group(`g${i}`, [r1, r2, r3]));
    }
    // Timed against the same layout without lining up the rows, on the
    // same machine.
    const time = (lineUpRows?: boolean) => {
      const started = Date.now();
      const laid = layoutGroupedSteps(
        nodes,
        edges,
        groups,
        {},
        1400,
        (n, e, w, options) => layoutGraph(n, e, w, { ...options, lineUpRows }),
      );
      return { laid, ms: Date.now() - started };
    };
    const plain = time(false);
    const { laid: result, ms } = time();
    expect(ms).toBeLessThan(Math.max(3 * plain.ms, 1000));
    expect(ms).toBeLessThan(5000);
    expect(result.graph.frames).toHaveLength(50);
    const middle = (id: string) =>
      result.layout.positions.get(id)!.y +
      boxSize(result.layout, id).height / 2;
    for (let i = 0; i < 50; i++) {
      const row = ['r1', 'r2', 'r3'].map(id => middle(`${id}${i}`));
      expect({ i, row }).toEqual({ i, row: [row[0], row[0], row[0]] });
    }
  });

  it('says which groups the user opened could not be opened', () => {
    const { nodes, edges } = chain(400);
    const groups = Array.from({ length: 40 }, (_, i) =>
      group(
        `g${i}`,
        Array.from({ length: 10 }, (__, j) => `a${i * 10 + j + 1}`),
      ),
    );
    const result = laidOut(
      { nodes, edges, eventGroups: groups },
      Object.fromEntries(groups.map(g => [g.key, true])),
      1400,
    );
    // 300 boxes at most: 30 groups open, 10 stay collapsed.
    expect(result.refused.map(g => g.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `g${30 + i}`),
    );
    expect(result.graph.collapsed.map(b => b.group.id)).toEqual(
      result.refused.map(g => g.id),
    );
    expect(refusedNotice(result.refused[0])).toBe(
      '“g30” could not be expanded: the groups you expanded already hold 300 boxes. Collapse one of them, or see the steps in the Timeline or the Event Groups tab.',
    );
  });

  it('shows a group around a whole batch as labels, with its steps', () => {
    const { nodes, edges } = chain(400);
    const batch = group(
      'batch',
      Array.from({ length: 400 }, (_, i) => `a${i + 1}`),
    );
    const result = laidOut({ nodes, edges, eventGroups: [batch] }, {}, 1400);
    expect(result.plan.boxes.size).toBe(0);
    expect(result.layout.positions.has('a1')).toBe(true);
    expect(result.plan.tags.get('a1')!.map(g => g.id)).toEqual(['batch']);
    // The graph says why it has no frame.
    expect(result.tooBig.map(g => g.id)).toEqual(['batch']);
    expect(layoutNotices(result)).toEqual([
      '“batch” holds more than 300 boxes, so it is shown as labels on the steps instead of a frame.',
    ]);
  });

  it('shows the groups of a graph too long for frames as labels', () => {
    const { nodes, edges } = chain(600);
    const result = laidOut({
      nodes,
      edges,
      eventGroups: [group('small', ['a3', 'a4'])],
    });
    expect(result.notice).toBe('tooLarge');
    expect(result.graph.frames).toEqual([]);
    expect(layoutNotices(result)).toEqual([
      'The graph is too long to lay out with frames, so expanded groups are shown as labels on their steps. The Timeline and the Event Groups tab show every group.',
    ]);
    expect(result.plan.tags.get('a3')!.map(g => g.id)).toEqual(['small']);
  });

  it('shows every group as labels when the layout fails', () => {
    const { nodes, edges } = chain(6);
    const visible = visibleSteps(nodes, edges);
    for (const error of [new Error('boom'), new TypeError('too deep')]) {
      const result = layoutGroupedSteps(
        visible.nodes,
        visible.edges,
        nest([group('outer', ['a1', 'a2', 'a3']), group('inner', ['a2'])], {
          inner: 'outer',
        }),
        {},
        900,
        () => {
          throw error;
        },
      );
      expect(result.notice).toBe('failed');
      expect(layoutNotices(result)).toEqual([
        'The frames of the event groups could not be laid out, so every group is shown as labels on its steps. The Timeline and the Event Groups tab show every group.',
      ]);
      expect(result.graph.frames).toEqual([]);
      expect(result.plan.boxes.size).toBe(0);
      expect(result.plan.tags.get('a2')!.map(g => g.id)).toEqual([
        'outer',
        'inner',
      ]);
      expect(result.layout).toEqual(
        layoutSteps(visible.nodes, visible.edges, 900),
      );
    }
  });

  it('draws no frame over another box, even when laying out again fails', () => {
    const { nodes, edges } = chain(5);
    const visible = visibleSteps(nodes, edges);
    // A layout that puts a step into the first frame, every time: each new
    // layout drops one frame, and the third one still has a frame left.
    const covering: typeof layoutGraph = (n, e, w, options) => {
      const layout = layoutGraph(n, e, w, options);
      const frame = options?.frames?.[0];
      if (frame) {
        layout.positions.set('start', { ...layout.positions.get(frame.id)! });
      }
      return layout;
    };
    const result = layoutGroupedSteps(
      visible.nodes,
      visible.edges,
      [group('a', ['a1', 'a2']), group('b', ['a3']), group('c', ['a5'])],
      {},
      undefined,
      covering,
    );
    expect(result.graph.frames).toEqual([]);
    expect(result.plan.tags.get('a1')!.map(g => g.id)).toEqual(['a']);
    expect(result.plan.tags.get('a3')!.map(g => g.id)).toEqual(['b']);
    expect(result.plan.tags.get('a5')!.map(g => g.id)).toEqual(['c']);
  });

  it('keeps wrapped outer frames apart from the next column', () => {
    // Two outermost frames whose widths overlap, the later one starting
    // further left: one piece when the graph wraps. Then a column, and a
    // last one that wraps into the next row.
    const layout: StepGraphLayout = {
      positions: new Map([
        ['A', { x: 400, y: 16 }],
        ['B', { x: 16, y: 200 }],
        ['c', { x: 1500, y: 16 }],
        ['d', { x: 1800, y: 16 }],
      ]),
      sizes: new Map([
        ['A', { width: 1000, height: 120 }],
        ['B', { width: 600, height: 120 }],
        ['c', { width: 220, height: 64 }],
        ['d', { width: 220, height: 64 }],
      ]),
      width: 2036,
      height: 336,
      wrapped: false,
    };
    const wrapped = wrapColumns(layout, 1800, ['A', 'B']);
    expect(wrapped.wrapped).toBe(true);
    const left = (id: string) => wrapped.positions.get(id)!.x;
    const right = (id: string) => left(id) + boxSize(wrapped, id).width;
    // The piece is as wide as both frames together.
    expect(right('A') - left('B')).toBe(1384);
    expect(left('c')).toBeGreaterThanOrEqual(right('A'));
  });
});

describe('the frame of a signal or update group', () => {
  /**
   * start → a1 → a2 → end, and a signal `sig` received after a1 whose
   * handler ran h1 → h2. Extra arrows and nodes in `more`; nodes named
   * `sig…` are signals (or updates).
   */
  function received(
    more: { nodes?: string[]; edges?: string[][] } = {},
    kind: 'signal' | 'update' = 'signal',
    status: 'Completed' | 'Failed' | 'Running' | 'Rejected' = 'Completed',
  ) {
    const pairs = [
      ['start', 'a1'],
      ['a1', 'a2'],
      ['a2', 'end'],
      ['a1', 'sig'],
      ['sig', 'h1'],
      ['h1', 'h2'],
      ['h2', 'end'],
      ...(more.edges ?? []),
    ];
    const ids = [
      'start',
      'a1',
      'sig',
      'h1',
      'h2',
      'a2',
      ...(more.nodes ?? []),
      'end',
    ];
    return {
      nodes: ids.map(id => ({
        id,
        kind: kinds[id] ?? (id.startsWith('sig') ? kind : 'activity'),
        name: id,
        status: id === 'sig' ? status : ('Completed' as const),
        events: [],
      })),
      edges: pairs.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
    };
  }

  /** The group of the handler of a signal (or of an update). */
  function handler(
    key: string,
    nodeIds: string[],
    sourceNodeId: string | undefined = 'sig',
    kind: 'event' | 'update' = 'event',
  ): WorkflowEventGroup {
    return {
      key: `${kind}:${key}`,
      kind,
      id: key,
      name: `${key} (${key})`,
      ...(sourceNodeId ? { sourceNodeId } : {}),
      nodeIds,
      children: [],
      status: 'Completed',
    };
  }

  const arrows = (result: GroupedLayout) =>
    result.graph.edges.map(e => `${e.source}>${e.target}`).sort();

  /**
   * No arrow twice, none from a box to itself, every end laid out, and
   * each arrow between two steps follows a path of the graph given.
   */
  function expectArrowsOf(
    result: GroupedLayout,
    graph: { edges: WorkflowGraphEdge[] },
  ) {
    const list = arrows(result);
    expect(new Set(list).size).toBe(list.length);
    const next = new Map<string, string[]>();
    for (const e of graph.edges) {
      next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
    }
    const leadsTo = (from: string, to: string) => {
      const queue = [...(next.get(from) ?? [])];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (id === to) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(next.get(id) ?? []));
      }
      return false;
    };
    for (const e of result.graph.edges) {
      expect(e.source).not.toBe(e.target);
      expect(result.layout.positions.has(e.source)).toBe(true);
      expect(result.layout.positions.has(e.target)).toBe(true);
      if (!e.source.startsWith('group:') && !e.target.startsWith('group:')) {
        expect({ arrow: e.id, path: leadsTo(e.source, e.target) }).toEqual({
          arrow: e.id,
          path: true,
        });
      }
    }
  }

  it.each(['signal', 'update'] as const)(
    'stands for its %s: the arrows into it go to the first step of the group',
    kind => {
      const graph = received({}, kind);
      const groupKind = kind === 'signal' ? 'event' : 'update';
      const result = laidOut({
        ...graph,
        eventGroups: [handler('5', ['h1', 'h2'], 'sig', groupKind)],
      });
      const frame = `group:${groupKind}:5`;
      expect(result.graph.frames).toEqual([{ id: frame }]);
      expect(result.graph.sourceFrames).toEqual(new Map([['sig', frame]]));
      expect(result.graph.nodes.map(n => n.id)).not.toContain('sig');
      expect(result.layout.positions.has('sig')).toBe(false);
      expect(arrows(result)).toEqual([
        'a1>a2',
        'a1>h1',
        'a2>end',
        'h1>h2',
        'h2>end',
        'start>a1',
      ]);
      expectArrowsOf(result, graph);
      expectCleanFrames(result);
    },
  );

  it('draws the signal of a collapsed group, with the arrows as before', () => {
    const graph = received();
    const result = laidOut(
      { ...graph, eventGroups: [handler('5', ['h1', 'h2'])] },
      { 'event:5': false },
    );
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig')).toBe(true);
    expect(arrows(result)).toEqual([
      'a1>a2',
      'a1>sig',
      'a2>end',
      'group:event:5>end',
      'sig>group:event:5',
      'start>a1',
    ]);
  });

  it('draws the signal of a group shown as labels', () => {
    // A group that started first shares h1 with the signal group: the
    // signal group has no box.
    const graph = received();
    const result = laidOut({
      ...graph,
      eventGroups: [group('first', ['h1', 'a2']), handler('5', ['h1', 'h2'])],
    });
    expect(result.plan.boxes.has('group:event:5')).toBe(false);
    expect(result.plan.tags.get('h1')?.map(g => g.key)).toContain('event:5');
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig')).toBe(true);
    expectArrowsOf(result, graph);
  });

  it('draws the signal when laying out the frames fails', () => {
    const graph = received();
    const result = layoutGroupedSteps(
      graph.nodes.map(n => ({ id: n.id })),
      graph.edges,
      [handler('5', ['h1', 'h2'])],
      {},
      undefined,
      () => {
        throw new Error('no layout');
      },
    );
    expect(result.notice).toBe('failed');
    expect(result.layout.positions.has('sig')).toBe(true);
  });

  it('draws a signal that is a step of another group', () => {
    const graph = received();
    const result = laidOut({
      ...graph,
      eventGroups: [group('outer', ['a1', 'sig']), handler('5', ['h1', 'h2'])],
    });
    expect(result.graph.frames.map(f => f.id)).toEqual([
      'group:label:outer',
      'group:event:5',
    ]);
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.graph.nodes.find(n => n.id === 'sig')?.parent).toBe(
      'group:label:outer',
    );
    expectArrowsOf(result, graph);
  });

  it('draws a signal that started two groups', () => {
    const graph = received({ nodes: ['h3'], edges: [['sig', 'h3']] });
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['h1', 'h2']), handler('6', ['h3'])],
    });
    expect(result.graph.frames).toHaveLength(2);
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig')).toBe(true);
  });

  it('draws the signal of a group without a step in the graph', () => {
    const graph = received();
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['internal-7'])],
    });
    expect(result.graph.frames).toEqual([]);
    expect(result.layout.positions.has('sig')).toBe(true);
    expect(arrows(result)).toContain('a1>sig');
  });

  it('keeps the graph of a group whose signal is not in the run', () => {
    // A signal of an earlier run (continue-as-new), or one the history
    // does not have.
    const graph = received();
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['h1', 'h2'], 'signal-1')],
    });
    expect(result.graph.frames).toEqual([{ id: 'group:event:5' }]);
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig')).toBe(true);
    expect(arrows(result)).toContain('sig>h1');
  });

  it('draws a signal that leads to its group only through another step', () => {
    // The handler's step started after another step, not after the signal.
    const graph = received({
      edges: [['sig', 'a2']],
    });
    graph.edges = graph.edges.filter(e => e.id !== 'sig->h1');
    graph.edges.push({ id: 'a2->h1', source: 'a2', target: 'h1' });
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['h1', 'h2'])],
    });
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig')).toBe(true);
  });

  it.each(['Failed', 'Rejected', 'Running'] as const)(
    'draws an update that is %s, with the arrows as before',
    status => {
      const graph = received({}, 'update', status);
      const result = laidOut({
        ...graph,
        eventGroups: [handler('5', ['h1', 'h2'], 'sig', 'update')],
      });
      expect(result.graph.frames).toEqual([{ id: 'group:update:5' }]);
      expect(result.graph.sourceFrames.size).toBe(0);
      expect(result.layout.positions.has('sig')).toBe(true);
      expect(arrows(result)).toEqual(
        expect.arrayContaining(['a1>sig', 'sig>h1']),
      );
    },
  );

  it('draws the start of the run that started an event group', () => {
    const graph = received();
    const result = laidOut({
      ...graph,
      eventGroups: [handler('1', ['a1', 'a2'], 'start')],
    });
    expect(result.graph.frames).toEqual([{ id: 'group:event:1' }]);
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('start')).toBe(true);
    expect(arrows(result)).toContain('start>a1');
  });

  /**
   * The signals `sig1` to `sigN` (or updates) received in one workflow
   * task after a1: in the order of time each leads to the next, and the
   * last one to the step of each handler, `h1` to `hN`.
   */
  function together(messages: ('signal' | 'update')[]) {
    const sigs = messages.map((_, i) => `sig${i + 1}`);
    const steps = messages.map((_, i) => `h${i + 1}`);
    const pairs = [
      ['start', 'a1'],
      ['a1', sigs[0]],
      ...sigs.slice(1).map((id, i) => [sigs[i], id]),
      ...steps.map(id => [sigs[sigs.length - 1], id]),
      ...steps.map(id => [id, 'end']),
    ];
    const ids = ['start', 'a1', ...sigs, ...steps, 'end'];
    return {
      nodes: ids.map(id => ({
        id,
        kind:
          kinds[id] ??
          (id.startsWith('sig')
            ? messages[Number(id.slice(3)) - 1]
            : 'activity'),
        name: id,
        status: 'Completed' as WorkflowGraphNode['status'],
        events: [],
      })),
      edges: pairs.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
      eventGroups: messages.map((kind, i) =>
        handler(
          `${10 + i}`,
          [steps[i]],
          sigs[i],
          kind === 'signal' ? 'event' : 'update',
        ),
      ),
    };
  }

  it.each([
    [['signal', 'signal']],
    [['signal', 'update']],
    [['signal', 'signal', 'signal']],
  ] as const)(
    'stands for each of the messages received in one task (%j)',
    messages => {
      const graph = together([...messages]);
      const result = laidOut(graph);
      expect([...result.graph.sourceFrames.keys()].sort()).toEqual(
        messages.map((_, i) => `sig${i + 1}`),
      );
      expect(result.graph.nodes.some(n => n.id.startsWith('sig'))).toBe(false);
      // Each handler's step after a1, no arrow from one message into the
      // group of another.
      expect(arrows(result)).toEqual(
        [
          ...messages.map((_, i) => `a1>h${i + 1}`),
          ...messages.map((_, i) => `h${i + 1}>end`),
          'start>a1',
        ].sort(),
      );
      expectArrowsOf(result, graph);
      expectCleanFrames(result);
    },
  );

  it('draws a signal received before an update that is still running', () => {
    // The signal leads to its group only through the update, which stays a
    // box: so does the signal.
    const graph = together(['signal', 'update']);
    graph.nodes.find(n => n.id === 'sig2')!.status = 'Running';
    const result = laidOut(graph);
    expect(result.graph.sourceFrames.size).toBe(0);
    expect(result.layout.positions.has('sig1')).toBe(true);
    expect(result.layout.positions.has('sig2')).toBe(true);
  });

  it('stands for its signal around groups inside it, not inside a collapsed group', () => {
    const graph = received();
    const eventGroups = [
      group('outer', ['h1', 'h2']),
      { ...handler('5', ['h1', 'h2']), parent: 'label:outer' },
      { ...group('inner', ['h1']), parent: 'event:5' },
    ];
    eventGroups[0].children = ['event:5'];
    eventGroups[1].children = ['label:inner'];
    const open = laidOut({ ...graph, eventGroups });
    expect(open.graph.frames).toEqual([
      { id: 'group:label:outer' },
      { id: 'group:event:5', parent: 'group:label:outer' },
      { id: 'group:label:inner', parent: 'group:event:5' },
    ]);
    expect(open.graph.sourceFrames).toEqual(
      new Map([['sig', 'group:event:5']]),
    );
    expect(arrows(open)).toContain('a1>h1');
    expectArrowsOf(open, graph);
    expectCleanFrames(open);

    const closed = laidOut({ ...graph, eventGroups }, { 'label:outer': false });
    expect(closed.graph.sourceFrames.size).toBe(0);
    expect(arrows(closed)).toEqual([
      'a1>a2',
      'a1>sig',
      'a2>end',
      'group:label:outer>end',
      'sig>group:label:outer',
      'start>a1',
    ]);
  });

  it('stands for each of several signals', () => {
    const graph = received({
      nodes: ['sig2', 'k1'],
      edges: [
        ['a2', 'sig2'],
        ['sig2', 'k1'],
        ['k1', 'end'],
      ],
    });
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['h1', 'h2']), handler('9', ['k1'], 'sig2')],
    });
    expect(result.graph.sourceFrames).toEqual(
      new Map([
        ['sig', 'group:event:5'],
        ['sig2', 'group:event:9'],
      ]),
    );
    expect(arrows(result)).toEqual(expect.arrayContaining(['a1>h1', 'a2>k1']));
    expectArrowsOf(result, graph);
    expectCleanFrames(result);
  });

  it('leads the arrows into the signal also to the steps after it outside its group', () => {
    // x started after the signal, in the workflow itself.
    const graph = received({
      nodes: ['x'],
      edges: [
        ['sig', 'x'],
        ['x', 'end'],
      ],
    });
    const result = laidOut({
      ...graph,
      eventGroups: [handler('5', ['h1', 'h2'])],
    });
    expect(result.graph.sourceFrames.size).toBe(1);
    expect(arrows(result)).toEqual(expect.arrayContaining(['a1>h1', 'a1>x']));
    expectArrowsOf(result, graph);
  });

  it('stands for the signal of a recorded loop, one arrow fewer', () => {
    const before = visibleSteps(loopGraph.nodes, loopGraph.edges);
    const result = laidOut(loopGraph);
    expect(result.graph.sourceFrames).toEqual(
      new Map([['signal-29', 'group:event:29']]),
    );
    expect(arrows(result)).toEqual([
      'activity-66>activity-72',
      'activity-72>end',
      'group:label:loop:draft-review:1>group:label:loop:draft-review:2',
      'group:label:loop:draft-review:2>activity-33',
      'group:label:loop:draft-review:2>group:label:loop:draft-review:3',
      'group:label:loop:draft-review:3>activity-66',
      'start>group:label:loop:draft-review:1',
    ]);
    expectArrowsOf(result, before);
    expectCleanFrames(result);
    // Round 2 open: the step before the signal leads to the step of its
    // group.
    const open = laidOut(loopGraph, { 'label:loop:draft-review:2': true });
    expect(arrows(open)).toContain('activity-22>activity-33');
    expect(arrows(open).some(a => a.includes('signal-29'))).toBe(false);
    expectArrowsOf(open, before);
  });
});

describe('groupHues', () => {
  it('gives the outermost groups the hues in turn and the others theirs', () => {
    const groups = nest(
      [
        group('first', ['a1', 'a2']),
        group('inner', ['a2']),
        group('deeper', ['a2']),
        group('second', ['a3']),
        { ...group('signal', ['a4']), key: 'event:9', kind: 'event' as const },
        group('third', ['a5']),
        {
          ...group('update', ['a5']),
          key: 'update:3',
          kind: 'update' as const,
          parent: 'label:third',
        },
      ],
      { inner: 'first', deeper: 'inner' },
    );
    groups[5] = { ...groups[5], children: ['update:3'] };
    expect(Object.fromEntries(groupHues(groups))).toEqual({
      'label:first': 1,
      'label:inner': 1,
      'label:deeper': 1,
      'label:second': 2,
      // Signals and updates have the color of messages, also inside.
      'event:9': 'message',
      'label:third': 3,
      'update:3': 'message',
    });
    // The boxes carry them.
    const plan = planGroups(['a1', 'a2', 'a3', 'a4', 'a5'], groups, {});
    expect(plan.boxes.get('group:label:deeper')!.hue).toBe(1);
    expect(plan.boxes.get('group:event:9')!.hue).toBe('message');
  });

  it('starts again with the first hue after the last one', () => {
    const groups = Array.from({ length: 6 }, (_, i) =>
      group(`g${i}`, [`a${i + 1}`]),
    );
    expect([...groupHues(groups).values()]).toEqual([1, 2, 3, 4, 1, 2]);
    expect(groupHues(undefined).size).toBe(0);
  });
});

describe('planGroups', () => {
  it('has no boxes without groups', () => {
    const plan = planGroups(['a1'], undefined, {});
    expect(plan.boxes.size).toBe(0);
    expect(plan.tags.size).toBe(0);
  });

  it('shows groups too deep as labels', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `g${i}`);
    const groups = nest(
      ids.map(id => group(id, ['a1'])),
      Object.fromEntries(ids.slice(1).map((id, i) => [id, ids[i]])),
    );
    const plan = planGroups(['a1'], groups, {});
    expect(plan.boxes.size).toBe(5);
    expect(plan.tags.get('a1')!.map(g => g.id)).toEqual(['g5', 'g6', 'g7']);
    // Groups three deep start collapsed.
    expect([...plan.boxes.values()].map(b => b.expanded)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('boxes of a frame in one row', () => {
  const middle = (layout: StepGraphLayout, id: string) =>
    layout.positions.get(id)!.y + boxSize(layout, id).height / 2;
  const height = (layout: StepGraphLayout, id: string) => boxSize(layout, id).height;
  const rounds = [1, 2, 3].map(i =>
    groupNodeId(`label:loop:draft-review:${i}`),
  );

  // The loop with the signal received in it as a box of its own: a signal
  // group that does not name its signal.
  const loopWithSignal = {
    ...loopGraph,
    eventGroups: loopGraph.eventGroups!.map(
      ({ sourceNodeId: _source, ...g }) => g,
    ),
  };

  it('line up the rounds of a loop, also next to the signal received in it', () => {
    // Wrapped, the step after the loop starts the next row.
    for (const [graph, width] of [1400, 1000, 800].flatMap(w => [
      [loopGraph, w] as const,
      [loopWithSignal, w] as const,
    ])) {
      const { layout } = laidOut(graph, {}, width);
      expect(layout.positions.has('signal-29')).toBe(graph === loopWithSignal);
      const middles = rounds.map(id => middle(layout, id));
      expect({ width, middles }).toEqual({
        width,
        middles: [middles[0], middles[0], middles[0]],
      });
      // The frame is no taller than the row.
      expect(height(layout, groupNodeId('label:loop:draft-review'))).toBe(
        FRAME_TOP + height(layout, rounds[0]) + FRAME_PADDING,
      );
    }
  });

  it('keep the rounds of a loop where the arrow out of the loop stays straight', () => {
    // In one row, the last round and the step after the loop are in line:
    // lining up the rounds would move the step to the arrow out of the loop.
    const { layout } = laidOut(loopGraph);
    const last = rounds[2];
    expect(middle(layout, last)).toBe(middle(layout, 'activity-66'));
    expect(middle(layout, last)).not.toBe(middle(layout, rounds[1]));
  });

  it.each([[[1, 2, 3]], [[1]], [[2]], [[3]]])(
    'line up the steps of each open round of a loop (open: %j)',
    open => {
      const views = Object.fromEntries(
        open.map(i => [`label:loop:draft-review:${i}`, true]),
      );
      for (const width of [undefined, 1400, 1000]) {
        const result = laidOut(loopGraph, views, width);
        for (const round of open.map(i => rounds[i - 1])) {
          const steps = result.graph.nodes.filter(n => n.parent === round);
          expect(steps.length).toBeGreaterThan(1);
          const middles = steps.map(n => middle(result.layout, n.id));
          expect({ width, round, middles }).toEqual({
            width,
            round,
            middles: middles.map(() => middles[0]),
          });
        }
        expectCleanFrames(result);
      }
    },
  );

  // r1 → r2 → r3 in a frame, and r2 → s outside it: dagre puts s in the
  // column of r3, above or below the frame, and moves r3 away from it to
  // make room for it.
  const signalNextToRow = (
    tall: string[],
    after: string[][] = [],
    lineUpRows?: boolean,
  ) => {
    const pairs = [
      ['start', 'r1'],
      ['r1', 'r2'],
      ['r2', 'r3'],
      ['r2', 's'],
      ['s', 't1'],
      ...after,
    ];
    return layoutGraph(
      [...new Set(pairs.flat())].map(id => ({
        id,
        ...(tall.includes(id)
          ? { size: { width: LLM_NODE_WIDTH, height: LLM_NODE_HEIGHT } }
          : {}),
        ...(id.startsWith('r') ? { parent: 'F' } : {}),
      })),
      pairs.map(([source, target]) => ({ source, target })),
      undefined,
      { frames: [{ id: 'F' }], lineUpRows },
    );
  };
  const row = ['r1', 'r2', 'r3'];

  it.each([[[]], [['r1']], [['r2']], [['r1', 'r2']], [['r1', 'r3']]])(
    'line up at their middles, without a larger frame (taller: %j)',
    tall => {
      const before = signalNextToRow(tall, [], false);
      expect(new Set(row.map(id => middle(before, id))).size).toBe(2);
      const layout = signalNextToRow(tall);
      const middles = row.map(id => middle(layout, id));
      expect(middles).toEqual([middles[0], middles[0], middles[0]]);
      const tallest = Math.max(...row.map(id => height(layout, id)));
      expect(height(layout, 'F')).toBe(FRAME_TOP + tallest + FRAME_PADDING);
      // The other box stays clear of the frame, above or below it, and off
      // the middle of the row.
      const frameTop = layout.positions.get('F')!.y;
      const frameBottom = frameTop + height(layout, 'F');
      const top = layout.positions.get('s')!.y;
      const bottom = top + height(layout, 's');
      expect(
        Math.max(top, frameTop) - Math.min(bottom, frameBottom),
      ).toBeGreaterThan(0);
      expect(middle(layout, 's')).not.toBe(middles[0]);
    },
  );

  it.each([[['r3']]])(
    'keep a row whose middles cannot be shared within the row (taller: %j)',
    tall => {
      // The taller last box fits the shared middle of the others only past
      // the top or bottom of the row: lining it up would straighten no more
      // arrows than it bends.
      const layout = signalNextToRow(tall);
      expect([...layout.positions]).toEqual([
        ...signalNextToRow(tall, [], false).positions,
      ]);
      expect(new Set(row.map(id => middle(layout, id))).size).toBe(2);
    },
  );

  it('keep a row where lining it up would bend the arrow out of the frame', () => {
    // r3 → t2 is straight as dagre lays it out: lining up the row would
    // straighten r2 → r3 and bend r3 → t2.
    const after = [['r3', 't2']];
    const layout = signalNextToRow([], after);
    expect([...layout.positions]).toEqual([
      ...signalNextToRow([], after, false).positions,
    ]);
    expect(middle(layout, 'r3')).toBe(middle(layout, 't2'));
  });

  it('keep the two rows of a frame with steps in parallel', () => {
    const ids = ['start', 'a', 'b', 'c', 'end'];
    const pairs = [
      ['start', 'a'],
      ['start', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['c', 'end'],
    ];
    const layout = layoutGraph(
      ids.map(id => ({
        id,
        ...(['a', 'b', 'c'].includes(id) ? { parent: 'F' } : {}),
      })),
      pairs.map(([source, target]) => ({ source, target })),
      undefined,
      { frames: [{ id: 'F' }] },
    );
    const a = layout.positions.get('a')!;
    const b = layout.positions.get('b')!;
    expect(a.x).toBe(b.x);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });
});

describe('layoutGraph', () => {
  it('lays out graphs without frames as before the frames', () => {
    for (const c of layoutBaseline) {
      const options = c.direction ? { direction: 'TB' as const } : {};
      const width = c.width ?? undefined;
      for (const layout of [
        layoutSteps(c.nodes, c.edges, width, options) as StepGraphLayout,
        layoutGraph(c.nodes, c.edges, width, { ...options, frames: [] }),
      ]) {
        expect({
          name: c.name,
          width: c.width,
          positions: [...layout.positions],
          sizes: layout.sizes
            ? [...layout.sizes].map(([id, s]) => [
                id,
                { width: s.width, height: s.height },
              ])
            : null,
          size: [layout.width, layout.height],
          wrapped: layout.wrapped,
          rowGaps: layout.rowGaps ?? null,
        }).toEqual({
          name: c.name,
          width: c.width,
          positions: c.layout.positions,
          sizes: c.layout.sizes,
          size: [c.layout.width, c.layout.height],
          wrapped: c.layout.wrapped,
          rowGaps: c.layout.rowGaps,
        });
      }
    }
  });
});
