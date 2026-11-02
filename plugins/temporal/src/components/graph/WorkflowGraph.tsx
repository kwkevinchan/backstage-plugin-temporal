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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { Button, ButtonIcon, Flex, Switch, Text } from '@backstage/ui';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { isMarkerStep, isOpenStep } from '../steps';
import {
  graphHeight,
  initialViewport,
  keepInGraph,
  layoutSteps,
  NODE_HEIGHT,
  NODE_WIDTH,
  panIntoView,
  visibleSteps,
} from './layout';
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

/** Zoom limits for zooming by hand; the views the graph opens with stay readable. */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
/**
 * Time the graph area keeps its width before the graph is laid out again
 * for it, so resizing the window or the step panel does not re-layout on
 * every frame.
 */
export const RELAYOUT_DELAY_MS = 150;

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
    const layout = layoutSteps(steps.nodes, steps.edges, layoutWidth);
    // A new layout key when a loop opens, closes or shows another round.
    const loopKey = steps.boxes
      .map(b => `${b.id}:${b.expanded ? b.round?.iteration : '-'}`)
      .join(',');
    return {
      ...steps,
      layout,
      key: `${steps.nodes.length}:${steps.edges.length}:${layout.width}x${layout.height}:${loopKey}`,
    };
  }, [graph, showMarkers, layoutWidth, loopViews]);
}

function GraphCanvas(
  props: WorkflowGraphProps & {
    structure: Structure;
    layoutWidth?: number;
    onToggleLoop(name: string): void;
  },
) {
  const { structure, selectedId, onSelect, onToggleLoop } = props;
  const { layout } = structure;
  const flow = useReactFlow<FlowNode, Edge>();
  const width = useStore(s => s.width);
  const height = useStore(s => s.height);
  const zoom = useStore(s => s.transform[2]);

  const running = props.graph.status === 'Running';
  const nodes: FlowNode[] = useMemo(
    () =>
      structure.nodes.map((step): FlowNode => {
        const common = {
          id: step.id,
          position: layout.positions.get(step.id) ?? { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          draggable: false,
          connectable: false,
          selectable: false,
        };
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
      className: open.has(e.target) ? tp('tp-edge-active') : undefined,
      focusable: false,
    }));
  }, [structure, running]);

  // The view the graph opens with, again when the layout changes (steps
  // added by auto refresh) or the graph area gets narrower or wider (the
  // step panel opened or closed). The selected step is moved into view, without
  // cutting off the first column. While the area changes width a new layout
  // follows, so the view waits for it.
  const applied = useRef<{
    key?: string;
    selectedId?: string;
    width?: number;
  }>({});
  const selectedPosition = selectedId
    ? layout.positions.get(selectedId)
    : undefined;
  const relayoutPending =
    props.layoutWidth !== undefined && Math.abs(width - props.layoutWidth) > 1;
  useEffect(() => {
    if (!width || !height || relayoutPending) return undefined;
    const last = applied.current;
    // A new layout, or the same one in an area of another width.
    const relayout =
      last.key !== structure.key ||
      last.width === undefined ||
      Math.abs(last.width - width) > 1;
    if (!relayout && last.selectedId === selectedId) return undefined;
    const first = last.key === undefined;
    const run = () => {
      applied.current = { key: structure.key, selectedId, width };
      const canvas = { width, height };
      const current = flow.getViewport();
      let next = relayout ? initialViewport(layout, canvas) : current;
      if (selectedPosition) {
        next = panIntoView(next, selectedPosition, canvas);
      }
      next = keepInGraph(next, layout, canvas);
      if (
        next.x !== current.x ||
        next.y !== current.y ||
        next.zoom !== current.zoom
      ) {
        flow.setViewport(next, { duration: first ? 0 : 200 });
      }
    };
    if (first) {
      run();
      return undefined;
    }
    // The canvas height follows the new layout a moment later.
    const timer = window.setTimeout(run, 50);
    return () => window.clearTimeout(timer);
  }, [
    flow,
    structure.key,
    layout,
    width,
    height,
    selectedId,
    selectedPosition,
    relayoutPending,
  ]);

  // Wheel scrolling pans a graph larger than its area; otherwise it
  // scrolls the page.
  const overflows =
    layout.width * zoom > width + 1 || layout.height * zoom > height + 1;

  return (
    <ReactFlow<FlowNode, Edge>
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
      onNodeClick={(_, node) => {
        // Loop boxes open and close from their own button.
        if (node.type !== 'loop') onSelect(node.id);
      }}
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
      <Button
        size="small"
        variant="secondary"
        onPress={() => {
          const view = initialViewport(structure.layout, { width, height });
          const position = props.selectedId
            ? structure.layout.positions.get(props.selectedId)
            : undefined;
          const canvas = { width, height };
          flow.setViewport(
            keepInGraph(
              position ? panIntoView(view, position, canvas) : view,
              structure.layout,
              canvas,
            ),
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
            <GraphCanvas
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

/**
 * A ref callback and the width of its element. The first width is taken
 * at once; later changes once the width has stayed the same for `delay`
 * milliseconds, so a width that is still changing (window resize) is laid
 * out only once. When `trigger` changes (the step panel opened or closed),
 * the width is read again at once, before the browser paints: the panel
 * changes the width in one step, and waiting would show the old layout
 * under the panel until the delay ends (longer while a large payload in
 * the panel renders).
 */
export function useSettledWidth(
  delay: number,
  trigger?: unknown,
): [(element: HTMLElement | null) => void, number?] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>();
  const firstTrigger = useRef(true);
  useLayoutEffect(() => {
    if (firstTrigger.current) {
      firstTrigger.current = false;
      return;
    }
    const next = element?.clientWidth || undefined;
    if (next !== undefined) {
      setWidth(last =>
        last !== undefined && Math.abs(next - last) < 1 ? last : next,
      );
    }
  }, [trigger, element]);
  useEffect(() => {
    if (!element) return undefined;
    const read = () => element.clientWidth || undefined;
    setWidth(read());
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = read();
        setWidth(last =>
          next !== undefined && last !== undefined && Math.abs(next - last) < 1
            ? last
            : next,
        );
      }, delay);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [element, delay]);
  return [setElement, width];
}
