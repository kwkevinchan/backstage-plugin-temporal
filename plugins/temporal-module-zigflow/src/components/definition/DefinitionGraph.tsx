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

import { ReactNode, useMemo } from 'react';
import { Edge, MarkerType, ReactFlowProvider } from '@xyflow/react';
import { Flex } from '@backstage/ui';
import {
  flowNodeBase,
  GraphCanvas,
  graphHeight,
  layoutSteps,
  RELAYOUT_DELAY_MS,
  useGraphFullscreen,
  useSettledWidth,
  ViewButtons,
} from '@kwkevinchan/backstage-plugin-temporal/ui';
import { tp } from '../styles';

import { DefinitionFlowNode, DefinitionNode } from './DefinitionNode';
import type { DefinitionGraph as Graph } from './dslGraph';
import type { DefinitionOverlay } from './overlay';

const nodeTypes = { task: DefinitionNode };

export interface DefinitionGraphProps {
  graph: Graph;
  overlay?: DefinitionOverlay;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  /** Shown left of the view buttons. */
  toolbar?: ReactNode;
}

/**
 * The tasks of a definition as boxes and arrows, laid out and drawn like
 * the step graph of a run. With an overlay, the boxes take the colors of
 * the run: done, running, failed, not reached.
 */
export function DefinitionGraph(props: DefinitionGraphProps) {
  const { graph, overlay, selectedId, onSelect } = props;
  const [areaRef, layoutWidth] = useSettledWidth(RELAYOUT_DELAY_MS);
  const layout = useMemo(
    () =>
      layoutSteps(graph.nodes, graph.edges, layoutWidth, { direction: 'TB' }),
    [graph, layoutWidth],
  );
  const layoutKey = `${graph.nodes.length}:${graph.edges.length}:${layout.width}x${layout.height}`;

  const nodes: DefinitionFlowNode[] = useMemo(
    () =>
      graph.nodes.map(node => ({
        ...flowNodeBase(layout, node.id),
        type: 'task' as const,
        data: {
          node,
          mark:
            node.pointer && node.id === node.pointer
              ? overlay?.marks.get(node.pointer)
              : undefined,
          selected: node.id === selectedId,
          onSelect,
        },
      })),
    [graph, layout, overlay, selectedId, onSelect],
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        label: edge.label,
        // Theme tokens, so labels follow the light and the dark theme.
        labelStyle: {
          fill: 'var(--bui-fg-secondary)',
          fontFamily: 'var(--bui-font-regular)',
          fontSize: 12,
        },
        labelBgStyle: { fill: 'var(--bui-bg-neutral-1)' },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: `${tp(`tp-def-edge-${edge.kind}`)} temporal-definition-edge`,
        focusable: false,
      })),
    [graph],
  );

  const fullscreen = useGraphFullscreen();
  const minHeight = graphHeight(layout, layoutWidth ?? layout.width);
  return (
    <ReactFlowProvider>
      <div className={tp('tp-graph-column')}>
        <Flex
          className={tp('tp-graph-toolbar')}
          align="center"
          justify="end"
          gap="2"
        >
          {props.toolbar}
          <ViewButtons layout={layout} selectedId={selectedId} />
        </Flex>
        <div
          ref={areaRef}
          className={tp('tp-graph')}
          // Full screen: the graph takes the height of the window instead.
          style={fullscreen?.fullscreen ? undefined : { minHeight }}
          role="region"
          aria-label="Definition graph"
          data-testid="definition-graph"
        >
          <div className={tp('tp-graph-canvas')}>
            <GraphCanvas<DefinitionFlowNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              layout={layout}
              layoutKey={layoutKey}
              layoutWidth={layoutWidth}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
