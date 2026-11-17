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

import { Edge } from '@xyflow/react';
import type {
  WorkflowEventGroup,
  WorkflowGraphNode,
  WorkflowGraphResponse,
} from '../../common';
import {
  framableSource,
  GroupedLayout,
  groupNodeId,
  GroupViews,
  layoutGroupedSteps,
} from './eventGroups';
import {
  FrameEdgeData,
  frameEdgePoints,
  OFFSET,
  frameInsets,
  routeRowGaps,
} from './frameEdge';
import {
  boxSize,
  EDGE_LANE_GAP,
  FRAME_GAP,
  layoutGraph,
  stepSize,
  StepLayout,
  visibleSteps,
} from './layout';
import {
  STACK_GAP,
  STACK_SIDE,
  stackGapOf,
  stackSidePad,
  stackTurnIn,
  stackTurnOut,
} from './geometry';

import { agentGraph } from '../../testGraphs/agentGraph';
import { loopGraph } from '../../testGraphs/loopGraph';
import { parallelGraph } from '../../testGraphs/parallelGraph';

type Graph = Pick<WorkflowGraphResponse, 'nodes' | 'edges' | 'eventGroups'>;

/** Lays out a graph as the page does; `lay` sees what is laid out. */
function laidOut(
  graph: Graph,
  views: GroupViews,
  width?: number,
  lay: typeof layoutGraph = layoutGraph,
): GroupedLayout {
  const visible = visibleSteps(graph.nodes, graph.edges);
  return layoutGroupedSteps(
    visible.nodes.map(n => ({
      id: n.id,
      size: stepSize(n),
      ...(framableSource(n) ? { framable: true } : {}),
    })),
    visible.edges,
    graph.eventGroups ?? [],
    views,
    width,
    lay,
  );
}

function rect(result: GroupedLayout, id: string) {
  const p = result.layout.positions.get(id)!;
  const size = boxSize(result.layout, id);
  return {
    left: p.x,
    top: p.y,
    right: p.x + size.width,
    bottom: p.y + size.height,
    middle: p.y + size.height / 2,
  };
}

const step = (id: string, extra = {}): WorkflowGraphNode => ({
  id,
  kind: 'activity',
  name: id,
  status: 'Completed',
  events: [],
  ...extra,
});

const label = (
  key: string,
  nodeIds: string[],
  parent?: string,
  children: string[] = [],
): WorkflowEventGroup => ({
  key,
  kind: 'label',
  id: key,
  name: key,
  nodeIds,
  children,
  status: 'Completed',
  ...(parent ? { parent } : {}),
});

/**
 * start, a loop of `rounds` rounds of three steps each (`r<round>s<i>`),
 * end. With `extra`, more steps, arrows and groups.
 */
function loop(
  rounds: number,
  extra: {
    nodes?: WorkflowGraphNode[];
    edges?: [string, string][];
    groups?: WorkflowEventGroup[];
  } = {},
): Graph {
  const ids = ['start'];
  const groups: WorkflowEventGroup[] = [];
  const all: string[] = [];
  const keys: string[] = [];
  for (let r = 1; r <= rounds; r++) {
    const steps = [1, 2, 3].map(i => `r${r}s${i}`);
    ids.push(...steps);
    all.push(...steps);
    keys.push(`label:r${r}`);
    groups.push(label(`label:r${r}`, steps, 'label:loop'));
  }
  ids.push('end');
  const pairs = ids.slice(1).map((id, i) => [ids[i], id]);
  return {
    nodes: [...ids.map(id => step(id)), ...(extra.nodes ?? [])],
    edges: [...pairs, ...(extra.edges ?? [])].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
    })),
    eventGroups: [
      label('label:loop', all, undefined, keys),
      ...groups,
      ...(extra.groups ?? []),
    ],
  };
}

const open = (...rounds: number[]): GroupViews =>
  Object.fromEntries(rounds.map(r => [`label:r${r}`, true]));
const box = (key: string) => groupNodeId(key);

/** The arrows as the graph draws them, with their corners. */
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
      const s = rect(result, edge.source);
      const t = rect(result, edge.target);
      return {
        edge,
        points: frameEdgePoints(
          { x: s.right, y: s.middle },
          { x: t.left, y: t.middle },
          edge.data!,
        ),
      };
    },
  );
}

/**
 * Arrows of different sources and targets with parts on top of each other,
 * down (or up) or across.
 */
function runningOn(result: GroupedLayout) {
  const found: string[] = [];
  const list = arrows(result).map(({ edge, points }) => ({
    edge,
    parts: points.slice(1).map((p, i) => [points[i], p] as const),
  }));
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (a.edge.source === b.edge.source || a.edge.target === b.edge.target) {
        continue;
      }
      for (const [p1, p2] of a.parts) {
        for (const [q1, q2] of b.parts) {
          const lines = [
            p1.x === p2.x && q1.x === q2.x && Math.abs(p1.x - q1.x) < 1
              ? [p1.y, p2.y, q1.y, q2.y]
              : undefined,
            p1.y === p2.y && q1.y === q2.y && Math.abs(p1.y - q1.y) < 1
              ? [p1.x, p2.x, q1.x, q2.x]
              : undefined,
          ];
          for (const line of lines) {
            if (!line) continue;
            const [a1, a2] = [
              Math.min(line[0], line[1]),
              Math.max(line[0], line[1]),
            ];
            const [b1, b2] = [
              Math.min(line[2], line[3]),
              Math.max(line[2], line[3]),
            ];
            if (Math.min(a2, b2) - Math.max(a1, b1) > 1) {
              found.push(`${a.edge.id} runs on ${b.edge.id}`);
            }
          }
        }
      }
    }
  });
  return [...new Set(found)];
}

/**
 * Arrows of different sources and targets with parts down (or up) side by
 * side closer than a lane, or across side by side in a gap closer than a
 * lane.
 */
function tooClose(result: GroupedLayout) {
  const found: string[] = [];
  const list = arrows(result).map(({ edge, points }) => ({
    edge,
    parts: points.slice(1).map((p, i) => [points[i], p] as const),
  }));
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (a.edge.source === b.edge.source || a.edge.target === b.edge.target) {
        continue;
      }
      for (const [p1, p2] of a.parts) {
        for (const [q1, q2] of b.parts) {
          const down = p1.x === p2.x && q1.x === q2.x;
          const across = p1.y === p2.y && q1.y === q2.y;
          if (!down && !across) continue;
          const [d, along] = down
            ? [Math.abs(p1.x - q1.x), [p1.y, p2.y, q1.y, q2.y]]
            : [Math.abs(p1.y - q1.y), [p1.x, p2.x, q1.x, q2.x]];
          const overlap =
            Math.min(
              Math.max(along[0], along[1]),
              Math.max(along[2], along[3]),
            ) -
            Math.max(
              Math.min(along[0], along[1]),
              Math.min(along[2], along[3]),
            );
          if (d >= 1 && d < EDGE_LANE_GAP && overlap > 1) {
            found.push(`${a.edge.id} next to ${b.edge.id}`);
          }
        }
      }
    }
  });
  return [...new Set(found)];
}

/** Arrows that run through a box other than their ends. */
function throughBoxes(result: GroupedLayout) {
  const found: string[] = [];
  for (const { edge, points } of arrows(result)) {
    for (const [a, b] of points.slice(1).map((p, i) => [points[i], p])) {
      const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      for (const { id } of result.graph.nodes) {
        if (id === edge.source || id === edge.target) continue;
        const r = rect(result, id);
        if (x1 < r.right && x2 > r.left && y1 < r.bottom && y2 > r.top) {
          found.push(`${edge.id} through ${id}`);
        }
      }
    }
  }
  return found;
}

/** The frames laid out, and which of them stack their groups. */
function stackedFrames(graph: Graph, views: GroupViews) {
  const seen: string[][] = [];
  laidOut(graph, views, undefined, (nodes, edges, width, options) => {
    seen.push((options?.frames ?? []).filter(f => f.stacked).map(f => f.id));
    return layoutGraph(nodes, edges, width, options);
  });
  return seen[seen.length - 1];
}

describe('frames that stack their groups', () => {
  it('stack a frame with two groups or more, at least one of them open', () => {
    expect(stackedFrames(loop(3), open(2))).toEqual([box('label:loop')]);
    expect(stackedFrames(loop(2), open(1, 2))).toEqual([box('label:loop')]);
  });

  it('do not stack a frame whose groups are all collapsed', () => {
    expect(stackedFrames(loop(3), {})).toEqual([]);
    expect(stackedFrames(loopGraph, {})).toEqual([]);
    // The rounds stay a row of boxes, left to right.
    const result = laidOut(loop(3), {});
    const middles = [1, 2, 3].map(r => rect(result, box(`label:r${r}`)).middle);
    expect(new Set(middles).size).toBe(1);
  });

  it('do not stack a frame with one group', () => {
    // A group of one round, open.
    const graph = loop(1);
    expect(stackedFrames(graph, open(1))).toEqual([]);
    // Parallel A holds one group, open by default.
    expect(stackedFrames(parallelGraph, {})).toEqual([]);
    const result = laidOut(graph, open(1));
    expect(result.layout.stackGaps).toBeUndefined();
  });

  it('put each open group in a row of its own, its steps left to right', () => {
    const result = laidOut(loop(3), open(1, 2, 3));
    const rounds = [1, 2, 3].map(r => rect(result, box(`label:r${r}`)));
    for (let r = 1; r < 3; r++) {
      expect(rounds[r].top - rounds[r - 1].bottom).toBe(STACK_GAP);
      // The rows start at the left side of the loop.
      expect(rounds[r].left).toBe(rounds[0].left);
    }
    const frame = rect(result, box('label:loop'));
    expect(rounds[0].left - frame.left).toBe(STACK_SIDE);
    for (let r = 1; r <= 3; r++) {
      const steps = [1, 2, 3].map(i => rect(result, `r${r}s${i}`));
      expect(new Set(steps.map(s => s.middle)).size).toBe(1);
      expect(steps[0].right).toBeLessThan(steps[1].left);
      expect(steps[1].right).toBeLessThan(steps[2].left);
    }
  });

  it('put collapsed groups next to each other in one row', () => {
    const result = laidOut(loop(4), open(1));
    const [r2, r3, r4] = [2, 3, 4].map(r => rect(result, box(`label:r${r}`)));
    expect(r3.middle).toBe(r2.middle);
    expect(r4.middle).toBe(r2.middle);
    expect(r2.right).toBeLessThan(r3.left);
    expect(r2.top).toBeGreaterThan(rect(result, box('label:r1')).bottom);
  });

  it('keep the groups in the order they started, whichever are open', () => {
    for (const views of [
      open(1),
      open(2),
      open(3),
      open(4),
      open(1, 3),
      open(2, 4),
      open(1, 2, 3, 4),
    ]) {
      const result = laidOut(loop(4), views);
      const tops = [1, 2, 3, 4].map(r => rect(result, box(`label:r${r}`)));
      for (let r = 1; r < 4; r++) {
        // Below the one before, or next to it in one row.
        const below = tops[r].top >= tops[r - 1].bottom;
        const after =
          tops[r].middle === tops[r - 1].middle &&
          tops[r].left > tops[r - 1].right;
        expect({ views, r, order: below || after }).toEqual({
          views,
          r,
          order: true,
        });
      }
    }
  });

  it('lead the arrow into the next row out right, back left in the gap, in from the left', () => {
    const result = laidOut(loop(3), open(1, 2, 3));
    const into = arrows(result).find(a => a.edge.id === 'r1s3->r2s1')!;
    const [r1, r2] = [1, 2].map(r => rect(result, box(`label:r${r}`)));
    const { points } = into;
    expect(points).toHaveLength(6);
    // Out of the right side of the round, FRAME_GAP clear of it.
    expect(points[1].x).toBe(r1.right + FRAME_GAP);
    // Left in the gap between the two rows.
    expect(points[2].y).toBeGreaterThan(r1.bottom);
    expect(points[2].y).toBeLessThan(r2.top);
    expect(points[3].x).toBe(r2.left - FRAME_GAP);
    // Into the left side of the step.
    expect(points[4].y).toBe(points[5].y);
    expect(points[5]).toEqual({ x: rect(result, 'r2s1').left, y: points[5].y });
    expect(throughBoxes(result)).toEqual([]);
  });

  it('lead an arrow into a later row past the rows between them along the side', () => {
    // r1 open, r2 and r3 collapsed in one row, r4 open; an arrow from r1
    // into r4.
    const graph = loop(4, { edges: [['r1s2', 'r4s1']] });
    const result = laidOut(graph, open(1, 4));
    const past = arrows(result).find(a => a.edge.id === 'r1s2->r4s1')!;
    const loopFrame = rect(result, box('label:loop'));
    expect(past.points[3].x).toBeGreaterThan(loopFrame.left);
    expect(past.points[3].x).toBeLessThan(rect(result, box('label:r2')).left);
    expect(throughBoxes(result)).toEqual([]);
  });

  it('put unconnected boxes of a row one after the other', () => {
    // m, a step of the loop that runs during round 2, from round 1 to the
    // end: in the row of round 2, which it has no arrow to.
    const graph = loop(3, {
      nodes: [step('m')],
      edges: [
        ['r1s3', 'm'],
        ['m', 'end'],
      ],
    });
    graph.eventGroups![0].nodeIds.push('m');
    graph.nodes = graph.nodes.filter(n => n.id !== 'm');
    graph.nodes.splice(
      graph.nodes.findIndex(n => n.id === 'r3s1'),
      0,
      step('m'),
    );
    const result = laidOut(graph, open(1, 3));
    const [r2, m] = [rect(result, box('label:r2')), rect(result, 'm')];
    expect(m.middle).toBe(r2.middle);
    expect(m.left).toBeGreaterThan(r2.right);
  });

  it('line up the steps outside with the steps they lead to in the rows', () => {
    const result = laidOut(loop(3), open(1, 2, 3), 1400);
    expect(result.layout.wrapped).toBe(false);
    expect(rect(result, 'start').middle).toBe(rect(result, 'r1s1').middle);
    expect(rect(result, 'end').middle).toBe(rect(result, 'r3s3').middle);
  });

  it('line up steps outside only with the steps in their row of a wrapped graph', () => {
    // x and y after the loop, side by side: the next row when wrapped.
    const graph = loop(3, {
      nodes: [step('x'), step('y')],
      edges: [
        ['r3s3', 'x'],
        ['r3s3', 'y'],
        ['x', 'end'],
        ['y', 'end'],
      ],
    });
    graph.edges = graph.edges.filter(e => e.id !== 'r3s3->end');
    const result = laidOut(graph, open(1, 2, 3), 1000);
    expect(result.layout.wrapped).toBe(true);
    const [x, y] = [rect(result, 'x'), rect(result, 'y')].sort(
      (a, b) => a.top - b.top,
    );
    // As dagre put them, one above the other.
    expect(y.top - x.bottom).toBe(24);
  });
});

describe('arrows up into an earlier row of a stacked frame', () => {
  it('turn apart from each other, clear of the frame', () => {
    // Two rows of a stacked frame f, from each source in the lower row up
    // into a target in the upper one.
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['t1', { x: STACK_SIDE, y: 20 }],
      ['t2', { x: STACK_SIDE, y: 100 }],
      ['s1', { x: 300, y: 240 }],
      ['s2', { x: 300, y: 320 }],
    ]);
    const layout: StepLayout = {
      positions,
      sizes: new Map([['f', { width: 900, height: 420 }]]),
      width: 940,
      height: 440,
      wrapped: false,
      stackGaps: new Map([['f', [202]]]),
    };
    const edges: Edge<FrameEdgeData>[] = [
      ['s1', 't1'],
      ['s2', 't2'],
    ].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'frameEdge',
      data: { sourceInset: 30, targetInset: FRAME_GAP },
    }));
    const routed = routeRowGaps(layout, edges) as Edge<FrameEdgeData>[];
    // Side by side in the gap.
    expect(routed.map(e => e.data!.centerY).sort()).toEqual([197, 207]);
    const points = routed.map(e => {
      const end = (id: string, side: number) => ({
        x: positions.get(id)!.x + side * boxSize(layout, id).width,
        y: positions.get(id)!.y + boxSize(layout, id).height / 2,
      });
      return frameEdgePoints(end(e.source, 1), end(e.target, 0), e.data!);
    });
    // Up out of the sources and up into the targets a lane apart.
    expect(Math.abs(points[0][1].x - points[1][1].x)).toBeGreaterThanOrEqual(
      EDGE_LANE_GAP,
    );
    expect(Math.abs(points[0][3].x - points[1][3].x)).toBeGreaterThanOrEqual(
      EDGE_LANE_GAP,
    );
    for (const p of points) {
      expect(p[3].x).toBeGreaterThanOrEqual(FRAME_GAP);
      expect(p[3].x).toBeLessThanOrEqual(STACK_SIDE - FRAME_GAP);
    }
  });

  it('turns an arrow up a lane away from an arrow it would run next to', () => {
    // The arrow up would turn 4px from the arrow down into the lower row.
    // It moves right, a lane away, where that row leaves room. The two
    // arrows share neither end, so the lanes of the gap do not separate
    // these turns.
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['ds', { x: 200, y: 40 }],
      ['ut', { x: 500, y: 40 }],
      ['us', { x: 200, y: 300 }],
      ['dt', { x: 524, y: 300 }],
    ]);
    const layout: StepLayout = {
      positions,
      sizes: new Map([['f', { width: 900, height: 420 }]]),
      width: 940,
      height: 460,
      wrapped: false,
      stackGaps: new Map([['f', [220]]]),
    };
    const edges: Edge<FrameEdgeData>[] = [
      {
        id: 'ds->dt',
        source: 'ds',
        target: 'dt',
        type: 'frameEdge',
        data: { sourceInset: OFFSET, targetInset: 80 },
      },
      {
        id: 'us->ut',
        source: 'us',
        target: 'ut',
        type: 'frameEdge',
        data: { sourceInset: 28, targetInset: FRAME_GAP },
      },
    ];
    const routed = routeRowGaps(layout, edges) as Edge<FrameEdgeData>[];
    const xOf = (id: string) => {
      const edge = routed.find(e => e.id === id)!;
      const end = (node: string, side: number) => ({
        x: positions.get(node)!.x + side * boxSize(layout, node).width,
        y: positions.get(node)!.y + boxSize(layout, node).height / 2,
      });
      return frameEdgePoints(
        end(edge.source, 1),
        end(edge.target, 0),
        edge.data!,
      )[1].x;
    };
    // Down into dt stays; up out of us was 4px from it and moves a lane off.
    expect(Math.abs(xOf('us->ut') - xOf('ds->dt'))).toBeGreaterThanOrEqual(
      EDGE_LANE_GAP,
    );
  });
});

describe('arrows down the left side of a stacked frame', () => {
  it('run the arrow into the lower target farther out', () => {
    // Out of s1 and s2 in the first row into t1 and t2, one below the
    // other in the second row, both down the left side.
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['s1', { x: 300, y: 40 }],
      ['s2', { x: 560, y: 40 }],
      ['t1', { x: STACK_SIDE, y: 170 }],
      ['t2', { x: STACK_SIDE, y: 250 }],
    ]);
    const layout: StepLayout = {
      positions,
      sizes: new Map([['f', { width: 900, height: 340 }]]),
      width: 940,
      height: 360,
      wrapped: false,
      stackGaps: new Map([['f', [137]]]),
    };
    const edges: Edge<FrameEdgeData>[] = [
      ['s1', 't1'],
      ['s2', 't2'],
    ].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'frameEdge',
      data: { sourceInset: OFFSET, targetInset: FRAME_GAP },
    }));
    const routed = routeRowGaps(layout, edges) as Edge<FrameEdgeData>[];
    const into = (id: string) => {
      const edge = routed.find(e => e.id === id)!;
      return positions.get(edge.target)!.x - edge.data!.targetInset!;
    };
    expect(into('s2->t2')).toBeLessThan(into('s1->t1'));
    expect(into('s1->t1') - into('s2->t2')).toBeGreaterThanOrEqual(
      EDGE_LANE_GAP,
    );
  });
});

describe('arrows down the right side of a stacked frame', () => {
  it('go around an arrow that runs on past the frame next to a box', () => {
    // The rows of frame f, and an arrow from s above the frame down to t
    // below it, past the box x. Out of a, the way down beside b is blocked
    // by the collapsed group m, so that arrow turns in a side lane past
    // the inner one.
    const positions = new Map([
      ['f', { x: 96, y: 796 }],
      ['a', { x: 156, y: 834 }],
      ['g', { x: 156, y: 946 }],
      ['c', { x: 168, y: 984 }],
      ['m', { x: 156, y: 1120 }],
      ['h', { x: 156, y: 1244 }],
      ['b', { x: 168, y: 1282 }],
      ['d', { x: 156, y: 1418 }],
      ['s', { x: 156, y: 340 }],
      ['x', { x: 432, y: 340 }],
      ['t', { x: 48, y: 1644 }],
    ]);
    const layout: StepLayout = {
      positions,
      sizes: new Map([
        ['f', { width: 364, height: 698 }],
        ['a', { width: 180, height: 52 }],
        ['g', { width: 244, height: 114 }],
        ['m', { width: 240, height: 64 }],
        ['h', { width: 244, height: 114 }],
      ]),
      width: 1104,
      height: 1860,
      wrapped: false,
      stackGaps: new Map([['f', [916, 1090, 1214, 1388]]]),
    };
    const parentOf = new Map<string, string | undefined>([
      ['a', 'f'],
      ['g', 'f'],
      ['c', 'g'],
      ['m', 'f'],
      ['h', 'f'],
      ['b', 'h'],
      ['d', 'f'],
    ]);
    const inner = 96 + 364 - STACK_SIDE + FRAME_GAP;
    expect(stackTurnOut(layout, 'a', 'b')).toBe(inner + EDGE_LANE_GAP);
    const edges: Edge<FrameEdgeData>[] = [
      ['a', 'b'],
      ['c', 'd'],
      ['m', 'd'],
      ['b', 'd'],
      ['s', 't'],
    ].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: 'frameEdge',
      data:
        source === 's'
          ? { sourceInset: inner - 376, targetInset: 32, centerY: 1531 }
          : frameInsets(layout, parentOf, source, target),
    }));
    const routed = routeRowGaps(layout, edges) as Edge<FrameEdgeData>[];
    const downs = routed.map(edge => {
      const end = (id: string, side: number) => ({
        x: positions.get(id)!.x + side * boxSize(layout, id).width,
        y: positions.get(id)!.y + boxSize(layout, id).height / 2,
      });
      const points = frameEdgePoints(
        end(edge.source, 1),
        end(edge.target, 0),
        edge.data!,
      );
      return {
        id: edge.id,
        x: points[1].x,
        top: points[1].y,
        bottom: points[2].y,
      };
    });
    // The arrow past the frame stays left of x.
    const past = downs.find(d => d.id === 's->t')!;
    expect(past.x).toBeLessThan(432);
    // The parts down the right side, each a lane from the others there.
    const side = downs.filter(d => d.x > inner - 1);
    side.forEach((d, i) => {
      for (const o of side.slice(i + 1)) {
        const [y1, y2] = [Math.max(d.top, o.top), Math.min(d.bottom, o.bottom)];
        if (y2 - y1 <= 1) continue;
        expect(Math.abs(d.x - o.x)).toBeGreaterThanOrEqual(EDGE_LANE_GAP);
      }
    });
  });
});

describe('the group of a signal received during a round', () => {
  const graph = loop(3, {
    nodes: [step('signal', { kind: 'signal' }), step('hint')],
    edges: [
      ['r2s1', 'signal'],
      ['signal', 'hint'],
      ['hint', 'r2s3'],
    ],
    groups: [
      {
        ...label('event:hint', ['hint']),
        kind: 'event',
        sourceNodeId: 'signal',
      },
    ],
  });
  // The signal and the steps of round 2 first: in the order they ran.
  graph.nodes = [
    ...graph.nodes.filter(n => !['signal', 'hint'].includes(n.id)),
  ];
  graph.nodes.splice(
    graph.nodes.findIndex(n => n.id === 'r2s2'),
    0,
    step('signal', { kind: 'signal' }),
    step('hint'),
  );

  it('goes in the loop, between the round and the next one', () => {
    for (const views of [open(1, 2, 3), open(2)]) {
      const result = laidOut(graph, views);
      const hint = rect(result, box('event:hint'));
      const frame = rect(result, box('label:loop'));
      expect(hint.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
      expect(hint.bottom).toBeLessThan(rect(result, box('label:r3')).top);
      expect(hint.left).toBeGreaterThan(frame.left);
      expect(hint.right).toBeLessThan(frame.right);
      expect(
        result.graph.frames.find(f => f.id === box('event:hint'))!.parent,
      ).toBe(box('label:loop'));
      expect(throughBoxes(result)).toEqual([]);
    }
  });

  it('starts where the arrow into it turns down out of the round', () => {
    const result = laidOut(graph, open(1, 2, 3));
    const into = arrows(result).find(a => a.edge.target === 'hint')!;
    // Straight down from the step of the round, then into the group.
    expect(into.points[1].x).toBe(into.points[3].x);
    expect(rect(result, box('event:hint')).left).toBe(
      rect(result, 'r2s1').right + 2 * FRAME_GAP,
    );
  });

  it('goes in the loop also when it leads nowhere else', () => {
    const dead = {
      ...graph,
      edges: graph.edges.filter(e => e.id !== 'hint->r2s3'),
    };
    const result = laidOut(dead, open(1, 2, 3));
    const hint = rect(result, box('event:hint'));
    expect(hint.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
    expect(hint.bottom).toBeLessThan(rect(result, box('label:r3')).top);
  });

  it('stays out of the loop when it also leads elsewhere', () => {
    const elsewhere = {
      ...graph,
      edges: [
        ...graph.edges,
        { id: 'hint->end', source: 'hint', target: 'end' },
      ],
    };
    const result = laidOut(elsewhere, open(1, 2, 3));
    expect(
      result.graph.frames.find(f => f.id === box('event:hint'))!.parent,
    ).toBeUndefined();
    const hint = rect(result, box('event:hint'));
    const frame = rect(result, box('label:loop'));
    expect(
      hint.left >= frame.right ||
        hint.top >= frame.bottom ||
        hint.right <= frame.left,
    ).toBe(true);
  });

  /** Two signals received during round 2, from `a` and `b`. */
  function twoSignals(a: string, b: string): Graph {
    const signals = loop(3, {
      edges: [
        [a, 'signalA'],
        ['signalA', 'hintA'],
        ['hintA', 'r2s3'],
        [b, 'signalB'],
        ['signalB', 'hintB'],
        ['hintB', 'r2s3'],
      ],
      groups: (['A', 'B'] as const).map(k => ({
        ...label(`event:hint${k}`, [`hint${k}`]),
        kind: 'event' as const,
        sourceNodeId: `signal${k}`,
      })),
    });
    signals.nodes.splice(
      signals.nodes.findIndex(n => n.id === 'r2s3'),
      0,
      step('signalA', { kind: 'signal' }),
      step('hintA'),
      step('signalB', { kind: 'signal' }),
      step('hintB'),
    );
    return signals;
  }

  it.each([
    ['from two steps', 'r2s1', 'r2s2'],
    ['from one step', 'r2s1', 'r2s1'],
  ])(
    'go side by side in one row, two received during one round %s',
    (_, a, b) => {
      for (const views of [open(2), open(1, 2, 3)]) {
        const result = laidOut(twoSignals(a, b), views, 1000);
        const [hA, hB] = ['A', 'B'].map(k =>
          rect(result, box(`event:hint${k}`)),
        );
        expect(hB.top).toBe(hA.top);
        expect(hB.left - hA.right).toBeGreaterThanOrEqual(
          2 * FRAME_GAP + EDGE_LANE_GAP,
        );
        // No two arrows of different ends on top of each other, nor closer
        // than a lane next to each other.
        expect(runningOn(result)).toEqual([]);
        expect(tooClose(result)).toEqual([]);
        expect(hA.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
        expect(throughBoxes(result)).toEqual([]);
      }
    },
  );

  it('does not widen a loop whose one signal already has room', () => {
    const views = Object.fromEntries(
      (loopGraph.eventGroups ?? []).map(g => [g.key, true]),
    );
    const full = laidOut(loopGraph, views, 1400);
    const fullLoop = rect(full, box('label:loop:draft-review'));
    expect(fullLoop.right - fullLoop.left).toBe(916);
    expect(fullLoop.bottom - fullLoop.top).toBe(686);
    expect(full.layout.wrapped).toBe(true);
    expect(full.layout.width).toBe(1284);
    expect(full.layout.height).toBe(892);
    const round2 = laidOut(
      loopGraph,
      { 'label:loop:draft-review:2': true },
      1000,
    );
    const openLoop = rect(round2, box('label:loop:draft-review'));
    expect(openLoop.right - openLoop.left).toBe(916);
    expect(openLoop.bottom - openLoop.top).toBe(586);
    expect(round2.layout.wrapped).toBe(true);
    expect(round2.layout.width).toBe(988);
    expect(round2.layout.height).toBe(916);
  });

  it('keeps two groups from one step within the gap their arrows need', () => {
    // Both groups start where the arrow out of the same step turns down.
    // The second is two frame gaps after the first, plus the lanes those
    // arrows take, and no farther: the gap between groups has a bound.
    const result = laidOut(twoSignals('r2s1', 'r2s1'), open(1, 2, 3), 1000);
    const [hA, hB] = ['A', 'B'].map(k => rect(result, box(`event:hint${k}`)));
    const [left, right] = [hA, hB].sort((p, q) => p.left - q.left);
    const gap = right.left - left.right;
    expect(gap).toBeGreaterThanOrEqual(2 * FRAME_GAP);
    expect(gap).toBeLessThanOrEqual(2 * FRAME_GAP + 6 * EDGE_LANE_GAP);
  });

  it('turn into the groups a lane away from the turns out of the row above', () => {
    // Two signals received during round 1, collapsed next to round 2: the
    // arrow into the second group would turn down where the arrow out of
    // round 2 does.
    const signals = loop(3, {
      edges: [
        ['r1s1', 'signalA'],
        ['signalA', 'hintA'],
        ['r1s1', 'signalB'],
        ['signalB', 'hintB'],
      ],
      groups: (['A', 'B'] as const).map(k => ({
        ...label(`event:hint${k}`, [`hint${k}`]),
        kind: 'event' as const,
        sourceNodeId: `signal${k}`,
      })),
    });
    signals.nodes.splice(
      signals.nodes.findIndex(n => n.id === 'r1s2'),
      0,
      step('signalA', { kind: 'signal' }),
      step('hintA'),
      step('signalB', { kind: 'signal' }),
      step('hintB'),
    );
    // Round 3 two steps longer: the row of the groups fits as it is.
    signals.nodes.splice(
      signals.nodes.findIndex(n => n.id === 'end'),
      0,
      step('r3s4'),
      step('r3s5'),
    );
    signals.edges = [
      ...signals.edges.filter(e => e.id !== 'r3s3->end'),
      ...[
        ['r3s3', 'r3s4'],
        ['r3s4', 'r3s5'],
        ['r3s5', 'end'],
      ].map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
    ];
    for (const g of signals.eventGroups!) {
      if (g.key === 'label:loop' || g.key === 'label:r3') {
        g.nodeIds.push('r3s4', 'r3s5');
      }
    }
    const result = laidOut(signals, open(3));
    const hB = rect(result, box('event:hintB'));
    expect(hB.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
    const outOfR2 = rect(result, box('label:r2')).right + FRAME_GAP;
    expect(Math.abs(hB.left - FRAME_GAP - outOfR2)).toBeGreaterThanOrEqual(
      EDGE_LANE_GAP,
    );
  });

  it('go side by side in one row, received during two collapsed rounds next to each other', () => {
    const rounds = loop(3, {
      edges: [
        ['r1s1', 'signalA'],
        ['signalA', 'hintA'],
        ['r2s1', 'signalB'],
        ['signalB', 'hintB'],
      ],
      groups: (['A', 'B'] as const).map(k => ({
        ...label(`event:hint${k}`, [`hint${k}`]),
        kind: 'event' as const,
        sourceNodeId: `signal${k}`,
      })),
    });
    for (const [k, before] of [
      ['A', 'r1s2'],
      ['B', 'r2s2'],
    ]) {
      rounds.nodes.splice(
        rounds.nodes.findIndex(n => n.id === before),
        0,
        step(`signal${k}`, { kind: 'signal' }),
        step(`hint${k}`),
      );
    }
    const result = laidOut(rounds, open(3));
    const [hA, hB] = ['A', 'B'].map(k => rect(result, box(`event:hint${k}`)));
    expect(hB.top).toBe(hA.top);
    expect(hA.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
    expect(throughBoxes(result)).toEqual([]);
  });

  it('stays within the widest row when it would start past it', () => {
    // A signal received at the last step of round 2, into round 3.
    const late = loop(3, {
      nodes: [step('signal', { kind: 'signal' }), step('hint')],
      edges: [
        ['r2s3', 'signal'],
        ['signal', 'hint'],
        ['hint', 'r3s1'],
      ],
      groups: [
        {
          ...label('event:hint', ['hint']),
          kind: 'event',
          sourceNodeId: 'signal',
        },
      ],
    });
    const result = laidOut(late, open(1, 2, 3));
    const hint = rect(result, box('event:hint'));
    expect(hint.top).toBeGreaterThan(rect(result, box('label:r2')).bottom);
    expect(hint.right).toBeLessThanOrEqual(rect(result, box('label:r2')).right);
    expect(throughBoxes(result)).toEqual([]);
  });

  it('keeps the wider side of a stacked frame in its group', () => {
    // The group of the signal holds three groups, one row each. Four arrows
    // run from the first past the second into the third, so the side of
    // that frame is a lane wider than `STACK_SIDE`.
    const parts = ['a', 'b', 'c'].map(k =>
      [1, 2, 3, 4].map(i => `${k}${i}`).slice(0, k === 'b' ? 1 : 4),
    );
    const ids = parts.flat();
    const chain = ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);
    const skips = [1, 2, 3, 4].map(i => [`a${i}`, `c${i}`] as [string, string]);
    const signals = loop(3, {
      nodes: [step('signal', { kind: 'signal' }), ...ids.map(id => step(id))],
      edges: [
        ['r2s1', 'signal'],
        ['signal', 'a1'],
        ...chain,
        ...skips,
        ['c4', 'r2s3'],
      ],
      groups: [
        {
          ...label('event:hint', ids, undefined, [
            'label:a',
            'label:b',
            'label:c',
          ]),
          kind: 'event',
          sourceNodeId: 'signal',
        },
        ...['a', 'b', 'c'].map((k, i) =>
          label(`label:${k}`, parts[i], 'event:hint'),
        ),
      ],
    });
    signals.nodes = [
      ...signals.nodes.filter(n => !['signal', ...ids].includes(n.id)),
    ];
    signals.nodes.splice(
      signals.nodes.findIndex(n => n.id === 'r2s2'),
      0,
      step('signal', { kind: 'signal' }),
      ...ids.map(id => step(id)),
    );
    const views = {
      ...open(1, 2, 3),
      'event:hint': true,
      'label:a': true,
      'label:b': true,
      'label:c': true,
    };
    const result = laidOut(signals, views);
    const hint = box('event:hint');
    expect(result.graph.frames.find(f => f.id === hint)?.stacked).toBe(true);
    expect(result.graph.frames.find(f => f.id === hint)?.parent).toBe(
      box('label:loop'),
    );
    expect(stackSidePad(result.layout, hint)).toBe(STACK_SIDE + EDGE_LANE_GAP);
    expect(throughBoxes(result)).toEqual([]);
    expect(runningOn(result)).toEqual([]);
  });

  it('is drawn after the stacked frame it goes in', () => {
    // The group of the signal listed first.
    const first = {
      ...graph,
      eventGroups: [
        graph.eventGroups![graph.eventGroups!.length - 1],
        ...graph.eventGroups!.slice(0, -1),
      ],
    };
    const result = laidOut(first, open(1, 2, 3));
    const order = result.graph.frames.map(f => f.id);
    expect(order.indexOf(box('event:hint'))).toBeGreaterThan(
      order.indexOf(box('label:loop')),
    );
  });

  it('goes in the loop of the recorded run, between rounds 2 and 3', () => {
    const views = Object.fromEntries(
      (loopGraph.eventGroups ?? []).map(g => [g.key, true]),
    );
    for (const width of [undefined, 1400, 1000]) {
      const result = laidOut(loopGraph, views, width);
      const hint = rect(result, box('event:29'));
      expect(hint.top).toBeGreaterThan(
        rect(result, box('label:loop:draft-review:2')).bottom,
      );
      expect(hint.bottom).toBeLessThan(
        rect(result, box('label:loop:draft-review:3')).top,
      );
      expect(throughBoxes(result)).toEqual([]);
    }
    // Wrapped, the steps after the loop stay in one line in their row.
    const wrapped = laidOut(loopGraph, views, 1000);
    expect(wrapped.layout.wrapped).toBe(true);
    expect(rect(wrapped, 'activity-66').middle).toBe(
      rect(wrapped, 'activity-72').middle,
    );
  });
});

describe('stacked frames in stacked frames', () => {
  /** A loop of two rounds, each a model call, two tool groups, a call. */
  function agent(): Graph {
    const nodes: WorkflowGraphNode[] = [step('start')];
    const edges: [string, string][] = [];
    const groups: WorkflowEventGroup[] = [];
    let last = 'start';
    const all: string[] = [];
    for (let r = 1; r <= 2; r++) {
      const [ask, a1, a2, b1, reply] = ['ask', 'a1', 'a2', 'b1', 'reply'].map(
        s => `r${r}${s}`,
      );
      nodes.push(...[ask, a1, a2, b1, reply].map(id => step(id)));
      edges.push(
        [last, ask],
        [ask, a1],
        [a1, a2],
        [ask, b1],
        [a2, reply],
        [b1, reply],
      );
      last = reply;
      all.push(ask, a1, a2, b1, reply);
      groups.push(
        label(`label:r${r}`, [ask, a1, a2, b1, reply], 'label:loop', [
          `label:r${r}a`,
          `label:r${r}b`,
        ]),
        label(`label:r${r}a`, [a1, a2], `label:r${r}`),
        label(`label:r${r}b`, [b1], `label:r${r}`),
      );
    }
    nodes.push(step('end'));
    edges.push([last, 'end']);
    return {
      nodes,
      edges: edges.map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
      eventGroups: [
        label('label:loop', all, undefined, ['label:r1', 'label:r2']),
        ...groups,
      ],
    };
  }
  const all = Object.fromEntries(
    (agent().eventGroups ?? []).map(g => [g.key, true]),
  );

  it('stack the tool groups of each round, and the rounds in the loop', () => {
    const graph = agent();
    expect(stackedFrames(graph, all)).toEqual([
      box('label:loop'),
      box('label:r1'),
      box('label:r2'),
    ]);
    const result = laidOut(graph, all, 1000);
    for (const r of [1, 2]) {
      const round = rect(result, box(`label:r${r}`));
      const [ask, a, b, reply] = [
        rect(result, `r${r}ask`),
        rect(result, box(`label:r${r}a`)),
        rect(result, box(`label:r${r}b`)),
        rect(result, `r${r}reply`),
      ];
      // One below the other, in the order they ran, in the round.
      expect(a.top - ask.bottom).toBe(STACK_GAP);
      expect(b.top - a.bottom).toBe(STACK_GAP);
      expect(reply.top - b.bottom).toBe(STACK_GAP);
      expect(a.left - round.left).toBe(STACK_SIDE);
      expect(round.bottom).toBeGreaterThan(reply.bottom);
    }
    expect(rect(result, box('label:r2')).top).toBeGreaterThan(
      rect(result, box('label:r1')).bottom,
    );
    expect(throughBoxes(result)).toEqual([]);
    // The rows of the frames, each with its gaps.
    expect([...result.layout.stackGaps!.keys()].sort()).toEqual(
      [box('label:loop'), box('label:r1'), box('label:r2')].sort(),
    );
  });

  it('run the arrows past the rows of a round side by side, clear of the frames', () => {
    const result = laidOut(agent(), all, 1000);
    const drawn = arrows(result);
    const downs = (id: string) => {
      const { points } = drawn.find(a => a.edge.id === id)!;
      return points
        .slice(1)
        .map((p, i) => [points[i], p] as const)
        .filter(([a, b]) => a.x === b.x && a.y !== b.y)
        .map(([a, b]) => ({
          x: a.x,
          top: Math.min(a.y, b.y),
          bottom: Math.max(a.y, b.y),
        }));
    };
    for (const r of [1, 2]) {
      // Into the lower target farther out; into one target in one lane.
      const turnInto = (id: string) =>
        drawn.find(a => a.edge.id === id)!.points[3].x;
      expect(turnInto(`r${r}a2->r${r}reply`)).toBeLessThan(
        turnInto(`r${r}ask->r${r}b1`),
      );
      expect(turnInto(`r${r}b1->r${r}reply`)).toBe(
        turnInto(`r${r}a2->r${r}reply`),
      );
      const [toB, fromA] = [
        downs(`r${r}ask->r${r}b1`),
        downs(`r${r}a2->r${r}reply`),
      ];
      // Both run down the left side of the round, past the rows between.
      expect(toB.length).toBeGreaterThan(0);
      expect(fromA.length).toBeGreaterThan(0);
      for (const p of toB) {
        for (const q of fromA) {
          if (p.bottom <= q.top || q.bottom <= p.top) continue;
          expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(EDGE_LANE_GAP);
        }
      }
      const frames = [`label:r${r}`, `label:r${r}a`, `label:r${r}b`].map(k =>
        rect(result, box(k)),
      );
      for (const p of [...toB, ...fromA]) {
        for (const f of frames) {
          if (p.bottom <= f.top || f.bottom <= p.top) continue;
          for (const side of [f.left, f.right]) {
            expect(Math.abs(p.x - side)).toBeGreaterThanOrEqual(FRAME_GAP);
          }
        }
      }
    }
  });

  it('put the group of a signal received in a stacked round in that round', () => {
    // A signal from the call that asks for the tools, back into the reply.
    const graph = agent();
    graph.nodes.splice(
      graph.nodes.findIndex(n => n.id === 'r1a1'),
      0,
      step('signal', { kind: 'signal' }),
      step('hint'),
    );
    graph.edges.push(
      ...[
        ['r1ask', 'signal'],
        ['signal', 'hint'],
        ['hint', 'r1reply'],
      ].map(([source, target]) => ({
        id: `${source}->${target}`,
        source,
        target,
      })),
    );
    graph.eventGroups!.push({
      ...label('event:hint', ['hint']),
      kind: 'event',
      sourceNodeId: 'signal',
    });
    const result = laidOut(graph, all, 1000);
    expect(
      result.graph.frames.find(f => f.id === box('event:hint'))!.parent,
    ).toBe(box('label:r1'));
    const hint = rect(result, box('event:hint'));
    expect(hint.top).toBeGreaterThan(rect(result, 'r1ask').bottom);
    expect(hint.bottom).toBeLessThan(rect(result, box('label:r1a')).top);
    expect(throughBoxes(result)).toEqual([]);
  });

  it('stack the rounds of the recorded agent, its steps left to right', () => {
    const views = { 'label:loop:agent:1': true, 'label:loop:agent:2': true };
    const result = laidOut(agentGraph, views);
    const [r1, r2] = [1, 2].map(r =>
      rect(result, box(`label:loop:agent:${r}`)),
    );
    expect(r2.top - r1.bottom).toBe(STACK_GAP);
    expect(throughBoxes(result)).toEqual([]);
  });
});

describe('stackGapOf', () => {
  /**
   * A stacked frame `f` of two rows: a and b in the first, c in the second;
   * t outside, right of it.
   */
  function layout(): StepLayout {
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['a', { x: 40, y: 40 }],
      ['b', { x: 300, y: 40 }],
      ['c', { x: 40, y: 200 }],
      ['t', { x: 600, y: 40 }],
    ]);
    return {
      positions,
      sizes: new Map([['f', { width: 560, height: 300 }]]),
      width: 900,
      height: 320,
      wrapped: false,
      stackGaps: new Map([['f', [150]]]),
    };
  }

  it('gives the gap between two rows of the frame, down and up', () => {
    expect(stackGapOf(layout(), 'a', 'c')).toBe(150);
    expect(stackGapOf(layout(), 'c', 'b')).toBe(150);
    expect(stackGapOf(layout(), 'a', 'b')).toBeUndefined();
  });

  /** Three rows: a; m (at `middle`); and t, in a frame g or not. */
  function threeRows(
    target: { x: number; frame?: boolean },
    middle = 40,
  ): StepLayout {
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['a', { x: 40, y: 40 }],
      ['m', { x: middle, y: 200 }],
      ['t', { x: target.x, y: 360 }],
    ]);
    const sizes = new Map([['f', { width: 700, height: 500 }]]);
    if (target.frame) {
      positions.set('g', { x: target.x - 40, y: 330 });
      sizes.set('g', { width: 300, height: 110 });
    }
    return {
      positions,
      sizes,
      width: 740,
      height: 520,
      wrapped: false,
      stackGaps: new Map([['f', [150, 300]]]),
    };
  }

  it('leads an arrow past a row down where it turns into its target', () => {
    // Down outside the frame g of t is clear of m; next to t it is not.
    expect(stackGapOf(threeRows({ x: 140, frame: true }, 125), 'a', 't')).toBe(
      150,
    );
  });

  it('leads an arrow past a row clear of where arrows turn next to boxes', () => {
    // Down next to t and down next to a would run 20px from the side of m,
    // where an arrow out of m turns: down the right side instead.
    const rows = threeRows({ x: 300 });
    expect(stackGapOf(rows, 'a', 't')).toBe(300);
    expect(stackTurnOut(rows, 'a', 't')).toBe(700 - STACK_SIDE + FRAME_GAP);
  });

  it('uses the next side lane when the inner one would run through a box', () => {
    // The inner right lane is 660. A box ending at 640 covers it (the
    // half-lane clearance is 25) and leaves 670 clear.
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['a', { x: 40, y: 40 }],
      ['m', { x: 40, y: 200 }],
      ['n', { x: 420, y: 200 }],
      ['t', { x: 40, y: 360 }],
    ]);
    const rows: StepLayout = {
      positions,
      sizes: new Map([['f', { width: 700, height: 500 }]]),
      width: 740,
      height: 520,
      wrapped: false,
      stackGaps: new Map([['f', [150, 300]]]),
    };
    expect(stackGapOf(rows, 'a', 't')).toBe(300);
    expect(stackTurnOut(rows, 'a', 't')).toBe(
      700 - STACK_SIDE + FRAME_GAP + EDGE_LANE_GAP,
    );
  });

  it('gives the gap above the row of the source into a row two up', () => {
    const three = layout();
    three.sizes!.set('f', { width: 560, height: 420 });
    three.stackGaps = new Map([['f', [150, 300]]]);
    three.positions.set('e', { x: 40, y: 330 });
    expect(stackGapOf(three, 'e', 'a')).toBe(300);
  });

  it('gives the gap below the row of a box that leads out past another', () => {
    // b is in the way of a out of the frame, nothing of b.
    expect(stackGapOf(layout(), 'a', 't')).toBe(150);
    expect(stackGapOf(layout(), 'b', 't')).toBeUndefined();
  });

  it('makes the gap above a later row taller for arrows that skip to it', () => {
    // Four arrows into the last round: the one from the round above it, and
    // three that skip the rounds between. The gap above the last round
    // counts each of them, so it is a lane taller than the gaps that hold
    // three arrows or fewer.
    const graph = loop(6, {
      edges: [
        ['r1s3', 'r6s1'],
        ['r2s3', 'r6s1'],
        ['r3s3', 'r6s1'],
      ],
    });
    const result = laidOut(graph, open(1, 2, 3, 4, 5, 6));
    const aboveLast =
      rect(result, box('label:r6')).top - rect(result, box('label:r5')).bottom;
    const between =
      rect(result, box('label:r3')).top - rect(result, box('label:r2')).bottom;
    expect(between).toBe(STACK_GAP);
    expect(aboveLast).toBe(STACK_GAP + EDGE_LANE_GAP);
  });

  it('counts an arrow leaving the frame in the gap, and turns it down the side', () => {
    // Three arrows already run from round 1 into round 2. A fourth leaves
    // the loop from a step that is not the last in its row, so the way out
    // to the side is blocked. The gap grows by a lane, and the arrow down
    // to the end turns in the side channel instead of through the rounds
    // below.
    const graph = loop(3, {
      edges: [
        ['r1s1', 'r2s1'],
        ['r1s2', 'r2s1'],
        ['r1s2', 'end'],
      ],
    });
    const result = laidOut(graph, open(1, 2, 3));
    const gap =
      rect(result, box('label:r2')).top - rect(result, box('label:r1')).bottom;
    expect(gap).toBe(STACK_GAP + EDGE_LANE_GAP);
    expect(throughBoxes(result)).toEqual([]);
    expect(tooClose(result)).toEqual([]);
    // The arrow runs across the gap and drops beside the frame, not down
    // through the rounds below the source.
    const frame = rect(result, box('label:loop'));
    const r2 = rect(result, box('label:r2'));
    const leaving = arrows(result).find(a => a.edge.id === 'r1s2->end')!;
    const cutsRound = leaving.points.slice(1).some((q, i) => {
      const p = leaving.points[i];
      if (p.x !== q.x) return false;
      const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
      if (y2 <= r2.top || y1 >= r2.bottom) return false;
      return p.x > frame.left + STACK_SIDE && p.x < frame.right - STACK_SIDE;
    });
    expect(cutsRound).toBe(false);
  });

  it('counts an arrow entering the frame in the gap above its row', () => {
    // Three arrows already run from round 1 into round 2. A fourth comes
    // into the loop from the start, to a step that is not the first in its
    // row, so the way in from the side is blocked. The gap above round 2
    // grows by a lane.
    const graph = loop(3, {
      edges: [
        ['r1s1', 'r2s1'],
        ['r1s2', 'r2s1'],
        ['start', 'r2s2'],
      ],
    });
    const result = laidOut(graph, open(1, 2, 3));
    const gap =
      rect(result, box('label:r2')).top - rect(result, box('label:r1')).bottom;
    expect(gap).toBe(STACK_GAP + EDGE_LANE_GAP);
    const below =
      rect(result, box('label:r3')).top - rect(result, box('label:r2')).bottom;
    expect(below).toBe(STACK_GAP);
    expect(throughBoxes(result)).toEqual([]);
    expect(tooClose(result)).toEqual([]);
  });

  it('turns an arrow down the side when the way into a lower target is blocked', () => {
    // Out of the frame from a, with b in the way to the side. Down next to
    // t would run through the rows below, so the arrow turns in the side
    // channel instead.
    const positions = new Map([
      ['f', { x: 0, y: 0 }],
      ['a', { x: 40, y: 40 }],
      ['b', { x: 300, y: 40 }],
      ['m', { x: 40, y: 200 }],
      ['c', { x: 40, y: 360 }],
      ['t', { x: 40, y: 600 }],
    ]);
    const rows: StepLayout = {
      positions,
      sizes: new Map([['f', { width: 700, height: 500 }]]),
      width: 740,
      height: 700,
      wrapped: false,
      stackGaps: new Map([['f', [150, 300]]]),
    };
    const side = stackTurnIn(rows, 'a', 't');
    expect(stackGapOf(rows, 'a', 't')).toBe(150);
    expect(side).toBe(700 - STACK_SIDE + FRAME_GAP);
  });

  it('gives the gap above the row of a box led into past another', () => {
    const into = layout();
    into.positions.set('t', { x: -400, y: 200 });
    into.positions.set('d', { x: 300, y: 200 });
    // c is in the way into d from the left, nothing into c.
    expect(stackGapOf(into, 't', 'd')).toBe(150);
    expect(stackGapOf(into, 't', 'c')).toBeUndefined();
  });
});
