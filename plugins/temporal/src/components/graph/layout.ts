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

import dagre from '@dagrejs/dagre';
import type {
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '@kwkevinchan/backstage-plugin-temporal-common';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;

/** Steps shown in the graph: internal steps are left out. */
export function visibleSteps(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
) {
  const shown = nodes.filter(n => !n.internal);
  const ids = new Set(shown.map(n => n.id));
  return {
    nodes: shown,
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)),
  };
}

/**
 * Positions of the steps, left to right, laid out with dagre (layered
 * graph drawing). Parallel steps end up in the same column.
 */
export function layoutSteps(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 24,
    ranksep: 56,
    marginx: 16,
    marginy: 16,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const placed = graph.node(node.id) as { x: number; y: number } | undefined;
    // dagre returns the center; React Flow expects the top left corner.
    positions.set(node.id, {
      x: (placed?.x ?? 0) - NODE_WIDTH / 2,
      y: (placed?.y ?? 0) - NODE_HEIGHT / 2,
    });
  }
  return positions;
}
