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
import { GroupedLayout, layoutGroupedSteps } from './eventGroups';
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
  StepLayout,
  stepSize,
  visibleSteps,
} from './layout';
import { agentGraph } from '../../testGraphs/agentGraph';
import { loopGraph } from '../../testGraphs/loopGraph';
import { parallelGraph } from '../../testGraphs/parallelGraph';

/** Space an arrow keeps from a frame border it runs along. */
const CLEAR = 20;
/** Random runs the layout is checked with. */
const SEEDS = 100;
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

/** How two parts of arrows meet: on top of each other, or across. */
function clashOf(p: Segment, q: Segment): string | undefined {
  const length = ([a, b]: Segment) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (length(p) === 0 || length(q) === 0) return undefined;
  if (vertical(p) === vertical(q)) {
    const axis = vertical(p) ? 'y' : 'x';
    const across = vertical(p) ? 'x' : 'y';
    const onTop =
      Math.abs(p[0][across] - q[0][across]) < 1 &&
      overlaps(span(p[0][axis], p[1][axis]), span(q[0][axis], q[1][axis]));
    return onTop ? 'runs on' : undefined;
  }
  const [v, h] = vertical(p) ? [p, q] : [q, p];
  const [y1, y2] = span(v[0].y, v[1].y);
  const [x1, x2] = span(h[0].x, h[1].x);
  const across = v[0].x > x1 && v[0].x < x2 && h[0].y > y1 && h[0].y < y2;
  return across ? 'crosses' : undefined;
}

/**
 * Arrows in one gap between two rows, of different sources and targets,
 * that run on top of each other or cross.
 */
function clashes(
  list: { edge: Edge<FrameEdgeData>; points: Point[] }[],
  layout: StepLayout,
) {
  const gapOf = (edge: Edge) => {
    const source = layout.positions.get(edge.source)!.y;
    const target = layout.positions.get(edge.target)!.y;
    return layout.rowGaps?.find(g => g > source && g < target);
  };
  const found: string[] = [];
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (
        a.edge.source === b.edge.source ||
        a.edge.target === b.edge.target ||
        gapOf(a.edge) === undefined ||
        gapOf(a.edge) !== gapOf(b.edge)
      ) {
        continue;
      }
      for (const p of segments(a.points)) {
        for (const q of segments(b.points)) {
          const clash = clashOf(p, q);
          if (clash) found.push(`${a.edge.id} ${clash} ${b.edge.id}`);
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
  it('run side by side, clear of the rows', () => {
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
    expect(Math.abs(ys[0] - ys[1])).toBe(10);
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

  it('turn down at different x out of the loop and into the groups below', () => {
    for (const width of [1000, 800]) {
      const visible = visibleSteps(loopGraph.nodes, loopGraph.edges);
      const result = layoutGroupedSteps(
        visible.nodes.map(n => ({ id: n.id, size: stepSize(n) })),
        visible.edges,
        loopGraph.eventGroups ?? [],
        {},
        width,
      );
      const across = arrows(result).filter(
        a => a.edge.data?.centerY !== undefined,
      );
      // The last round into the step after the loop, and the signal into
      // the step it started, both run below the loop.
      const pair = ['group:label:loop:draft-review:3', 'signal-29'].map(
        source => across.find(a => a.edge.source === source),
      );
      expect(pair.every(Boolean)).toBe(true);
      expect({ width, clashes: clashes(across, result.layout) }).toEqual({
        width,
        clashes: [],
      });
      expect(outside(across, result.layout.width)).toEqual([]);
    }
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
  function routed(layout: StepLayout, edges: Edge<FrameEdgeData>[]) {
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

  it.each([2, 3, 4])(
    'spread %i arrows that turn at one x, nested and inside the graph',
    count => {
      const { layout, edges } = stacked(count);
      const result = routed(layout, edges);
      expect(clashes(result, layout)).toEqual([]);
      expect(outside(result, layout.width)).toEqual([]);
      const turnsOut = result.map(a => a.points[1].x);
      const turnsIn = result.map(a => a.points[3].x);
      expect(new Set(turnsOut).size).toBe(count);
      expect(new Set(turnsIn).size).toBe(count);
      // The arrow from the higher source turns farther right, the one into
      // the lower target farther left.
      expect([...turnsOut].sort((a, b) => b - a)).toEqual(turnsOut);
      expect([...turnsIn].sort((a, b) => b - a)).toEqual(turnsIn);
    },
  );

  it('turns two arrows the full space apart at the sides of the graph', () => {
    const { layout, edges } = stacked(2);
    const [a, b] = routed(layout, edges).map(({ points }) => points);
    expect(a[1].x - b[1].x).toBe(EDGE_LANE_GAP);
    expect(a[3].x - b[3].x).toBe(EDGE_LANE_GAP);
  });

  it('keeps one turn for the arrows out of one source', () => {
    const { layout, edges } = stacked(2);
    const fork = [
      { ...edges[0], id: 's0->t1', target: 't1' },
      edges[0],
      edges[1],
    ];
    const result = routed(layout, fork);
    const turnOut = (id: string) =>
      result.find(a => a.edge.id === id)!.points[1].x;
    expect(turnOut('s0->t0')).toBe(turnOut('s0->t1'));
    expect(turnOut('s0->t0')).not.toBe(turnOut('s1->t1'));
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

/**
 * A random run: steps that run over random spans of time, each one after
 * the steps that ended last before it started (as a run is drawn), sizes
 * of steps, model calls and tool calls, and up to three groups of steps
 * next to each other.
 */
function randomRun(seed: number) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
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
  const groups: WorkflowEventGroup[] = [];
  const groupCount = 1 + Math.floor(random() * 3);
  for (let g = 0; g < groupCount; g++) {
    const first = Math.floor(random() * count);
    const length = 1 + Math.floor(random() * 4);
    groups.push({
      ...nested([])[0],
      key: `label:g${g}`,
      id: `g${g}`,
      name: `g${g}`,
      nodeIds: ids.slice(first, Math.min(count, first + length)),
    });
  }
  const size = (width: number, height: number): NodeSize => ({ width, height });
  // A size each: dagre writes the place of a box into it.
  const nodes = ids.map(id => {
    if (random() < 0.15) return { id, size: size(240, 86) };
    return { id, size: random() < 0.1 ? size(180, 52) : size(220, 64) };
  });
  return { nodes, edges, groups };
}

function layOutRun(
  run: ReturnType<typeof randomRun>,
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
    [163, 1100],
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

  it('never run arrows through boxes because of lined up rows, nor spread turns too close', () => {
    const found: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const run = randomRun(seed);
      for (const width of [undefined, 900, 1400]) {
        const result = layOutRun(run, width);
        const before = new Set(throughBoxes(layOutRun(run, width, false)));
        for (const hit of throughBoxes(result)) {
          if (!before.has(hit)) found.push(`run ${seed} at ${width}: ${hit}`);
        }
        for (const close of spreadTooClose(result)) {
          found.push(`run ${seed} at ${width}: ${close}`);
        }
      }
    }
    expect(found).toEqual([]);
  }, 60_000);
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
