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

import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  Edge,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowGraphResponse } from '@kwkevinchan/backstage-plugin-temporal-common';
import { Button, Flex, Switch } from '@backstage/ui';
import { isMarkerStep, isOpenStep } from '../steps';
import {
  graphHeight,
  initialViewport,
  layoutSteps,
  NODE_HEIGHT,
  NODE_WIDTH,
  panIntoView,
  visibleSteps,
} from './layout';
import { StepFlowNode, StepNode } from './StepNode';
import { tp } from '../styles';

const nodeTypes = { step: StepNode };

/** Zoom limits for zooming by hand; the views the graph opens with stay readable. */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;

export interface WorkflowGraphProps {
  graph: WorkflowGraphResponse;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  /**
   * Width the graph is laid out for, usually the width of the graph area
   * without the step panel. Wider graphs wrap into more rows.
   */
  layoutWidth?: number;
  /** Shows markers (side effects, version and patch markers). */
  showMarkers?: boolean;
  onShowMarkersChange?(show: boolean): void;
}

type Structure = ReturnType<typeof useStructure>;

function useStructure(
  graph: WorkflowGraphResponse,
  showMarkers: boolean,
  layoutWidth: number | undefined,
) {
  return useMemo(() => {
    const steps = visibleSteps(graph.nodes, graph.edges, { showMarkers });
    const layout = layoutSteps(steps.nodes, steps.edges, layoutWidth);
    return {
      ...steps,
      layout,
      key: `${steps.nodes.length}:${steps.edges.length}:${layout.width}x${layout.height}`,
    };
  }, [graph, showMarkers, layoutWidth]);
}

function GraphCanvas(props: WorkflowGraphProps & { structure: Structure }) {
  const { structure, selectedId, onSelect } = props;
  const { layout } = structure;
  const flow = useReactFlow<StepFlowNode, Edge>();
  const width = useStore(s => s.width);
  const height = useStore(s => s.height);
  const zoom = useStore(s => s.transform[2]);

  const nodes: StepFlowNode[] = useMemo(
    () =>
      structure.nodes.map(step => ({
        id: step.id,
        type: 'step',
        position: layout.positions.get(step.id) ?? { x: 0, y: 0 },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        connectable: false,
        selectable: false,
        data: { step, selected: step.id === selectedId, onSelect },
      })),
    [structure, layout, selectedId, onSelect],
  );

  const edges: Edge[] = useMemo(() => {
    const open = new Set(structure.nodes.filter(isOpenStep).map(n => n.id));
    return structure.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      // Arrows into open steps move, like the step itself.
      animated: open.has(e.target),
      className: open.has(e.target) ? tp('tp-edge-active') : undefined,
      focusable: false,
    }));
  }, [structure]);

  // The view the graph opens with, again when steps are added (auto
  // refresh) or the layout changes. With the step panel open the view is
  // left alone; the selected step is moved into view below.
  const applied = useRef<string>();
  const panelOpen = selectedId !== undefined;
  useEffect(() => {
    if (!width || !height || applied.current === structure.key) return;
    const first = applied.current === undefined;
    applied.current = structure.key;
    if (panelOpen && !first) return;
    flow.setViewport(initialViewport(layout, { width, height }), {
      duration: first ? 0 : 200,
    });
  }, [flow, structure.key, layout, width, height, panelOpen]);

  // Opening the panel makes the canvas narrower: the zoom stays and the
  // selected step is panned into view.
  const selectedPosition = selectedId
    ? layout.positions.get(selectedId)
    : undefined;
  useEffect(() => {
    if (!selectedPosition || !width || !height) return undefined;
    const timer = window.setTimeout(() => {
      const current = flow.getViewport();
      const next = panIntoView(current, selectedPosition, { width, height });
      if (next.x !== current.x || next.y !== current.y) {
        flow.setViewport(next, { duration: 200 });
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [flow, selectedPosition, width, height]);

  // Wheel scrolling pans a graph larger than its area; otherwise it
  // scrolls the page.
  const overflows =
    layout.width * zoom > width + 1 || layout.height * zoom > height + 1;

  return (
    <ReactFlow<StepFlowNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      zoomOnScroll={false}
      panOnScroll={overflows}
      preventScrolling={overflows}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls
        showInteractive={false}
        showFitView={false}
        orientation="horizontal"
        position="bottom-right"
      />
    </ReactFlow>
  );
}

function GraphToolbar(props: {
  structure: Structure;
  hasMarkers: boolean;
  showMarkers: boolean;
  onShowMarkersChange?(show: boolean): void;
  selectedId?: string;
}) {
  const { structure } = props;
  const flow = useReactFlow();
  const width = useStore(s => s.width);
  const height = useStore(s => s.height);
  return (
    <Flex
      className={tp('tp-graph-toolbar')}
      align="center"
      justify="end"
      gap="2"
    >
      {props.hasMarkers && props.onShowMarkersChange && (
        <Switch
          label="Show markers"
          isSelected={props.showMarkers}
          onChange={props.onShowMarkersChange}
        />
      )}
      <Button
        size="small"
        variant="secondary"
        onPress={() => {
          const view = initialViewport(structure.layout, { width, height });
          const position = props.selectedId
            ? structure.layout.positions.get(props.selectedId)
            : undefined;
          flow.setViewport(
            position ? panIntoView(view, position, { width, height }) : view,
            { duration: 200 },
          );
        }}
      >
        Readable size
      </Button>
      <Button
        size="small"
        variant="secondary"
        onPress={() =>
          flow.fitView({
            padding: 0.05,
            minZoom: MIN_ZOOM,
            maxZoom: 1,
            duration: 200,
          })
        }
      >
        Whole graph
      </Button>
    </Flex>
  );
}

/**
 * The steps of a run as boxes and arrows. Colors follow the status;
 * running steps pulse, waiting steps are dashed and retried activities show
 * their attempt. The graph opens at a readable size, starting at its first
 * step; long runs wrap into rows, the rest can be panned to, and
 * "Whole graph" zooms out to show every step.
 */
export function WorkflowGraph(props: WorkflowGraphProps) {
  const showMarkers = props.showMarkers ?? false;
  const structure = useStructure(props.graph, showMarkers, props.layoutWidth);
  const hasMarkers = props.graph.nodes.some(isMarkerStep);
  const minHeight = graphHeight(
    structure.layout,
    props.layoutWidth ?? structure.layout.width,
  );
  return (
    <ReactFlowProvider>
      <div className={tp('tp-graph-column')}>
        <GraphToolbar
          structure={structure}
          hasMarkers={hasMarkers}
          showMarkers={showMarkers}
          onShowMarkersChange={props.onShowMarkersChange}
          selectedId={props.selectedId}
        />
        <div
          className={tp('tp-graph')}
          style={{ minHeight }}
          role="region"
          aria-label="Workflow graph"
          data-testid="workflow-graph"
        >
          <div className={tp('tp-graph-canvas')}>
            <GraphCanvas {...props} structure={structure} />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
