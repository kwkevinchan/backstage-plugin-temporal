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
  ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowGraphResponse } from '@kwkevinchan/backstage-plugin-temporal-common';
import { isOpenStep } from '../steps';
import { layoutSteps, NODE_HEIGHT, NODE_WIDTH, visibleSteps } from './layout';
import { StepFlowNode, StepNode } from './StepNode';
import { tp } from '../styles';

const nodeTypes = { step: StepNode };

/** Fits the steps, but not smaller than half size so names stay readable. */
const FIT_VIEW = { padding: 0.15, maxZoom: 1, minZoom: 0.5 };

export interface WorkflowGraphProps {
  graph: WorkflowGraphResponse;
  selectedId?: string;
  onSelect(id: string | undefined): void;
}

function GraphCanvas(props: WorkflowGraphProps) {
  const { graph, selectedId, onSelect } = props;
  const instance = useRef<ReactFlowInstance<StepFlowNode, Edge>>();

  // The layout depends on the structure only, not on the selection.
  const structure = useMemo(() => {
    const steps = visibleSteps(graph.nodes, graph.edges);
    return { ...steps, positions: layoutSteps(steps.nodes, steps.edges) };
  }, [graph]);

  const nodes: StepFlowNode[] = useMemo(
    () =>
      structure.nodes.map(step => ({
        id: step.id,
        type: 'step',
        position: structure.positions.get(step.id) ?? { x: 0, y: 0 },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        connectable: false,
        selectable: false,
        data: { step, selected: step.id === selectedId, onSelect },
      })),
    [structure, selectedId, onSelect],
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

  // Fit the view again when steps are added (auto refresh) and when the
  // step panel opens or closes, since the canvas changes its width.
  const count = structure.nodes.length;
  const panelOpen = selectedId !== undefined;
  useEffect(() => {
    const timer = window.setTimeout(
      () => instance.current?.fitView({ ...FIT_VIEW, duration: 200 }),
      50,
    );
    return () => window.clearTimeout(timer);
  }, [count, panelOpen]);

  return (
    <ReactFlow<StepFlowNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onInit={i => {
        instance.current = i;
      }}
      fitView
      fitViewOptions={FIT_VIEW}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

/**
 * The steps of a run as boxes and arrows. Colors follow the status;
 * running steps pulse, waiting steps are dashed and retried activities show
 * their attempt. The view can be zoomed, panned and fitted.
 */
export function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <div
      className={tp('tp-graph')}
      role="region"
      aria-label="Workflow graph"
      data-testid="workflow-graph"
    >
      <ReactFlowProvider>
        <GraphCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
