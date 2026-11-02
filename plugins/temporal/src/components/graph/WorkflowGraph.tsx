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

import { useCallback, useMemo, useState } from 'react';
import { Edge, ReactFlowProvider } from '@xyflow/react';
import type { WorkflowGraphResponse } from '../../common';
import { Button, ButtonIcon, Flex, Switch, Text } from '@backstage/ui';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { isMarkerStep, isOpenStep } from '../steps';
import { graphHeight, layoutSteps, stepSize, visibleSteps } from './layout';
import {
  flowNodeBase,
  GraphCanvas,
  RELAYOUT_DELAY_MS,
  useSettledWidth,
  ViewButtons,
} from './GraphCanvas';
import { StepFlowNode, StepNode } from './StepNode';
import { LoopFlowNode, LoopNode } from './LoopNode';
import {
  groupLoops,
  isLoopBoxNode,
  LoopBox,
  LoopView,
  LoopViews,
  shownRound,
} from './loops';
import { loopStatusLabel, roundLabel } from '../loopText';
import { tp } from '../styles';

const nodeTypes = { step: StepNode, loop: LoopNode };
type FlowNode = StepFlowNode | LoopFlowNode;

export { RELAYOUT_DELAY_MS, useSettledWidth } from './GraphCanvas';

export interface WorkflowGraphProps {
  graph: WorkflowGraphResponse;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  /** Shows markers (side effects, version and patch markers). */
  showMarkers?: boolean;
  onShowMarkersChange?(show: boolean): void;
  /**
   * How each loop is shown (collapsed by default). Without it the graph
   * keeps the views itself.
   */
  loopViews?: LoopViews;
  onLoopViewChange?(name: string, view: LoopView): void;
  /**
   * True while the step panel is open next to the graph. When it opens or
   * closes, the graph is laid out for the new width at once, before the
   * browser paints, instead of after the resize delay.
   */
  panelOpen?: boolean;
}

type Structure = ReturnType<typeof useStructure>;

function useStructure(
  graph: WorkflowGraphResponse,
  showMarkers: boolean,
  layoutWidth: number | undefined,
  loopViews: LoopViews,
) {
  return useMemo(() => {
    const visible = visibleSteps(graph.nodes, graph.edges, { showMarkers });
    const steps = groupLoops(
      visible.nodes,
      visible.edges,
      graph.loops,
      loopViews,
    );
    // Tool calls hang off the model call that asked for them, also when
    // the time order would draw the arrow from another step.
    const toolEdges = new Set<string>();
    const shown = new Set(steps.nodes.map(n => n.id));
    for (const node of steps.nodes) {
      if (isLoopBoxNode(node) || !node.tool?.llmNodeId) continue;
      const source = node.tool.llmNodeId;
      if (!shown.has(source)) continue;
      const id = `${source}->${node.id}`;
      toolEdges.add(id);
      if (!steps.edges.some(e => e.id === id)) {
        steps.edges = [...steps.edges, { id, source, target: node.id }];
      }
    }
    const sized = steps.nodes.some(n => !isLoopBoxNode(n) && (n.llm || n.tool));
    const layout = layoutSteps(
      sized
        ? steps.nodes.map(n => ({
            id: n.id,
            size: isLoopBoxNode(n) ? undefined : stepSize(n),
          }))
        : steps.nodes,
      steps.edges,
      layoutWidth,
    );
    // A new layout key when a loop opens, closes or shows another round.
    const loopKey = steps.boxes
      .map(b => `${b.id}:${b.expanded ? b.round?.iteration : '-'}`)
      .join(',');
    return {
      ...steps,
      layout,
      toolEdges,
      key: `${steps.nodes.length}:${steps.edges.length}:${layout.width}x${layout.height}:${loopKey}`,
    };
  }, [graph, showMarkers, layoutWidth, loopViews]);
}

function StepCanvas(
  props: WorkflowGraphProps & {
    structure: Structure;
    layoutWidth?: number;
    onToggleLoop(name: string): void;
  },
) {
  const { structure, selectedId, onSelect, onToggleLoop } = props;
  const { layout } = structure;
  const running = props.graph.status === 'Running';
  const nodes: FlowNode[] = useMemo(
    () =>
      structure.nodes.map((step): FlowNode => {
        const common = flowNodeBase(layout, step.id);
        if (isLoopBoxNode(step)) {
          return {
            ...common,
            type: 'loop',
            data: {
              box: step.loopBox,
              active: running && step.loopBox.loop.status === 'running',
              selected: step.id === selectedId,
              onToggle: onToggleLoop,
            },
          };
        }
        return {
          ...common,
          type: 'step',
          data: { step, selected: step.id === selectedId, onSelect },
        };
      }),
    [structure, layout, selectedId, onSelect, onToggleLoop, running],
  );

  const edges: Edge[] = useMemo(() => {
    const open = new Set(
      structure.nodes
        .filter(n =>
          isLoopBoxNode(n)
            ? running &&
              !n.loopBox.expanded &&
              n.loopBox.loop.status === 'running'
            : isOpenStep(n),
        )
        .map(n => n.id),
    );
    return structure.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      // Arrows into open steps move, like the step itself.
      animated: open.has(e.target),
      className:
        [
          open.has(e.target) ? tp('tp-edge-active') : '',
          // A plain class too, for tests and custom styles.
          structure.toolEdges.has(e.id)
            ? `${tp('tp-edge-tool')} temporal-llm-tool-edge`
            : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined,
      focusable: false,
    }));
  }, [structure, running]);

  return (
    <GraphCanvas<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      layout={layout}
      layoutKey={structure.key}
      layoutWidth={props.layoutWidth}
      selectedId={selectedId}
      onSelect={onSelect}
      // Loop boxes open and close from their own button.
      selectable={node => node.type !== 'loop'}
    />
  );
}

/**
 * Controls of one loop above the graph: expand or collapse it, and step
 * through its rounds.
 */
function LoopControls(props: { box: LoopBox; onChange(view: LoopView): void }) {
  const { box, onChange } = props;
  const { loop } = box;
  const rounds = loop.rounds;
  const current = box.round ?? rounds[rounds.length - 1];
  const index = current ? rounds.indexOf(current) : -1;
  const go = (to: number) =>
    onChange({ expanded: true, iteration: rounds[to].iteration });
  return (
    <div
      className={tp('tp-loop-controls')}
      role="group"
      aria-label={`Loop ${loop.name}`}
      data-testid={`loop-controls-${loop.name}`}
    >
      <span className={tp('tp-loop-controls-name')}>{loop.name}</span>
      <ButtonIcon
        size="small"
        variant="tertiary"
        icon={<RiArrowLeftSLine />}
        aria-label="Previous round"
        isDisabled={index <= 0}
        onPress={() => go(index - 1)}
      />
      <Text as="span" variant="body-small" data-testid="loop-round">
        {current ? roundLabel(current.iteration, loop) : 'No rounds'}
        {!box.expanded && ` · ${loopStatusLabel(loop.status)}`}
      </Text>
      <ButtonIcon
        size="small"
        variant="tertiary"
        icon={<RiArrowRightSLine />}
        aria-label="Next round"
        isDisabled={index < 0 || index >= rounds.length - 1}
        onPress={() => go(index + 1)}
      />
      <Button
        size="small"
        variant="secondary"
        isDisabled={!current}
        onPress={() =>
          onChange(
            box.expanded
              ? { expanded: false, iteration: current?.iteration }
              : { expanded: true, iteration: current?.iteration },
          )
        }
      >
        {box.expanded ? 'Collapse' : 'Expand'}
      </Button>
    </div>
  );
}

function GraphToolbar(props: {
  structure: Structure;
  hasMarkers: boolean;
  showMarkers: boolean;
  onShowMarkersChange?(show: boolean): void;
  selectedId?: string;
  onLoopViewChange(name: string, view: LoopView): void;
}) {
  const { structure } = props;
  return (
    <Flex
      className={tp('tp-graph-toolbar')}
      align="center"
      justify="end"
      gap="2"
    >
      {structure.boxes.map(box => (
        <LoopControls
          key={box.id}
          box={box}
          onChange={view => props.onLoopViewChange(box.loop.name, view)}
        />
      ))}
      {props.hasMarkers && props.onShowMarkersChange && (
        <Switch
          label="Show markers"
          isSelected={props.showMarkers}
          onChange={props.onShowMarkersChange}
        />
      )}
      <ViewButtons layout={structure.layout} selectedId={props.selectedId} />
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
  const [areaRef, layoutWidth] = useSettledWidth(
    RELAYOUT_DELAY_MS,
    props.panelOpen,
  );
  const [ownViews, setOwnViews] = useState<LoopViews>({});
  const loopViews = props.loopViews ?? ownViews;
  const { onLoopViewChange } = props;
  const changeLoopView = useCallback(
    (name: string, view: LoopView) => {
      if (onLoopViewChange) onLoopViewChange(name, view);
      else setOwnViews(views => ({ ...views, [name]: view }));
    },
    [onLoopViewChange],
  );
  const loops = props.graph.loops;
  const toggleLoop = useCallback(
    (name: string) => {
      const loop = loops?.find(l => l.name === name);
      if (!loop) return;
      const view = loopViews[name];
      const round = shownRound(loop, view);
      changeLoopView(name, {
        expanded: !view?.expanded,
        iteration: round?.iteration,
      });
    },
    [loops, loopViews, changeLoopView],
  );
  const structure = useStructure(
    props.graph,
    showMarkers,
    layoutWidth,
    loopViews,
  );
  const hasMarkers = props.graph.nodes.some(isMarkerStep);
  const minHeight = graphHeight(
    structure.layout,
    layoutWidth ?? structure.layout.width,
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
          onLoopViewChange={changeLoopView}
        />
        <div
          ref={areaRef}
          className={tp('tp-graph')}
          style={{ minHeight }}
          role="region"
          aria-label="Workflow graph"
          data-testid="workflow-graph"
        >
          <div className={tp('tp-graph-canvas')}>
            <StepCanvas
              {...props}
              structure={structure}
              layoutWidth={layoutWidth}
              onToggleLoop={toggleLoop}
            />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
