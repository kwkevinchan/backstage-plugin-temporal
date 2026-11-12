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

import type { WorkflowGraphNode } from '@kwkevinchan/backstage-plugin-temporal-common';
import { graphResponse } from '../../testData';
import { routeRowGaps } from './GraphCanvas';
import {
  graphHeight,
  initialViewport,
  keepInGraph,
  layoutSteps,
  MAX_GRAPH_HEIGHT,
  MIN_GRAPH_HEIGHT,
  NODE_FONT_SIZE,
  NODE_HEIGHT,
  NODE_WIDTH,
  panIntoView,
  READABLE_ZOOM,
  visibleSteps,
} from './layout';

const node = (
  id: string,
  extra: Partial<WorkflowGraphNode> = {},
): WorkflowGraphNode => ({
  id,
  kind: 'activity',
  name: id,
  status: 'Completed',
  events: [],
  ...extra,
});
const marker = (id: string, markerName: string) =>
  node(id, { kind: 'marker', name: markerName, details: { markerName } });
const edgesOf = (...pairs: [string, string][]) =>
  pairs.map(([source, target]) => ({
    id: `${source}->${target}`,
    source,
    target,
  }));
const pairs = (edges: { source: string; target: string }[]) =>
  edges.map(e => `${e.source}>${e.target}`);

/** A chain start > s1 > ... > sN > end. */
function chain(count: number) {
  const ids = [
    'start',
    ...Array.from({ length: count }, (_, i) => `s${i + 1}`),
    'end',
  ];
  return {
    nodes: ids.map(id => node(id)),
    edges: edgesOf(
      ...ids.slice(1).map((id, i) => [ids[i], id] as [string, string]),
    ),
  };
}

describe('layoutSteps', () => {
  it('lays out steps left to right and leaves out internal steps', () => {
    const { nodes, edges } = visibleSteps(
      graphResponse.nodes,
      graphResponse.edges,
    );
    expect(nodes.map(n => n.id)).not.toContain('workflowTask-2');
    const { positions } = layoutSteps(nodes, edges);
    const xs = ['start', 'activity-5', 'activity-11', 'end'].map(
      id => positions.get(id)!.x,
    );
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('puts parallel steps in the same column', () => {
    const nodes = ['start', 'a', 'b', 'end'].map(id => node(id));
    const edges = edgesOf(
      ['start', 'a'],
      ['start', 'b'],
      ['a', 'end'],
      ['b', 'end'],
    );
    const { positions } = layoutSteps(nodes, edges);
    expect(positions.get('a')!.x).toBe(positions.get('b')!.x);
    expect(positions.get('a')!.y).not.toBe(positions.get('b')!.y);
  });

  it('keeps a graph that fits in one row', () => {
    const { nodes, edges } = chain(2);
    const layout = layoutSteps(nodes, edges, 1200);
    expect(layout.wrapped).toBe(false);
    const ys = new Set([...layout.positions.values()].map(p => p.y));
    expect(ys.size).toBe(1);
  });

  it('wraps a long run into rows that fit the width', () => {
    const { nodes, edges } = chain(12);
    const layout = layoutSteps(nodes, edges, 1000);
    expect(layout.wrapped).toBe(true);
    expect(layout.width).toBeLessThanOrEqual(1000);
    const at = (id: string) => layout.positions.get(id)!;
    // Reads like text: left to right, then the next row.
    expect(at('s1').x).toBeGreaterThan(at('start').x);
    expect(at('s1').y).toBe(at('start').y);
    const rows = [...new Set([...layout.positions.values()].map(p => p.y))];
    expect(rows.length).toBeGreaterThan(1);
    expect(at('end').y).toBe(Math.max(...rows));
    for (const p of layout.positions.values()) {
      expect(p.x + NODE_WIDTH).toBeLessThanOrEqual(layout.width);
    }
    // Opens at full size: every step readable, no panning sideways.
    const view = initialViewport(layout, {
      width: 1000,
      height: graphHeight(layout, 1000),
    });
    expect(view.zoom).toBe(1);
  });

  it('keeps the gap between rows clear for the arrows into the next row', () => {
    // start → (a | b) → c → … : the parallel column makes the first row
    // taller than its single steps.
    const nodes = ['start', 'a', 'b', 'c', 'd', 'e', 'f', 'end'].map(id =>
      node(id),
    );
    const edges = edgesOf(
      ['start', 'a'],
      ['start', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'end'],
    );
    const layout = layoutSteps(nodes, edges, 900);
    expect(layout.wrapped).toBe(true);
    const gaps = layout.rowGaps!;
    expect(gaps.length).toBeGreaterThan(0);
    const bottomOfRow = Math.max(
      ...[...layout.positions.values()]
        .filter(p => p.y < gaps[0])
        .map(p => p.y + NODE_HEIGHT),
    );
    const topOfNext = Math.min(
      ...[...layout.positions.values()]
        .filter(p => p.y > gaps[0])
        .map(p => p.y),
    );
    // The gap is between the lowest box of a row and the next row.
    expect(gaps[0]).toBeGreaterThan(bottomOfRow);
    expect(gaps[0]).toBeLessThan(topOfNext);

    // An arrow from the row's last column into the next row turns in it;
    // arrows within a row stay plain smooth steps.
    const flowEdges = edges.map(({ source, target }) => ({
      id: `${source}-${target}`,
      source,
      target,
      type: 'smoothstep',
    }));
    const routed = routeRowGaps(layout, flowEdges);
    const across = routed.filter(e => e.type === 'rowGap');
    expect(across.length).toBeGreaterThan(0);
    for (const e of across) {
      // The first gap below its source: between the two rows it joins.
      const centerY = (e.data as { centerY: number }).centerY;
      const from = layout.positions.get(e.source)!.y;
      expect(centerY).toBe(gaps.find(g => g > from));
      expect(layout.positions.get(e.target)!.y).toBeGreaterThan(centerY);
    }
    expect(routed.find(e => e.id === 'start-a')!.type).toBe('smoothstep');
    // A layout in one row leaves the edges as they are.
    const flat = layoutSteps(nodes, edges, 4000);
    expect(routeRowGaps(flat, flowEdges)).toBe(flowEdges);
  });

  it('lays out top to bottom without wrapping when asked', () => {
    const { nodes, edges } = chain(12);
    const layout = layoutSteps(nodes, edges, 600, { direction: 'TB' });
    expect(layout.wrapped).toBe(false);
    const xs = new Set([...layout.positions.values()].map(p => p.x));
    expect(xs.size).toBe(1);
    const at = (id: string) => layout.positions.get(id)!;
    expect(at('s1').y).toBeGreaterThan(at('start').y);
    expect(at('end').y).toBe(
      Math.max(...[...layout.positions.values()].map(p => p.y)),
    );
  });

  it('opens a narrow canvas at a readable size from the first step', () => {
    const { nodes, edges } = chain(12);
    const layout = layoutSteps(nodes, edges);
    const view = initialViewport(layout, { width: 600, height: 300 });
    expect(view.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(NODE_FONT_SIZE * view.zoom).toBeGreaterThanOrEqual(12);
    expect(view.x).toBe(0);
    // A small graph is centered at most at zoom 1.
    const short = chain(0);
    const small = layoutSteps(short.nodes, short.edges);
    const centered = initialViewport(small, { width: 1000, height: 300 });
    expect(centered.zoom).toBe(1);
    expect(centered.x).toBeGreaterThan(0);
  });
});

/** Margin of a laid out graph: its first step starts there. */
const marginOf = (layout: { positions: Map<string, { y: number }> }) =>
  Math.min(...[...layout.positions.values()].map(p => p.y));

describe('graphHeight', () => {
  it('follows the graph within limits', () => {
    const row = chain(2);
    const one = layoutSteps(row.nodes, row.edges, 1200);
    expect(graphHeight(one, 1200)).toBe(MIN_GRAPH_HEIGHT);
    const parallel = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const nodes = ['start', ...parallel, 'end'].map(id => node(id));
    const edges = edgesOf(
      ...parallel.flatMap(
        id =>
          [
            ['start', id],
            [id, 'end'],
          ] as [string, string][],
      ),
    );
    const tall = layoutSteps(nodes, edges, 1200);
    expect(graphHeight(tall, 1200)).toBe(MAX_GRAPH_HEIGHT);
    // Seven steps side by side: taller than the smallest area.
    const side = parallel.slice(0, 7);
    const seven = layoutSteps(
      ['start', ...side].map(id => node(id)),
      edgesOf(...side.map(id => ['start', id] as [string, string])),
      1200,
    );
    expect(graphHeight(seven, 1200)).toBeGreaterThan(MIN_GRAPH_HEIGHT);
    expect(graphHeight(seven, 1200)).toBeLessThan(MAX_GRAPH_HEIGHT);
  });

  it('gives a one-row graph at least 400px and centers it', () => {
    const row = chain(2);
    const one = layoutSteps(row.nodes, row.edges, 1200);
    expect(MIN_GRAPH_HEIGHT).toBeGreaterThanOrEqual(400);
    const height = graphHeight(one, 1200);
    const view = initialViewport(one, { width: 1200, height });
    // As much space above the steps as below them.
    const above = view.y + marginOf(one);
    const below = height - view.y - one.height * view.zoom + marginOf(one);
    expect(Math.abs(above - below)).toBeLessThan(1);
  });
});

describe('panIntoView', () => {
  it('moves a step outside the canvas into view and keeps the zoom', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const canvas = { width: 600, height: 300 };
    const next = panIntoView(view, { x: 900, y: 20 }, canvas);
    expect(next.zoom).toBe(1);
    expect(next.y).toBe(0);
    expect(900 + next.x + NODE_WIDTH).toBeLessThanOrEqual(canvas.width);
    expect(900 + next.x).toBeGreaterThanOrEqual(0);
    // Already in view: nothing moves.
    expect(panIntoView(view, { x: 100, y: 20 }, canvas)).toEqual(view);
  });
});

describe('keepInGraph', () => {
  it('keeps the first column in view after the panel narrows the canvas', () => {
    const { nodes, edges } = chain(12);
    // Laid out again for the canvas next to the panel.
    const canvas = { width: 700, height: 600 };
    const layout = layoutSteps(nodes, edges, canvas.width);
    expect(layout.width).toBeLessThanOrEqual(canvas.width);
    const last = layout.positions.get('end')!;
    const view = keepInGraph(
      panIntoView(initialViewport(layout, canvas), last, canvas),
      layout,
      canvas,
    );
    expect(view.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    for (const p of layout.positions.values()) {
      const left = p.x * view.zoom + view.x;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + NODE_WIDTH * view.zoom).toBeLessThanOrEqual(canvas.width);
    }
    // The first column keeps its margin.
    expect(view.x).toBeGreaterThanOrEqual(0);
  });

  it('does not pan past the edges of a graph larger than the canvas', () => {
    const layout = { width: 2000, height: 200 };
    const canvas = { width: 600, height: 300 };
    expect(keepInGraph({ x: 50, y: 0, zoom: 1 }, layout, canvas).x).toBe(0);
    expect(keepInGraph({ x: -1800, y: 0, zoom: 1 }, layout, canvas).x).toBe(
      -1400,
    );
    expect(keepInGraph({ x: -300, y: 0, zoom: 1 }, layout, canvas).x).toBe(
      -300,
    );
    // A graph that fits stays inside the canvas.
    expect(keepInGraph({ x: 0, y: 150, zoom: 1 }, layout, canvas).y).toBe(100);
  });
});

describe('visibleSteps', () => {
  it('leaves out markers and joins the arrows around them', () => {
    const nodes = [
      node('start'),
      marker('m1', 'SideEffect'),
      node('a'),
      marker('m2', 'Version'),
      marker('m3', 'core_patch'),
      node('b'),
      node('end'),
    ];
    const edges = edgesOf(
      ['start', 'm1'],
      ['m1', 'a'],
      ['a', 'm2'],
      ['m2', 'm3'],
      ['m3', 'b'],
      ['b', 'end'],
    );
    const hidden = visibleSteps(nodes, edges);
    expect(hidden.nodes.map(n => n.id)).toEqual(['start', 'a', 'b', 'end']);
    expect(pairs(hidden.edges)).toEqual(['start>a', 'a>b', 'b>end']);

    const shown = visibleSteps(nodes, edges, { showMarkers: true });
    expect(shown.nodes).toHaveLength(7);
    expect(pairs(shown.edges)).toEqual(pairs(edges));
  });

  it('keeps local activities, which are recorded as markers', () => {
    const nodes = [
      node('start'),
      node('la', {
        kind: 'marker',
        name: 'Local activity',
        details: { markerName: 'core_local_activity' },
      }),
    ];
    const edges = edgesOf(['start', 'la']);
    expect(visibleSteps(nodes, edges).nodes).toHaveLength(2);
  });

  it('drops a joined arrow when another path leads there', () => {
    // a > m > c and a > b > c: without m, a > c is not needed.
    const nodes = [node('a'), marker('m', 'SideEffect'), node('b'), node('c')];
    const edges = edgesOf(['a', 'm'], ['a', 'b'], ['m', 'c'], ['b', 'c']);
    expect(pairs(visibleSteps(nodes, edges).edges)).toEqual(['a>b', 'b>c']);
  });
});
