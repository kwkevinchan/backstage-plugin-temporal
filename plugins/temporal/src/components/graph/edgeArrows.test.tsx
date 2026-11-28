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

import { renderInTestApp } from '@backstage/test-utils';
import type { WorkflowGraphResponse } from '../../common';
import { llmGraphResponse } from '../../testData';
import { agentGraph } from '../../testGraphs/agentGraph';
import { loopGraph } from '../../testGraphs/loopGraph';
import { EDGE_ARROW_ID } from './GraphCanvas';
import { WorkflowGraph } from './WorkflowGraph';

const ARROW = `url('#${EDGE_ARROW_ID}')`;

/** Edges of the graph on screen, with the end marker of their line. */
function edgesOnScreen() {
  return [...document.querySelectorAll('.react-flow__edge')].map(edge => ({
    edge,
    marker: edge
      .querySelector('path.react-flow__edge-path')
      ?.getAttribute('marker-end'),
  }));
}

describe('arrowheads on the edges', () => {
  it('ends every plain edge in the arrowhead', async () => {
    await renderInTestApp(
      <WorkflowGraph graph={llmGraphResponse} onSelect={() => {}} />,
    );
    const edges = edgesOnScreen();
    expect(edges.length).toBeGreaterThan(0);
    for (const { edge, marker } of edges) {
      expect(edge).toHaveClass('react-flow__edge-smoothstep');
      expect(marker).toBe(ARROW);
    }
  });

  it('defines one arrowhead that takes the stroke of its edge', async () => {
    await renderInTestApp(
      <WorkflowGraph graph={llmGraphResponse} onSelect={() => {}} />,
    );
    const marker = document.getElementById(EDGE_ARROW_ID)!;
    expect(marker.tagName).toBe('marker');
    // The tip is the end of the edge, and the size does not follow the line.
    expect(marker).toHaveAttribute('markerUnits', 'userSpaceOnUse');
    expect(marker).toHaveAttribute('refX', '10');
    const shape = marker.querySelector('path')!;
    // The color comes from the stroke of the edge (see styles/graph.module.css),
    // so no color is set on the shape itself.
    expect(shape).not.toHaveAttribute('fill');
    expect(shape).not.toHaveAttribute('stroke');
    expect(shape).not.toHaveAttribute('style');
  });

  it('ends the arrows of edges with frames in the arrowhead, running ones too', async () => {
    const running: WorkflowGraphResponse = {
      ...loopGraph,
      status: 'Running',
      nodes: loopGraph.nodes.map(n =>
        n.id === 'activity-66' ? { ...n, status: 'Running' } : n,
      ),
    };
    await renderInTestApp(
      <WorkflowGraph graph={running} onSelect={() => {}} />,
    );
    const edges = edgesOnScreen();
    expect(
      edges.some(e => e.edge.classList.contains('react-flow__edge-frameEdge')),
    ).toBe(true);
    // The edge of a running step is drawn in its own style.
    expect(
      edges.some(e => /tp-edge-active/.test(e.edge.getAttribute('class')!)),
    ).toBe(true);
    for (const { marker } of edges) expect(marker).toBe(ARROW);
  });

  it('ends the dashed edges to tool calls in the arrowhead', async () => {
    await renderInTestApp(
      <WorkflowGraph
        graph={agentGraph}
        onSelect={() => {}}
        groupViews={{ 'label:loop:agent:1': true }}
      />,
    );
    const tools = [...document.querySelectorAll('.temporal-llm-tool-edge')];
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.getAttribute('class')).toMatch(/tp-edge-tool/);
      expect(
        tool
          .querySelector('path.react-flow__edge-path')
          ?.getAttribute('marker-end'),
      ).toBe(ARROW);
    }
  });
});
