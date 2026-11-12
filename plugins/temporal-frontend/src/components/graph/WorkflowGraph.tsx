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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Edge, ReactFlowProvider } from '@xyflow/react';
import type {
  WorkflowGraphEdge,
  WorkflowGraphResponse,
} from '../../common';
import { Button, Flex, Switch, Text } from '@backstage/ui';
import { isMarkerStep, isOpenStep } from '../steps';
import {
  graphHeight,
  layoutSteps,
  NodeSize,
  stepSize,
  visibleSteps,
} from './layout';
import {
  LoopBlockLayout,
  layoutLoopBlock,
  noteAfterId,
  noteBeforeId,
  placeLoopBlocks,
} from './loopLayout';
import {
  flowNodeBase,
  GraphCanvas,
  RELAYOUT_DELAY_MS,
  useSettledWidth,
  useGraphFullscreen,
  ViewButtons,
} from './GraphCanvas';
import { StepFlowNode, StepNode } from './StepNode';
import {
  LoopFlowNode,
  LoopNode,
  LoopNoteFlowNode,
  LoopNoteNode,
  RoundFrameFlowNode,
  RoundFrameNode,
} from './LoopNode';
import {
  focusFrame,
  groupLoops,
  isLoopBoxNode,
  LoopBox,
  LoopView,
  LoopViews,
} from './loops';
import { loopStatusLabel, roundLabel, roundsText } from '../loopText';
import { tp } from '../styles';

const nodeTypes = {
  step: StepNode,
  loop: LoopNode,
  round: RoundFrameNode,
  loopNote: LoopNoteNode,
};
type FlowNode =
  | StepFlowNode
  | LoopFlowNode
  | RoundFrameFlowNode
  | LoopNoteFlowNode;

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

/** Space the main graph keeps around an expanded loop when it wraps. */
const BLOCK_MARGIN = 32;

function useStructure(
  graph: WorkflowGraphResponse,
  showMarkers: boolean,
  layoutWidth: number | undefined,
  loopViews: LoopViews,
) {
  return useMemo(() => {
    const visible = visibleSteps(graph.nodes, graph.edges, { showMarkers });
    // Tool calls hang off the model call that asked for them, also when
    // the time order would draw the arrow from another step.
    const toolEdges = new Set<string>();
    const shown = new Set(visible.nodes.map(n => n.id));
    const visibleEdges: WorkflowGraphEdge[] = [...visible.edges];
    for (const node of visible.nodes) {
      if (!node.tool?.llmNodeId) continue;
      const source = node.tool.llmNodeId;
      if (!shown.has(source)) continue;
      const id = `${source}->${node.id}`;
      toolEdges.add(id);
      if (!visibleEdges.some(e => e.id === id)) {
        visibleEdges.push({ id, source, target: node.id });
      }
    }
    const steps = groupLoops(
      visible.nodes,
      visibleEdges,
      graph.loops,
      loopViews,
      { previousRun: Boolean(graph.runChain?.previousRunId) },
    );
    const sized =
      steps.boxes.some(b => b.expanded) ||
      visible.nodes.some(n => n.llm || n.tool);
    const sizeOf = (n: (typeof visible.nodes)[number]) =>
      sized ? stepSize(n) : undefined;

    // Expanded loops first: each is one large box of the main graph.
    const blocks = new Map<string, LoopBlockLayout>();
    const nextRun = graph.runChain?.index
      ? graph.runChain.index + 1
      : undefined;
    for (const box of steps.boxes.filter(b => b.expanded)) {
      blocks.set(
        box.id,
        layoutLoopBlock(
          {
            id: box.id,
            frames: box.frames.map(frame => ({
              id: frame.id,
              steps: (steps.frameSteps.get(frame.id) ?? []).map(n => ({
                id: n.id,
                size: sizeOf(n),
              })),
              edges: steps.frameEdges.get(frame.id) ?? [],
            })),
            noteBefore: box.fromEarlierRun,
            noteAfter: box.loop.status === 'continued',
          },
          layoutWidth !== undefined
            ? Math.max(0, layoutWidth - 2 * BLOCK_MARGIN)
            : undefined,
        ),
      );
    }
    const main = layoutSteps(
      steps.nodes.map(n => {
        const block = blocks.get(n.id);
        let size: NodeSize | undefined;
        if (block) size = { width: block.width, height: block.height };
        else if (!isLoopBoxNode(n)) size = sizeOf(n);
        return size ? { id: n.id, size } : { id: n.id };
      }),
      steps.edges,
      layoutWidth,
    );
    const layout = placeLoopBlocks(main, blocks);
    // A new layout key when a loop opens or closes.
    const loopKey = steps.boxes
      .map(b => `${b.id}:${b.expanded ? b.frames.length : '-'}`)
      .join(',');
    return {
      ...steps,
      layout,
      toolEdges,
      nextRun,
      key: `${steps.nodes.length}:${steps.edges.length}:${layout.width}x${layout.height}:${loopKey}`,
    };
  }, [graph, showMarkers, layoutWidth, loopViews]);
}

/** Text of the notes above the first round frame and below the last. */
function noteText(box: LoopBox, nextRun?: number) {
  const first = box.frames[0]?.round.iteration ?? 1;
  return {
    before:
      first > 2
        ? `↑ Rounds 1–${first - 1} ran in earlier runs`
        : '↑ Round 1 ran in the run before',
    after: nextRun
      ? `↓ The loop continues in run ${nextRun}`
      : '↓ The loop continues in the next run',
  };
}

function StepCanvas(
  props: WorkflowGraphProps & {
    structure: Structure;
    layoutWidth?: number;
    onToggleLoop(name: string): void;
    focusId?: string;
  },
) {
  const { structure, selectedId, onSelect, onToggleLoop, focusId } = props;
  const { layout } = structure;
  const running = props.graph.status === 'Running';
  const nodes: FlowNode[] = useMemo(() => {
    // Frames and notes first: they are drawn under the steps.
    const under: FlowNode[] = [];
    const over: FlowNode[] = [];
    for (const step of structure.nodes) {
      const common = flowNodeBase(layout, step.id);
      if (isLoopBoxNode(step)) {
        const box = step.loopBox;
        over.push({
          ...common,
          type: 'loop',
          data: {
            box,
            active: running && box.loop.status === 'running',
            selected: step.id === selectedId,
            onToggle: onToggleLoop,
          },
        });
        if (!box.expanded) continue;
        const notes = noteText(box, structure.nextRun);
        if (box.fromEarlierRun) {
          under.push({
            ...flowNodeBase(layout, noteBeforeId(box.id)),
            type: 'loopNote',
            data: {
              text: notes.before,
              testId: `loop-note-before-${box.loop.name}`,
            },
          });
        }
        if (box.loop.status === 'continued') {
          under.push({
            ...flowNodeBase(layout, noteAfterId(box.id)),
            type: 'loopNote',
            data: {
              text: notes.after,
              testId: `loop-note-after-${box.loop.name}`,
            },
          });
        }
        for (const frame of box.frames) {
          const frameSteps = structure.frameSteps.get(frame.id) ?? [];
          under.push({
            ...flowNodeBase(layout, frame.id),
            type: 'round',
            data: {
              loop: box.loop,
              round: frame.round,
              focused: frame.id === focusId,
              active: running && frame.round.status === 'Running',
              empty: frameSteps.length === 0,
            },
          });
          for (const member of frameSteps) {
            over.push({
              ...flowNodeBase(layout, member.id),
              type: 'step',
              data: {
                step: member,
                selected: member.id === selectedId,
                onSelect,
              },
            });
          }
        }
        continue;
      }
      over.push({
        ...common,
        type: 'step',
        data: {
          step,
          selected: step.id === selectedId,
          onSelect,
          nextRun:
            step.kind === 'workflowClosed' ? structure.nextRun : undefined,
        },
      });
    }
    return [...under, ...over];
  }, [structure, layout, selectedId, onSelect, onToggleLoop, running, focusId]);

  const edges: Edge[] = useMemo(() => {
    const expanded = new Map(
      structure.boxes.filter(b => b.expanded).map(b => [b.id, b]),
    );
    const open = new Set<string>();
    for (const n of structure.nodes) {
      if (isLoopBoxNode(n)) {
        const box = n.loopBox;
        if (!running) continue;
        if (!box.expanded && box.loop.status === 'running') open.add(n.id);
        for (const f of box.frames) {
          if (f.round.status === 'Running') open.add(f.id);
        }
      } else if (isOpenStep(n)) {
        open.add(n.id);
      }
    }
    for (const steps of structure.frameSteps.values()) {
      for (const n of steps) if (isOpenStep(n)) open.add(n.id);
    }
    const toFlow = (
      e: { id: string; source: string; target: string },
      handles: { sourceHandle?: string; targetHandle?: string } = {},
    ): Edge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...handles,
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
    });
    const result: Edge[] = [];
    // Arrows of the main graph; those of an expanded loop go into its
    // first round and out of its last one.
    for (const e of structure.edges) {
      const from = expanded.get(e.source);
      const into = expanded.get(e.target);
      const source = from ? from.frames[from.frames.length - 1].id : e.source;
      const target = into ? into.frames[0].id : e.target;
      result.push(
        toFlow(
          { id: e.id, source, target },
          {
            sourceHandle: from ? 'out' : undefined,
            targetHandle: into ? 'in' : undefined,
          },
        ),
      );
    }
    for (const box of expanded.values()) {
      // Round after round, top to bottom.
      box.frames.slice(1).forEach((frame, i) => {
        const before = box.frames[i];
        result.push(
          toFlow(
            {
              id: `${before.id}->${frame.id}`,
              source: before.id,
              target: frame.id,
            },
            { sourceHandle: 'bottom', targetHandle: 'top' },
          ),
        );
      });
      for (const frame of box.frames) {
        for (const e of structure.frameEdges.get(frame.id) ?? []) {
          result.push(toFlow(e));
        }
      }
    }
    return result;
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
      focusId={focusId}
      onSelect={onSelect}
      // Loop boxes open and close from their own button; frames and notes
      // are not steps.
      selectable={node => node.type === 'step'}
    />
  );
}

/** Expand or collapse one loop, above the graph. */
function LoopControls(props: { box: LoopBox; onChange(view: LoopView): void }) {
  const { box, onChange } = props;
  const { loop } = box;
  let rounds = 'No rounds';
  if (box.expanded) {
    rounds = roundsText(
      box.frames.map(f => f.round),
      loop,
    );
  } else if (loop.rounds.length > 0) {
    rounds = roundLabel(loop.iteration, loop);
  }
  return (
    <div
      className={tp('tp-loop-controls')}
      role="group"
      aria-label={`Loop ${loop.name}`}
      data-testid={`loop-controls-${loop.name}`}
    >
      <span className={tp('tp-loop-controls-name')}>{loop.name}</span>
      <Text as="span" variant="body-small" data-testid="loop-round">
        {rounds}
        {` · ${loopStatusLabel(loop.status)}`}
      </Text>
      <Button
        size="small"
        variant="secondary"
        isDisabled={loop.rounds.length === 0}
        onPress={() => onChange({ expanded: !box.expanded })}
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
 * the fit view control zooms out to show every step.
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
  const toggleLoop = useCallback(
    (name: string) =>
      changeLoopView(name, { expanded: !loopViews[name]?.expanded }),
    [loopViews, changeLoopView],
  );
  const structure = useStructure(
    props.graph,
    showMarkers,
    layoutWidth,
    loopViews,
  );
  // The loop that was expanded last, or whose round was picked: its round
  // is brought into view.
  const [focusLoop, setFocusLoop] = useState<string>();
  const lastViews = useRef<LoopViews>({});
  useEffect(() => {
    const before = lastViews.current;
    lastViews.current = loopViews;
    const changed = Object.keys(loopViews).filter(
      name =>
        loopViews[name].expanded &&
        (!before[name]?.expanded ||
          before[name].iteration !== loopViews[name].iteration),
    );
    if (changed.length > 0) setFocusLoop(changed[changed.length - 1]);
  }, [loopViews]);
  const focusBox = structure.boxes.find(
    b => b.expanded && b.loop.name === focusLoop,
  );
  const focusId = focusBox
    ? focusFrame(focusBox, loopViews[focusBox.loop.name])?.id
    : undefined;
  const hasMarkers = props.graph.nodes.some(isMarkerStep);
  const fullscreen = useGraphFullscreen();
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
          // Full screen: the graph takes the height of the window instead.
          style={fullscreen?.fullscreen ? undefined : { minHeight }}
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
              focusId={focusId}
            />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
