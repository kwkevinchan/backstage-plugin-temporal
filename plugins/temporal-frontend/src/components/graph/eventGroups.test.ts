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
  WorkflowGraphResponse,
} from '../../common';
import {
  boxSize,
  layoutGraph,
  layoutSteps,
  stepSize,
  visibleSteps,
} from './layout';
import {
  GroupedLayout,
  groupNodeId,
  GroupViews,
  layoutGroupedSteps,
  planGroups,
} from './eventGroups';
import { agentGraph } from '../../testGraphs/agentGraph';
import { ambiguousGraph } from '../../testGraphs/ambiguousGraph';
import { loopGraph } from '../../testGraphs/loopGraph';
import { parallelGraph } from '../../testGraphs/parallelGraph';

function laidOut(
  graph: Pick<WorkflowGraphResponse, 'nodes' | 'edges' | 'eventGroups'>,
  views: GroupViews = {},
  width?: number,
): GroupedLayout {
  const visible = visibleSteps(graph.nodes, graph.edges);
  return layoutGroupedSteps(
    visible.nodes.map(n => ({ id: n.id, size: stepSize(n) })),
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
    // start collapsed.
    expect(result.graph.frames).toHaveLength(20);
    expect(result.graph.collapsed).toHaveLength(80);
    expect(Date.now() - started).toBeLessThan(5000);
    expectCleanFrames(result);

    // Every group opened by hand: the frames hold 300 boxes at most, the
    // other groups stay collapsed.
    const all = laidOut(
      { nodes, edges, eventGroups: groups },
      Object.fromEntries(groups.map(g => [g.key, true])),
      1400,
    );
    expect(all.graph.frames).toHaveLength(30);
    expect(all.graph.collapsed).toHaveLength(70);
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

describe('layoutGraph', () => {
  it('lays out a graph without frames like layoutSteps', () => {
    const { nodes, edges } = chain(30);
    expect(layoutGraph(nodes, edges, 900, { frames: [] })).toEqual(
      layoutSteps(nodes, edges, 900),
    );
  });
});
