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

import { Edge, getSmoothStepPath, Position } from '@xyflow/react';
import type {
  WorkflowEventGroup,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '../../common';
import { routeRowGaps } from './frameEdge';
import { GroupedLayout, GroupViews, layoutGroupedSteps } from './eventGroups';
import {
  FrameEdgeData,
  frameEdgePath,
  frameEdgePoints,
  frameInsets,
  Point,
} from './frameEdge';
import {
  boxSize,
  EDGE_LANE_GAP,
  layoutGraph,
  NodeSize,
  StepGraphLayout,
  stepSize,
  visibleSteps,
} from './layout';
import { agentGraph } from '../../testGraphs/agentGraph';
import { loopGraph } from '../../testGraphs/loopGraph';
import { parallelGraph } from '../../testGraphs/parallelGraph';

/** Space an arrow keeps from a frame border it runs along. */
const CLEAR = 20;
/** Random runs and graphs the layout is checked with. */
const FIRST_SEED = 2001;
const SEEDS = 150;
/**
 * At most this many problems in the random layouts below, as measured. A
 * bound against regressions, not a demand for none: a problem a random
 * layout turns up is a known limit, weighed when a change adds one, not a
 * rule to add.
 */
const KNOWN_PROBLEMS = {
  runs: 0,
  graphs: 0,
  'one or two signals': 152,
  'one to three signals, some leading nowhere': 200,
};
/**
 * At most this many arrows already running through boxes before row alignment
 * (`lineUpRows = false`) in the random runs and graphs below, as measured. A
 * bound against regressions in dagre or edge routing, not a demand for none.
 */
const KNOWN_PREEXISTING_THROUGH_BOXES = {
  runs: 47,
  graphs: 222,
};
/** Space between two columns of steps. */
const COLUMN = 56;

function chain(count: number): {
  nodes: WorkflowGraphNode[];
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
      kind: 'activity',
      name: id,
      status: 'Completed',
      events: [],
    })),
    edges: ids
      .slice(1)
      .map((id, i) => ({ id: `${ids[i]}->${id}`, source: ids[i], target: id })),
  };
}

/** Groups nested in each other, the first one outermost. */
function nested(...members: string[][]): WorkflowEventGroup[] {
  return members.map((nodeIds, i) => ({
    key: `label:g${i}`,
    kind: 'label',
    id: `g${i}`,
    name: `g${i}`,
    nodeIds,
    children: i + 1 < members.length ? [`label:g${i + 1}`] : [],
    ...(i > 0 ? { parent: `label:g${i - 1}` } : {}),
    status: 'Completed',
  }));
}

function layOut(
  graph: { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] },
  groups: WorkflowEventGroup[],
  width?: number,
) {
  return layoutGroupedSteps(
    graph.nodes.map(n => ({ id: n.id, size: stepSize(n) })),
    graph.edges,
    groups,
    {},
    width,
  );
}

type Rect = { left: number; top: number; right: number; bottom: number };

function rectOf(result: GroupedLayout, id: string): Rect {
  const p = result.layout.positions.get(id)!;
  const size = boxSize(result.layout, id);
  return {
    left: p.x,
    top: p.y,
    right: p.x + size.width,
    bottom: p.y + size.height,
  };
}

/** The arrows as the graph draws them, with the corners of each. */
function arrows(result: GroupedLayout) {
  const parentOf = new Map<string, string | undefined>([
    ...result.graph.frames.map(f => [f.id, f.parent] as const),
    ...result.graph.nodes.map(n => [n.id, n.parent] as const),
  ]);
  const edges: Edge<FrameEdgeData>[] = result.graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'frameEdge',
    data: frameInsets(result.layout, parentOf, e.source, e.target),
  }));
  return (routeRowGaps(result.layout, edges) as Edge<FrameEdgeData>[]).map(
    edge => {
      const s = rectOf(result, edge.source);
      const t = rectOf(result, edge.target);
      const source = { x: s.right, y: (s.top + s.bottom) / 2 };
      const target = { x: t.left, y: (t.top + t.bottom) / 2 };
      const path = frameEdgePath(
        {
          sourceX: source.x,
          sourceY: source.y,
          targetX: target.x,
          targetY: target.y,
        },
        edge.data,
      );
      return {
        edge,
        points: frameEdgePoints(source, target, edge.data!),
        // The path as drawn, through the corners of its bends.
        drawn: [...path.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m => ({
          x: Number(m[1]),
          y: Number(m[2]),
        })),
        source,
        target,
      };
    },
  );
}

type Segment = [Point, Point];
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((p, i) => [points[i], p]);
const vertical = ([a, b]: Segment) => a.x === b.x;
const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
const overlaps = ([a1, a2]: number[], [b1, b2]: number[]) => a1 < b2 && b1 < a2;

/**
 * Arrows of different sources and targets with parts on top of each other
 * (down or up, or across), in any gap, as they are drawn.
 */
function runningOn(list: { edge: Edge; drawn: Point[] }[]) {
  const found: string[] = [];
  const parts = list.map(({ edge, drawn }) => ({
    edge,
    parts: segments(drawn).filter(
      ([a, b]) => Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
    ),
  }));
  parts.forEach((a, i) => {
    for (const b of parts.slice(i + 1)) {
      if (a.edge.source === b.edge.source || a.edge.target === b.edge.target) {
        continue;
      }
      for (const p of a.parts) {
        for (const q of b.parts) {
          const down = Math.abs(p[0].x - p[1].x) < 0.01;
          if (down !== Math.abs(q[0].x - q[1].x) < 0.01) continue;
          if (!down && Math.abs(p[0].y - p[1].y) >= 0.01) continue;
          const [along, across] = down
            ? (['y', 'x'] as const)
            : (['x', 'y'] as const);
          const [a1, a2] = span(p[0][along], p[1][along]);
          const [b1, b2] = span(q[0][along], q[1][along]);
          if (
            Math.abs(p[0][across] - q[0][across]) < 1 &&
            Math.min(a2, b2) - Math.max(a1, b1) > 1
          ) {
            found.push(
              `${a.edge.id} runs on ${b.edge.id} at ${across} ${p[0][across]}`,
            );
          }
        }
      }
    }
  });
  return [...new Set(found)];
}

/** Corners of arrows outside the width of the graph. */
function outside(list: { edge: Edge; points: Point[] }[], width: number) {
  return list.flatMap(({ edge, points }) =>
    points
      .filter(p => p.x < 0 || p.x > width)
      .map(p => `${edge.id} at x ${p.x}`),
  );
}

/** The four borders of a frame. */
function borders(r: Rect): Segment[] {
  const tl = { x: r.left, y: r.top };
  const tr = { x: r.right, y: r.top };
  const bl = { x: r.left, y: r.bottom };
  const br = { x: r.right, y: r.bottom };
  return [
    [tl, bl],
    [tr, br],
    [tl, tr],
    [bl, br],
  ];
}

/**
 * Every part of an arrow that runs along a frame border is at least
 * `CLEAR` from it; returns the problems found.
 */
function problems(result: GroupedLayout) {
  const found: string[] = [];
  for (const { edge, points } of arrows(result)) {
    if (!edge.data?.sourceInset && !edge.data?.targetInset) continue;
    for (const seg of segments(points)) {
      for (const frame of result.graph.frames) {
        for (const line of borders(rectOf(result, frame.id))) {
          if (vertical(seg) !== vertical(line)) continue;
          const axis = vertical(seg) ? 'y' : 'x';
          const across = vertical(seg) ? 'x' : 'y';
          if (
            !overlaps(
              span(seg[0][axis], seg[1][axis]),
              span(line[0][axis], line[1][axis]),
            )
          ) {
            continue;
          }
          const distance = Math.abs(seg[0][across] - line[0][across]);
          if (distance < CLEAR) {
            found.push(`${edge.id} ${distance}px from ${frame.id}`);
          }
        }
      }
    }
  }
  return found;
}

const depths = [
  { name: 'one frame', groups: nested(['a3', 'a4', 'a5']) },
  {
    name: 'two frames',
    groups: nested(['a3', 'a4', 'a5', 'a6'], ['a3', 'a4']),
  },
  {
    name: 'three frames',
    groups: nested(['a3', 'a4', 'a5', 'a6', 'a7'], ['a3', 'a4', 'a5'], ['a3']),
  },
];

describe('arrows into and out of frames', () => {
  it.each(depths)(
    'keep clear of the borders of $name, in one row',
    ({ groups }) => {
      const result = layOut(chain(9), groups);
      expect(result.layout.wrapped).toBe(false);
      expect(result.graph.frames).toHaveLength(groups.length);
      expect(problems(result)).toEqual([]);
      // In one row the arrows are straight across the borders.
      const framed = arrows(result).filter(
        ({ edge }) => edge.data?.sourceInset || edge.data?.targetInset,
      );
      expect(framed.length).toBeGreaterThan(0);
      for (const { points } of framed) expect(points).toHaveLength(2);
    },
  );

  it.each(depths)(
    'keep clear of the borders of $name, into the next row',
    ({ groups }) => {
      let across = 0;
      for (const width of [700, 900, 1100, 1300, 1500]) {
        const result = layOut(chain(9), groups, width);
        expect(problems(result)).toEqual([]);
        across += arrows(result).filter(
          ({ edge }) =>
            edge.data?.centerY !== undefined &&
            (edge.data.sourceInset || edge.data.targetInset),
        ).length;
      }
      // Some of the widths put a frame at the start or the end of a row.
      expect(across).toBeGreaterThan(0);
    },
  );

  it('go around the frames into the next row and straight into the step', () => {
    const groups = nested(['a3', 'a4'], ['a3']);
    // Wide enough for start, a1 and a2 in the first row only.
    const result = layOut(chain(4), groups, 900);
    expect(result.layout.wrapped).toBe(true);
    const into = arrows(result).find(a => a.edge.target === 'a3')!;
    expect(into.edge.data!.centerY).toBeDefined();
    const outer = rectOf(result, 'group:label:g0');
    const inner = rectOf(result, 'group:label:g1');
    const last = into.points[into.points.length - 2];
    // The last turn is outside the outer frame, then a straight line
    // through both borders into the step.
    expect(outer.left - last.x).toBeGreaterThanOrEqual(CLEAR);
    expect(last.y).toBe(into.target.y);
    expect(inner.left).toBeGreaterThan(last.x);
    expect(into.points[into.points.length - 1]).toEqual(into.target);
  });

  it('turn once between the frames of steps in parallel', () => {
    // start → a1 → a2 → end and start → a3 → end, a frame each.
    const { nodes } = chain(3);
    const edges: WorkflowGraphEdge[] = [
      { id: '1', source: 'start', target: 'a1' },
      { id: '2', source: 'a1', target: 'a2' },
      { id: '3', source: 'a2', target: 'end' },
      { id: '4', source: 'start', target: 'a3' },
      { id: '5', source: 'a3', target: 'end' },
    ];
    const groups = [
      nested(['a1', 'a2'])[0],
      { ...nested(['a3'])[0], key: 'label:h', id: 'h', name: 'h' },
    ];
    const result = layOut({ nodes, edges }, groups);
    expect(result.graph.frames).toHaveLength(2);
    expect(problems(result)).toEqual([]);
    const bent = arrows(result).filter(a => a.points.length === 4);
    expect(bent.length).toBeGreaterThan(0);
  });

  it.each([
    ['a loop with a signal', loopGraph, {}],
    [
      'an agent with two rounds open',
      agentGraph,
      { 'label:loop:agent:1': true, 'label:loop:agent:2': true },
    ],
    ['groups in parallel', parallelGraph, {}],
  ] as const)(
    'keep clear of the borders in the run of %s',
    (_, graph, views) => {
      for (const width of [undefined, 1400, 1000, 800]) {
        const visible = visibleSteps(graph.nodes, graph.edges);
        const result = layoutGroupedSteps(
          visible.nodes.map(n => ({ id: n.id, size: stepSize(n) })),
          visible.edges,
          graph.eventGroups ?? [],
          views,
          width,
        );
        expect({ width, problems: problems(result) }).toEqual({
          width,
          problems: [],
        });
        // Every arrow ends going right, into the left side of its target.
        for (const { edge, points } of arrows(result)) {
          if (!edge.data?.sourceInset && !edge.data?.targetInset) continue;
          const [a, b] = points.slice(-2);
          expect(a.y).toBe(b.y);
          expect(a.x).toBeLessThan(b.x);
        }
      }
    },
  );

  it('cross each border at a right angle', () => {
    const result = layOut(chain(9), depths[2].groups);
    for (const { edge, points } of arrows(result)) {
      if (!edge.data?.sourceInset && !edge.data?.targetInset) continue;
      for (const seg of segments(points)) {
        for (const frame of result.graph.frames) {
          for (const line of borders(rectOf(result, frame.id))) {
            if (vertical(seg) !== vertical(line)) continue;
            // Parallel: never on the border itself.
            const across = vertical(seg) ? 'x' : 'y';
            expect(seg[0][across]).not.toBe(line[0][across]);
          }
        }
      }
    }
  });

  it('leave arrows between the steps of one frame as they were', () => {
    const result = layOut(chain(9), depths[0].groups);
    const inside = arrows(result).find(a => a.edge.id === 'a3->a4')!;
    expect(inside.edge.data).toEqual({ sourceInset: 0, targetInset: 0 });
    const ends = {
      sourceX: 10,
      sourceY: 40,
      targetX: 300,
      targetY: 120,
    };
    const smooth = (centerY?: number) =>
      getSmoothStepPath({
        ...ends,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        centerY,
      })[0];
    expect(frameEdgePath(ends, inside.edge.data!)).toBe(smooth());
    expect(frameEdgePath(ends, { ...inside.edge.data!, centerY: 80 })).toBe(
      smooth(80),
    );
  });
});

/** Arrows that run through a box other than their two ends. */
function throughBoxes(result: GroupedLayout) {
  const found: string[] = [];
  const boxes = result.graph.nodes.map(n => ({
    id: n.id,
    ...rectOf(result, n.id),
  }));
  for (const { edge, drawn } of arrows(result)) {
    for (const [a, b] of segments(drawn)) {
      const [x1, x2] = span(a.x, b.x);
      const [y1, y2] = span(a.y, b.y);
      for (const box of boxes) {
        if (box.id === edge.source || box.id === edge.target) continue;
        if (
          x1 < box.right - 0.5 &&
          x2 > box.left + 0.5 &&
          y1 < box.bottom - 0.5 &&
          y2 > box.top + 0.5
        ) {
          found.push(`${edge.id} through ${box.id}`);
        }
      }
    }
  }
  return [...new Set(found)];
}

/**
 * The arrows that run along the side of a box, 1px from it or on it, other
 * than their ends, without running through it.
 */
function alongBoxes(result: GroupedLayout) {
  const found: string[] = [];
  const boxes = result.graph.nodes.map(n => ({
    id: n.id,
    ...rectOf(result, n.id),
  }));
  for (const { edge, drawn } of arrows(result)) {
    for (const [a, b] of segments(drawn)) {
      const [x1, x2] = span(a.x, b.x);
      const [y1, y2] = span(a.y, b.y);
      for (const box of boxes) {
        if (box.id === edge.source || box.id === edge.target) continue;
        const near =
          x1 <= box.right + 1 &&
          x2 >= box.left - 1 &&
          y1 <= box.bottom + 1 &&
          y2 >= box.top - 1;
        const through =
          x1 < box.right - 0.5 &&
          x2 > box.left + 0.5 &&
          y1 < box.bottom - 0.5 &&
          y2 > box.top + 0.5;
        if (near && !through) found.push(`${edge.id} along ${box.id}`);
      }
    }
  }
  return [...new Set(found)];
}

describe('arrows and the boxes on their way', () => {
  it.each([
    ['a loop with a signal', loopGraph],
    ['groups in parallel', parallelGraph],
  ] as const)('never run through other boxes in the run of %s', (_, graph) => {
    for (const width of [undefined, 1400, 1000, 800]) {
      const visible = visibleSteps(graph.nodes, graph.edges);
      const result = layoutGroupedSteps(
        visible.nodes.map(n => ({ id: n.id, size: stepSize(n) })),
        visible.edges,
        graph.eventGroups ?? [],
        {},
        width,
      );
      expect({ width, through: throughBoxes(result) }).toEqual({
        width,
        through: [],
      });
    }
  });

  it.each([
    ['into', ['b', 'a3']],
    ['out of', ['a1', 'b']],
  ] as const)(
    'never run through other boxes %s a frame above or below the other end',
    (_, [from, to]) => {
      // A frame around a1 to a3, and a step b next to it in parallel.
      const { nodes, edges } = chain(3);
      const extra: WorkflowGraphEdge[] = [
        { id: 'start->b', source: 'start', target: 'b' },
        { id: `${from}->${to}`, source: from, target: to },
      ];
      if (to === 'b') extra.push({ id: 'b->end', source: 'b', target: 'end' });
      const result = layOut(
        {
          nodes: [...nodes, { ...nodes[1], id: 'b', name: 'b' }],
          edges: [...edges, ...extra],
        },
        nested(['a1', 'a2', 'a3']),
      );
      expect(result.graph.frames).toHaveLength(1);
      expect(throughBoxes(result)).toEqual([]);
    },
  );

  it('never run through a step next to them in a frame, into the next row', () => {
    // a1 is in the first column of g0 and leaves it for a6 in the next row:
    // a2, next to it in g0, is in the way to the right of the frame.
    const ids = ['start', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'end'];
    const nodes = chain(7).nodes.filter(n => ids.includes(n.id));
    const pairs = [
      ['start', 'a1'],
      ['a1', 'a2'],
      ['a1', 'a3'],
      ['a3', 'a4'],
      ['a2', 'a4'],
      ['a4', 'a5'],
      ['a5', 'a6'],
      ['a1', 'a6'],
      ['start', 'a7'],
      ['a7', 'end'],
    ];
    const edges = pairs.map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
    }));
    const result = layOut({ nodes, edges }, nested(['a1', 'a2'], ['a1']), 1400);
    expect(result.layout.wrapped).toBe(true);
    expect(
      arrows(result).some(
        a => a.edge.id === 'a1->a6' && a.edge.data?.centerY !== undefined,
      ),
    ).toBe(true);
    expect(throughBoxes(result)).toEqual([]);
    expect(problems(result)).toEqual([]);
  });
});

describe('columns next to frames', () => {
  it.each(depths)(
    'keep a step outside $name a column gap from the border',
    ({ groups }) => {
      const result = layOut(chain(9), groups);
      const outer = rectOf(result, 'group:label:g0');
      expect(outer.left - rectOf(result, 'a2').right).toBe(COLUMN);
      const after = groups[0].nodeIds[groups[0].nodeIds.length - 1];
      const next = `a${Number(after.slice(1)) + 1}`;
      expect(rectOf(result, next).left - outer.right).toBe(COLUMN);
    },
  );

  it('keep two frames next to each other a column gap apart', () => {
    const groups = [
      nested(['a2', 'a3'])[0],
      { ...nested(['a4'])[0], key: 'label:h', id: 'h', name: 'h' },
    ];
    const result = layOut(chain(5), groups);
    expect(
      rectOf(result, 'group:label:h').left -
        rectOf(result, 'group:label:g0').right,
    ).toBe(COLUMN);
  });
});

describe('arrows that share the gap between two rows', () => {
  it('run on one line in the gap, clear of the rows', () => {
    // Two frames in parallel at the end of the first row, both into a step
    // that starts the next one.
    const { nodes } = chain(4);
    const edges: WorkflowGraphEdge[] = [
      { id: '1', source: 'start', target: 'a1' },
      { id: '2', source: 'start', target: 'a2' },
      { id: '3', source: 'a1', target: 'a3' },
      { id: '4', source: 'a2', target: 'a3' },
      { id: '5', source: 'a3', target: 'a4' },
      { id: '6', source: 'a4', target: 'end' },
    ];
    const groups = [
      nested(['a1'])[0],
      { ...nested(['a2'])[0], key: 'label:h', id: 'h', name: 'h' },
    ];
    const result = layOut({ nodes, edges }, groups, 700);
    expect(result.layout.wrapped).toBe(true);
    const shared = arrows(result).filter(a => a.edge.target === 'a3');
    expect(shared).toHaveLength(2);
    const ys = shared.map(a => a.edge.data!.centerY!);
    expect(ys[0]).toBe(ys[1]);
    expect(problems(result)).toEqual([]);
    // Both stay CLEAR of the boxes of the rows above and below.
    const gap = result.layout.rowGaps![0];
    const boxes = [...result.layout.positions.keys()].map(id =>
      rectOf(result, id),
    );
    const above = Math.max(
      ...boxes.filter(r => r.bottom < gap).map(r => r.bottom),
    );
    const below = Math.min(...boxes.filter(r => r.top > gap).map(r => r.top));
    expect(Math.min(...ys) - above).toBeGreaterThanOrEqual(CLEAR);
    expect(below - Math.max(...ys)).toBeGreaterThanOrEqual(CLEAR);
  });

  it('keep to the gap of their own frame where two frames have gaps at one y', () => {
    // Two loops of the same shape one after the other, both rounds of each
    // open: the gaps between the rounds of the two loops are at one y, and
    // the arrow between the rounds of each loop runs alone in its gap.
    const group = (
      key: string,
      nodeIds: string[],
      parent?: string,
    ): WorkflowEventGroup => ({
      key,
      kind: 'label',
      id: key,
      name: key,
      nodeIds,
      children: [],
      status: 'Completed',
      ...(parent ? { parent } : {}),
    });
    const ids = ['start'];
    const edges: WorkflowGraphEdge[] = [];
    const groups: WorkflowEventGroup[] = [];
    const views: GroupViews = {};
    for (const loop of ['a', 'b']) {
      const frame = group(`label:${loop}`, []);
      groups.push(frame);
      for (const round of [1, 2]) {
        const key = `label:${loop}${round}`;
        const steps = [`${loop}${round}x`, `${loop}${round}y`];
        groups.push(group(key, steps, frame.key));
        frame.children.push(key);
        frame.nodeIds.push(...steps);
        views[key] = true;
        for (const id of steps) {
          edges.push({
            id: `${ids[ids.length - 1]}->${id}`,
            source: ids[ids.length - 1],
            target: id,
          });
          ids.push(id);
        }
      }
    }
    edges.push({
      id: `${ids[ids.length - 1]}->end`,
      source: ids[ids.length - 1],
      target: 'end',
    });
    ids.push('end');
    const result = layoutGroupedSteps(
      ids.map(id => ({ id })),
      edges,
      groups,
      views,
    );
    const gaps = [...(result.layout.stackGaps ?? new Map()).values()];
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toHaveLength(1);
    expect(gaps[1]).toEqual(gaps[0]);
    const across = arrows(result).filter(
      a => a.edge.data?.centerY !== undefined,
    );
    expect(across.map(a => [a.edge.id, a.edge.data!.centerY])).toEqual([
      ['a1y->a2x', gaps[0][0]],
      ['b1y->b2x', gaps[0][0]],
    ]);
  });

  /**
   * `count` arrows into the next row from sources one above the other at
   * the end of a row, each into a target one above the other at the start
   * of the next row, all turning `FRAME_GAP` outside frames at the sides.
   */
  function stacked(count: number) {
    const width = 928;
    const positions = new Map<string, { x: number; y: number }>();
    const edges: Edge<FrameEdgeData>[] = [];
    for (let i = 0; i < count; i++) {
      positions.set(`s${i}`, { x: width - 280, y: 40 + 90 * i });
      positions.set(`t${i}`, { x: 48, y: 500 + 90 * i });
      edges.push({
        id: `s${i}->t${i}`,
        source: `s${i}`,
        target: `t${i}`,
        type: 'frameEdge',
        // The turns are 16 from the sides of the graph.
        data: { sourceInset: 44, targetInset: 32 },
      });
    }
    const layout = { positions, width, height: 900, wrapped: true };
    return { layout: { ...layout, rowGaps: [460] }, edges };
  }

  /** The arrows routed in the gap, with their corners. */
  function routed(layout: StepGraphLayout, edges: Edge<FrameEdgeData>[]) {
    return (routeRowGaps(layout, edges) as Edge<FrameEdgeData>[]).map(edge => {
      const end = (id: string, side: 'left' | 'right') => {
        const p = layout.positions.get(id)!;
        const size = boxSize(layout, id);
        return {
          x: side === 'left' ? p.x : p.x + size.width,
          y: p.y + size.height / 2,
        };
      };
      return {
        edge,
        points: frameEdgePoints(
          end(edge.source, 'right'),
          end(edge.target, 'left'),
          edge.data!,
        ),
      };
    });
  }

  it('leaves the turns of an arrow without frames where a smooth step has them', () => {
    // s0 leaves no frame; it turns where the arrow out of the frame of s1
    // turns.
    const { layout, edges } = stacked(2);
    const p = layout.positions.get('s0')!;
    layout.positions.set('s0', { x: p.x + 24, y: p.y });
    const plain = { ...edges[0], data: { sourceInset: 0, targetInset: 0 } };
    const result = routed(layout, [plain, edges[1]]);
    expect(result[0].points[1].x).toBe(result[1].points[1].x);
    const data = result[0].edge.data!;
    expect([data.sourceInset, data.targetInset]).toEqual([0, 0]);
  });

  it('leaves the arrows of a graph without frames as they were', () => {
    const layout = {
      positions: new Map([
        ['a', { x: 16, y: 16 }],
        ['b', { x: 16, y: 120 }],
        ['c', { x: 300, y: 16 }],
      ]),
      width: 600,
      height: 200,
      wrapped: true,
      rowGaps: [100],
    };
    const edges: Edge[] = [
      { id: 'c-b', source: 'c', target: 'b', type: 'smoothstep' },
      { id: 'a-b', source: 'a', target: 'b', type: 'smoothstep' },
    ];
    expect(routeRowGaps(layout, edges).map(e => [e.type, e.data])).toEqual([
      ['rowGap', { centerY: 100 }],
      ['rowGap', { centerY: 100 }],
    ]);
  });
});

/** Numbers from 0 to 1 that follow from `seed`. */
function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * The steps of a random graph, after the arrows: sizes of steps, model
 * calls and tool calls, and up to three groups of steps next to each other.
 */
function randomSteps(random: () => number, ids: string[]) {
  const groups: WorkflowEventGroup[] = [];
  const groupCount = 1 + Math.floor(random() * 3);
  for (let g = 0; g < groupCount; g++) {
    const first = Math.floor(random() * ids.length);
    const length = 1 + Math.floor(random() * 4);
    groups.push({
      ...nested([])[0],
      key: `label:g${g}`,
      id: `g${g}`,
      name: `g${g}`,
      nodeIds: ids.slice(first, Math.min(ids.length, first + length)),
    });
  }
  const size = (width: number, height: number): NodeSize => ({ width, height });
  // A size each: dagre writes the place of a box into it.
  const nodes = ids.map(id => {
    if (random() < 0.15) return { id, size: size(240, 86) };
    return { id, size: random() < 0.1 ? size(180, 52) : size(220, 64) };
  });
  return { nodes, groups };
}

/**
 * A random run: steps that run over random spans of time, each one after
 * the steps that ended last before it started (as a run is drawn).
 */
function randomRun(seed: number) {
  const random = randomFrom(seed);
  const count = 8 + Math.floor(random() * 14);
  const ids = Array.from({ length: count }, (_, i) => `n${i}`);
  const spans = ids
    .map(() => {
      const first = Math.floor(random() * 100);
      const length = Math.floor(random() * (random() < 0.3 ? 40 : 12));
      return { first, last: first + 1 + length };
    })
    .sort((a, b) => a.first - b.first)
    .map((time, i) => ({ id: `n${i}`, ...time }));
  const edges: WorkflowGraphEdge[] = [];
  for (const step of spans) {
    const before = spans.filter(o => o.last < step.first);
    const latest = Math.max(-Infinity, ...before.map(o => o.first));
    for (const o of before) {
      if (o.last >= latest) {
        edges.push({
          id: `${o.id}->${step.id}`,
          source: o.id,
          target: step.id,
        });
      }
    }
  }
  return { edges, ...randomSteps(random, ids) };
}

/**
 * A random graph: each step after one or two earlier steps, some after
 * the step two before it.
 */
function randomGraph(seed: number) {
  const random = randomFrom(seed);
  const count = 8 + Math.floor(random() * 14);
  const ids = Array.from({ length: count }, (_, i) => `n${i}`);
  const pairs = new Set<string>();
  for (let i = 1; i < count; i++) {
    const before = 1 + (random() < 0.35 ? 1 : 0);
    for (let j = 0; j < before; j++) {
      pairs.add(`n${Math.floor(random() * i)} n${i}`);
    }
    if (random() < 0.3 && i > 2) pairs.add(`n${i - 2} n${i}`);
  }
  const edges: WorkflowGraphEdge[] = [...pairs].map(pair => {
    const [source, target] = pair.split(' ');
    return { id: `${source}->${target}`, source, target };
  });
  return { edges, ...randomSteps(random, ids) };
}

/**
 * A random loop: rounds of steps one after the other, some with two or three
 * groups of tool calls in parallel in them, steps between some rounds, and
 * one or two signals received during one round, each of which starts a
 * group that leads back into the round. Some of the rounds and tool groups
 * are open, at least one round: the frames of the loop and of those rounds
 * stack their groups.
 */
/**
 * A random run with a loop. With `more`, a round can receive one to three
 * signals, from any of its steps but the last, and some of them lead
 * nowhere after their steps.
 */
function randomLoop(seed: number, more = false) {
  const random = randomFrom(seed);
  const pick = (n: number) => Math.floor(random() * n);
  const ids: string[] = [];
  const edges: WorkflowGraphEdge[] = [];
  const groups: WorkflowEventGroup[] = [];
  const signals = new Set<string>();
  const step = () => {
    ids.push(`n${ids.length}`);
    return ids[ids.length - 1];
  };
  const link = (source: string, target: string) =>
    edges.push({ id: `${source}->${target}`, source, target });
  const group = (key: string, parent?: string): WorkflowEventGroup => {
    const made: WorkflowEventGroup = {
      ...nested([])[0],
      key,
      id: key,
      name: key,
      nodeIds: [],
      children: [],
      ...(parent ? { parent } : {}),
    };
    groups.push(made);
    if (parent) groups.find(g => g.key === parent)!.children.push(key);
    return made;
  };
  /** Steps one after the other from `from`, into `into`; the last one. */
  const run = (from: string, count: number, into: WorkflowEventGroup[]) => {
    let last = from;
    for (let i = 0; i < count; i++) {
      const next = step();
      link(last, next);
      for (const g of into) g.nodeIds.push(next);
      last = next;
    }
    return last;
  };
  let last = run(step(), pick(2), []);
  const loop = group('label:loop');
  const rounds = 2 + pick(3);
  let signalled = false;
  for (let r = 1; r <= rounds; r++) {
    if (r > 1 && random() < 0.2) last = run(last, 1, [loop]);
    const round = group(`label:loop:${r}`, loop.key);
    const first = run(last, 1, [loop, round]);
    if (random() < 0.5) {
      const ends = Array.from({ length: 2 + pick(2) }, (_, t) => {
        const tool = group(`label:tool:${r}:${t}`, round.key);
        return run(first, 1 + pick(2), [loop, round, tool]);
      });
      last = step();
      for (const end of ends) link(end, last);
      loop.nodeIds.push(last);
      round.nodeIds.push(last);
    } else {
      last = run(first, 1 + pick(3), [loop, round]);
      if (random() < 0.25) {
        const aside = run(first, 1, [loop, round]);
        link(aside, last);
      }
    }
    if (!signalled && random() < 0.5) {
      signalled = true;
      // One signal, from the first step; or two, the other one from any
      // step of the round but the last.
      const back = last;
      const anchors = [first];
      const others = round.nodeIds.filter(id => id !== back);
      if (more) {
        for (let k = pick(3); k > 0; k--) {
          anchors.push(others[pick(others.length)]);
        }
      } else if (random() < 0.4) {
        anchors.push(others[pick(others.length)]);
      }
      anchors.forEach((anchor, k) => {
        const signal = step();
        signals.add(signal);
        link(anchor, signal);
        const hint: WorkflowEventGroup = {
          ...group(`event:hint${k}`),
          kind: 'event',
          sourceNodeId: signal,
        };
        groups[groups.length - 1] = hint;
        const end = run(signal, 1 + pick(2), [hint]);
        if (!more || random() < 0.7) link(end, back);
      });
    }
  }
  run(last, 1 + pick(3), []);
  const views: GroupViews = {};
  for (const g of groups) if (g.parent) views[g.key] = random() < 0.5;
  const rounds1 = loop.children;
  if (!rounds1.some(k => views[k])) views[rounds1[pick(rounds1.length)]] = true;
  // Model calls, tool calls and other steps.
  const sizeOf = (roll: number): NodeSize => {
    if (roll < 0.15) return { width: 240, height: 86 };
    if (roll < 0.25) return { width: 180, height: 52 };
    return { width: 220, height: 64 };
  };
  const nodes = ids.map(id => ({
    id,
    size: sizeOf(random()),
    ...(signals.has(id) ? { framable: true } : {}),
  }));
  // The groups in the order they started.
  const at = (g: WorkflowEventGroup) =>
    Math.min(...g.nodeIds.map(id => ids.indexOf(id)));
  groups.sort((a, b) => at(a) - at(b));
  return { nodes, edges, groups, views };
}

function layOutRun(
  run: ReturnType<typeof randomRun | typeof randomGraph>,
  width?: number,
  lineUpRows?: boolean,
) {
  return layoutGroupedSteps(
    run.nodes,
    run.edges,
    run.groups,
    {},
    width,
    (n, e, w, options) => layoutGraph(n, e, w, { ...options, lineUpRows }),
  );
}

/**
 * Turns of arrows spread out next to other arrows that come closer than
 * `CLEAR` to the border of a frame, or half of it to the side of a box, in
 * the part of the arrow that moved.
 */
function spreadTooClose(result: GroupedLayout) {
  const parentOf = new Map<string, string | undefined>([
    ...result.graph.frames.map(f => [f.id, f.parent] as const),
    ...result.graph.nodes.map(n => [n.id, n.parent] as const),
  ]);
  const frames = new Set(result.graph.frames.map(f => f.id));
  const found: string[] = [];
  for (const { edge, points } of arrows(result)) {
    if (edge.data?.centerY === undefined) continue;
    const given = frameInsets(
      result.layout,
      parentOf,
      edge.source,
      edge.target,
    );
    const moved: Segment[] = [];
    if ((edge.data.sourceInset ?? 0) !== given.sourceInset) {
      moved.push([points[1], points[2]]);
    }
    if ((edge.data.targetInset ?? 0) !== given.targetInset) {
      moved.push([points[3], points[4]]);
    }
    for (const [a, b] of moved) {
      const [y1, y2] = span(a.y, b.y);
      for (const id of result.layout.positions.keys()) {
        if (id === edge.source || id === edge.target) continue;
        const r = rectOf(result, id);
        if (r.bottom <= y1 || r.top >= y2) continue;
        const clear = frames.has(id) ? CLEAR : CLEAR / 2;
        const distance = Math.min(
          Math.abs(a.x - r.left),
          Math.abs(a.x - r.right),
        );
        if (
          distance < clear ||
          (!frames.has(id) && a.x > r.left && a.x < r.right)
        ) {
          found.push(`${edge.id} ${distance}px from ${id}`);
        }
      }
    }
  }
  return found;
}

describe('random runs', () => {
  it.each([
    [641, 1100],
    [40, 700],
    [40, 900],
    [334, 1100],
  ])(
    'keep turns spread out in a row clear of the frames and boxes next to them (run %i, width %i)',
    (seed, width) => {
      const result = layOutRun(randomRun(seed), width);
      expect(result.layout.wrapped).toBe(true);
      expect(spreadTooClose(result)).toEqual([]);
    },
  );

  it.each([
    ['run', 5525, undefined, randomRun],
    ['run', 5525, 900, randomRun],
    ['run', 5525, 1100, randomRun],
    ['graph', 2204, 700, randomGraph],
  ] as const)(
    'never line up a row onto an arrow as it is drawn (%s %i, width %s)',
    (_, seed, width, random) => {
      // Lined up, an arrow would run through a box (run 5525); the turns
      // of an arrow into the next row, out of a frame and into one, depend
      // on the boxes next to it (graph 2204).
      const run = random(seed);
      const before = throughBoxes(layOutRun(run, width, false));
      const after = throughBoxes(layOutRun(run, width));
      expect(after.filter(hit => !before.includes(hit))).toEqual([]);
    },
  );

  it.each([
    [20386, 700],
    [20403, 700],
    [20403, 900],
    [20403, 1100],
  ])(
    'never line up a row onto the side of a box (graph %i, width %i)',
    (seed, width) => {
      // Lined up, an arrow into the next row would run down along the side
      // of a box.
      const run = randomGraph(seed);
      const before = alongBoxes(layOutRun(run, width, false));
      const after = alongBoxes(layOutRun(run, width));
      expect(after.filter(hit => !before.includes(hit))).toEqual([]);
    },
  );

  it.each([
    ['runs', randomRun],
    ['graphs', randomGraph],
  ] as const)(
    'run no more arrows through boxes because of lined up rows, nor spread turns too close, than known in random %s',
    (name, random) => {
      const found: string[] = [];
      const preexisting: string[] = [];
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const run = random(seed);
        for (const width of [undefined, 1100]) {
          const result = layOutRun(run, width);
          const beforeHits = throughBoxes(layOutRun(run, width, false));
          for (const hit of beforeHits) {
            preexisting.push(`${seed} at ${width}: ${hit}`);
          }
          const before = new Set(beforeHits);
          for (const hit of throughBoxes(result)) {
            if (!before.has(hit)) found.push(`${seed} at ${width}: ${hit}`);
          }
          for (const close of spreadTooClose(result)) {
            found.push(`${seed} at ${width}: ${close}`);
          }
        }
      }
      expect(found.length).toBeLessThanOrEqual(KNOWN_PROBLEMS[name]);
      expect(preexisting.length).toBeLessThanOrEqual(
        KNOWN_PREEXISTING_THROUGH_BOXES[name],
      );
    },
    60_000,
  );
});

describe('random loops with their child groups stacked', () => {
  it.each([
    ['one or two signals', false],
    ['one to three signals, some leading nowhere', true],
  ] as const)(
    'keep the boxes apart and the arrows clear of boxes and frames as often as known, with %s',
    (name, more) => {
      const found: string[] = [];
      let stacked = 0;
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const run = randomLoop(seed, more);
        for (const width of [undefined, 1000]) {
          const result = layoutGroupedSteps(
            run.nodes,
            run.edges,
            run.groups,
            run.views,
            width,
          );
          const at = `${seed} at ${width}`;
          if (result.graph.frames.some(f => f.stacked)) stacked++;
          const boxes = result.graph.nodes.map(n => rectOf(result, n.id));
          boxes.forEach((a, i) => {
            for (const b of boxes.slice(i + 1)) {
              if (
                a.left < b.right &&
                b.left < a.right &&
                a.top < b.bottom &&
                b.top < a.bottom
              ) {
                found.push(`${at}: boxes overlap`);
              }
            }
          });
          if (result.notice) found.push(`${at}: ${result.notice}`);
          const list = arrows(result);
          for (const hit of throughBoxes(result)) found.push(`${at}: ${hit}`);
          for (const hit of problems(result)) found.push(`${at}: ${hit}`);
          for (const hit of spreadTooClose(result)) found.push(`${at}: ${hit}`);
          for (const hit of outside(list, result.layout.width)) {
            found.push(`${at}: ${hit}`);
          }
          for (const hit of runningOn(list)) found.push(`${at}: ${hit}`);
        }
      }
      expect(found.length).toBeLessThanOrEqual(KNOWN_PROBLEMS[name]);
      expect(stacked).toBe(2 * SEEDS);
    },
    120_000,
  );
});

describe('rows of frames lined up', () => {
  function graphOf(pairs: string[][]) {
    const ids = [...new Set(pairs.flat())];
    return {
      nodes: ids.map(
        (id): WorkflowGraphNode => ({
          id,
          kind: 'activity',
          name: id,
          status: 'Completed',
          events: [],
        }),
      ),
      edges: pairs.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
    };
  }

  it.each([
    [
      'a → t passes the frame of a and b',
      [
        ['s', 'a'],
        ['a', 'b'],
        ['a', 't'],
        ['s', 'c'],
        ['c', 'd'],
        ['d', 't'],
        ['b', 'e'],
      ],
    ],
    [
      'p → b passes a in the frame of a and b',
      [
        ['s', 'p'],
        ['s', 'a'],
        ['p', 'y'],
        ['a', 'b'],
        ['p', 'b'],
        ['a', 't'],
        ['y', 't'],
        ['b', 'end'],
        ['t', 'end'],
      ],
    ],
  ])('never move a box onto an arrow (%s)', (_, pairs) => {
    const result = layOut(graphOf(pairs), nested(['a', 'b']));
    expect(result.graph.frames).toHaveLength(1);
    expect(throughBoxes(result)).toEqual([]);
  });
});

/** The arrows in one row that are a straight line. */
function straightArrows(result: GroupedLayout) {
  return arrows(result)
    .filter(
      ({ edge, drawn }) =>
        edge.data?.centerY === undefined &&
        drawn.every(p => Math.abs(p.y - drawn[0].y) < 0.5),
    )
    .map(({ edge }) => edge.id);
}

describe('rows of frames lined up in recorded runs', () => {
  const allOpen = (graph: typeof loopGraph) =>
    Object.fromEntries((graph.eventGroups ?? []).map(g => [g.key, true]));
  it.each([
    ['a loop with a signal', loopGraph, true],
    ['an agent', agentGraph, false],
    ['groups in parallel', parallelGraph, true],
  ] as const)(
    'never bend a straight arrow in the run of %s',
    (_, graph, straightens) => {
      const visible = visibleSteps(graph.nodes, graph.edges);
      const nodes = visible.nodes.map(n => ({ id: n.id, size: stepSize(n) }));
      const found: string[] = [];
      let straightened = 0;
      for (const views of [{}, allOpen(graph)]) {
        for (const width of [undefined, 1400, 1000, 800]) {
          const layOutWith = (lineUpRows?: boolean) =>
            layoutGroupedSteps(
              nodes,
              visible.edges,
              graph.eventGroups ?? [],
              views,
              width,
              (n, e, w, options) =>
                layoutGraph(n, e, w, { ...options, lineUpRows }),
            );
          const before = straightArrows(layOutWith(false));
          const after = straightArrows(layOutWith());
          for (const id of before) {
            if (!after.includes(id)) found.push(`${id} at ${width}`);
          }
          straightened += after.length - before.length;
        }
      }
      expect(found).toEqual([]);
      // Rows with a step in them get straight arrows.
      expect(straightened > 0).toBe(straightens);
    },
  );
});

describe('straight arrows and side lanes in stacked loops', () => {
  function lay(seed: number, width?: number, more = false) {
    const run = randomLoop(seed, more);
    return layoutGroupedSteps(
      run.nodes,
      run.edges,
      run.groups,
      run.views,
      width,
    );
  }

  /** Parallel parts of different arrows closer than a lane, and how close. */
  function closePairs(result: GroupedLayout) {
    const found: string[] = [];
    const list = arrows(result);
    list.forEach((a, i) => {
      for (const b of list.slice(i + 1)) {
        if (
          a.edge.source === b.edge.source ||
          a.edge.target === b.edge.target
        ) {
          continue;
        }
        for (const p of segments(a.drawn)) {
          for (const q of segments(b.drawn)) {
            const down = Math.abs(p[0].x - p[1].x) < 0.01;
            if (down !== Math.abs(q[0].x - q[1].x) < 0.01) continue;
            if (!down && Math.abs(p[0].y - p[1].y) >= 0.01) continue;
            if (!down && Math.abs(q[0].y - q[1].y) >= 0.01) continue;
            const [along, side] = down
              ? (['y', 'x'] as const)
              : (['x', 'y'] as const);
            const [a1, a2] = span(p[0][along], p[1][along]);
            const [b1, b2] = span(q[0][along], q[1][along]);
            const overlap = Math.min(a2, b2) - Math.max(a1, b1);
            const d = Math.abs(p[0][side] - q[0][side]);
            if (overlap > 1 && d >= 1 && d < EDGE_LANE_GAP) {
              found.push(`${a.edge.id} ~ ${b.edge.id} ${d}`);
            }
          }
        }
      }
    });
    return found;
  }

  it.each([61217, 61285, 71173])(
    'keeps a straight arrow out of the box beside it (seed %i)',
    seed => {
      for (const width of [undefined, 900, 1400]) {
        expect(throughBoxes(lay(seed, width))).toEqual([]);
      }
    },
  );

  it('keeps the straight arrow of seed 61217 off the box beside it', () => {
    const result = lay(61217);
    const arrow = arrows(result).find(a => a.edge.id === 'n19->n20')!;
    expect(arrow.points.length).toBeGreaterThan(0);
    expect(
      arrow.points.every(p => Math.abs(p.y - arrow.points[0].y) < 0.5),
    ).toBe(true);
    const n21 = rectOf(result, 'n21');
    const y = arrow.points[0].y;
    // Clear of the box, not on its border.
    expect(y < n21.top - 1 || y > n21.bottom + 1).toBe(true);
  });

  it.each([
    [2320, 'n10->n14', 'n11'],
    [2972, 'n1->n5', 'n2'],
  ])(
    'keeps an arrow that turns in its row off the box beside it (seed %i)',
    (seed, id, beside) => {
      for (const width of [undefined, 900, 1400]) {
        const result = lay(seed, width);
        expect(throughBoxes(result)).toEqual([]);
        const arrow = arrows(result).find(a => a.edge.id === id)!;
        const box = rectOf(result, beside);
        // The parts across that pass over the box are clear of it, not on
        // its border.
        for (const [p, q] of segments(arrow.points)) {
          if (Math.abs(p.y - q.y) >= 0.01) continue;
          const [x1, x2] = span(p.x, q.x);
          if (x2 <= box.left || x1 >= box.right) continue;
          expect(p.y < box.top - 1 || p.y > box.bottom + 1).toBe(true);
        }
      }
    },
  );

  it('takes the side lane only for groups side by side, not for a frame in another (seed 2064)', () => {
    // Round 2 holds groups in groups: the frame of a group and the one in
    // it are not side by side, and the arrow past them goes down next to
    // its target, crossing no other arrow.
    for (const width of [undefined, 900, 1400]) {
      const list = arrows(lay(2064, width, true));
      const crossing: string[] = [];
      list.forEach((a, i) => {
        for (const b of list.slice(i + 1)) {
          for (const [p, q] of segments(a.drawn)) {
            for (const [u, v] of segments(b.drawn)) {
              let [h, d]: Point[][] = [];
              if (p.y === q.y && u.x === v.x) {
                [h, d] = [
                  [p, q],
                  [u, v],
                ];
              } else if (p.x === q.x && u.y === v.y) {
                [h, d] = [
                  [u, v],
                  [p, q],
                ];
              }
              if (!h || !d) continue;
              const [x1, x2] = span(h[0].x, h[1].x);
              const [y1, y2] = span(d[0].y, d[1].y);
              if (
                d[0].x > x1 + 0.5 &&
                d[0].x < x2 - 0.5 &&
                h[0].y > y1 + 0.5 &&
                h[0].y < y2 - 0.5
              ) {
                crossing.push(`${a.edge.id} ${b.edge.id}`);
              }
            }
          }
        }
      });
      expect(crossing).toEqual([]);
    }
  });

  it.each([2231, 2277])(
    'turns an arrow placed after the others a full lane from them (seed %i)',
    seed => {
      // An arrow out of a tool group turns down next to an arrow that turned
      // there first; one pixel apart is not enough.
      for (const width of [undefined, 900, 1400]) {
        expect(closePairs(lay(seed, width))).toEqual([]);
      }
    },
  );

  it('keeps the side lanes a lane apart when a signal row shares them (seed 61008)', () => {
    for (const width of [undefined, 900, 1400]) {
      const result = lay(61008, width);
      expect(closePairs(result)).toEqual([]);
      expect(throughBoxes(result)).toEqual([]);
    }
  });
});
