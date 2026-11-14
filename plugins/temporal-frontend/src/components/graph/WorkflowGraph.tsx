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
  WorkflowEventGroup,
  WorkflowGraphEdge,
  WorkflowGraphResponse,
} from '../../common';
import { Button, Flex, Switch, Text } from '@backstage/ui';
import { isMarkerStep, isOpenStep } from '../steps';
import {
  graphHeight,
  layoutSteps,
  NodeSize,
  StepLayout,
  stepSize,
  visibleSteps,
} from './layout';
import { layoutNotices, refusedNotice } from './groupNotice';
import {
  GroupedLayout,
  groupNodeId,
  GroupViews,
  layoutGroupedSteps,
} from './eventGroups';

/**
 * How each event group is drawn, by key: as a box, as labels on its
 * steps, or not at all because its steps are in a loop box.
 */
export type GroupDisplay = Record<string, 'box' | 'label' | 'loop'>;

import {
  GROUP_TAG_HEIGHT,
  GroupFlowNode,
  GroupFrameFlowNode,
  GroupFrameNode,
  GroupNode,
  GroupTagFlowNode,
  GroupTagNode,
} from './GroupNode';
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
import { frameInsets } from './frameEdge';
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
  loopOfStep,
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
  groupFrame: GroupFrameNode,
  // Not `group`: React Flow styles nodes of that type itself.
  eventGroup: GroupNode,
  groupTag: GroupTagNode,
};
type FlowNode =
  | StepFlowNode
  | LoopFlowNode
  | RoundFrameFlowNode
  | LoopNoteFlowNode
  | GroupFrameFlowNode
  | GroupFlowNode
  | GroupTagFlowNode;

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
   * Which Temporal event groups are expanded, by key, where the user set
   * it (see `defaultExpanded` for the others). Without it the graph keeps
   * the views itself.
   */
  groupViews?: GroupViews;
  /** `undefined` drops what the user set: the default applies again. */
  onGroupViewChange?(key: string, expanded: boolean | undefined): void;
  /**
   * An event group to bring into view (a group picked in the Event Groups
   * tab); a new object moves the view again.
   */
  focusGroup?: { key: string };
  /**
   * How each event group is drawn: a box (`box`) or labels on its steps
   * (`label`); a group left out is not in the graph.
   */
  onGroupDisplay?(display: GroupDisplay): void;
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
  groupViews: GroupViews,
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
    const mainNodes = steps.nodes.map(n => {
      const block = blocks.get(n.id);
      let size: NodeSize | undefined;
      if (block) size = { width: block.width, height: block.height };
      else if (!isLoopBoxNode(n)) size = sizeOf(n);
      return size ? { id: n.id, size } : { id: n.id };
    });
    // Temporal event groups: boxes around the steps (and loop boxes) that
    // are not in a loop.
    let groups: GroupedLayout | undefined;
    let main: StepLayout;
    if (graph.eventGroups && graph.eventGroups.length > 0) {
      groups = layoutGroupedSteps(
        mainNodes,
        steps.edges,
        graph.eventGroups,
        groupViews,
        layoutWidth,
      );
      main = groups.layout;
    } else {
      main = layoutSteps(mainNodes, steps.edges, layoutWidth);
    }
    const layout = placeLoopBlocks(main, blocks);
    // A new layout key when a loop or a group opens or closes.
    const loopKey = steps.boxes
      .map(b => `${b.id}:${b.expanded ? b.frames.length : '-'}`)
      .join(',');
    const groupKey = groups
      ? `:${[...groups.plan.boxes.values()]
          .filter(b => b.expanded)
          .map(b => b.id)
          .join(',')}`
      : '';
    const edges = groups ? groups.graph.edges : steps.edges;
    return {
      ...steps,
      edges,
      layout,
      toolEdges,
      nextRun,
      groups,
      key: `${steps.nodes.length}:${edges.length}:${layout.width}x${layout.height}:${loopKey}${groupKey}`,
    };
  }, [graph, showMarkers, layoutWidth, loopViews, groupViews]);
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
    onToggleGroup(key: string): void;
    focusId?: string;
    /** The group picked in the Event Groups tab: its box is marked. */
    markId?: string;
    /** The collapsed group with the selected step in it. */
    selectedBoxId?: string;
  },
) {
  const { structure, onSelect, onToggleLoop, focusId } = props;
  const { onToggleGroup, markId, selectedBoxId } = props;
  // A step selected inside a collapsed group: its box is selected instead.
  const selectedId = selectedBoxId ? undefined : props.selectedId;
  const { layout } = structure;
  const running = props.graph.status === 'Running';
  const nodes: FlowNode[] = useMemo(() => {
    // Frames and notes first: they are drawn under the steps.
    const under: FlowNode[] = [];
    const over: FlowNode[] = [];
    const groups = structure.groups;
    if (groups) {
      // Outer frames first, so the frames inside are drawn over them.
      for (const frame of groups.graph.frames) {
        const box = groups.plan.boxes.get(frame.id)!;
        under.push({
          ...flowNodeBase(layout, frame.id),
          type: 'groupFrame',
          // Not a stop of the Tab key: its buttons are. Panning to a frame
          // centres on the whole frame, which can leave its title bar out of
          // view.
          focusable: false,
          data: {
            box,
            focused: frame.id === markId,
            active: running && box.group.status === 'Running',
            onToggle: onToggleGroup,
            onSelectSource:
              box.group.sourceNodeId &&
              layout.positions.has(box.group.sourceNodeId)
                ? onSelect
                : undefined,
          },
        });
      }
      for (const box of groups.graph.collapsed) {
        over.push({
          ...flowNodeBase(layout, box.id),
          type: 'eventGroup',
          data: {
            box,
            focused: box.id === markId,
            selected: box.id === selectedBoxId,
            active: running && box.group.status === 'Running',
            onToggle: onToggleGroup,
          },
        });
      }
    }
    for (const step of structure.nodes) {
      // Steps of a collapsed group are in its box.
      if (groups && !layout.positions.has(step.id)) continue;
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
            // Nothing in it to operate: not a stop of the Tab key.
            focusable: false,
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
            // Nothing in it to operate: not a stop of the Tab key.
            focusable: false,
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
            // Nothing in it to operate: not a stop of the Tab key.
            focusable: false,
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
    // Groups without a box of their own: a label on the top edge of their
    // steps, over the steps.
    const tags: FlowNode[] = [];
    for (const [id, tagged] of groups?.plan.tags ?? []) {
      const base = flowNodeBase(layout, id);
      if (!layout.positions.has(id)) continue;
      tags.push({
        ...base,
        id: `${id}#groups`,
        position: {
          x: base.position.x,
          y: base.position.y - GROUP_TAG_HEIGHT / 2,
        },
        height: GROUP_TAG_HEIGHT,
        // Presses go through the label to the step under it.
        style: { pointerEvents: 'none' },
        type: 'groupTag',
        // Nothing in it to operate: not a stop of the Tab key.
        focusable: false,
        data: { groups: tagged },
      });
    }
    return [...under, ...over, ...tags];
  }, [
    structure,
    layout,
    selectedId,
    onSelect,
    onToggleLoop,
    onToggleGroup,
    running,
    focusId,
    markId,
    selectedBoxId,
  ]);

  const edges: Edge[] = useMemo(() => {
    const expanded = new Map(
      structure.boxes.filter(b => b.expanded).map(b => [b.id, b]),
    );
    const open = new Set<string>();
    for (const box of structure.groups?.graph.collapsed ?? []) {
      if (running && box.group.status === 'Running') open.add(box.id);
    }
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
    // With frames of event groups, the arrows between steps and group boxes
    // turn outside the frames they leave or enter.
    const grouped = structure.groups?.graph;
    const parentOf = new Map<string, string | undefined>();
    if (grouped?.frames.length) {
      for (const f of grouped.frames) parentOf.set(f.id, f.parent);
      for (const n of grouped.nodes) parentOf.set(n.id, n.parent);
    }
    // Arrows of the main graph; those of an expanded loop go into its
    // first round and out of its last one.
    for (const e of structure.edges) {
      const from = expanded.get(e.source);
      const into = expanded.get(e.target);
      const source = from ? from.frames[from.frames.length - 1].id : e.source;
      const target = into ? into.frames[0].id : e.target;
      const edge = toFlow(
        { id: e.id, source, target },
        {
          sourceHandle: from ? 'out' : undefined,
          targetHandle: into ? 'in' : undefined,
        },
      );
      if (parentOf.size > 0 && !from && !into) {
        edge.type = 'frameEdge';
        edge.data = frameInsets(layout, parentOf, source, target);
      }
      result.push(edge);
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
  }, [structure, layout, running]);

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
      // Loop and group boxes open and close from their own button; frames,
      // notes and labels are not steps.
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
      <ViewButtons />
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
  const [ownGroupViews, setOwnGroupViews] = useState<GroupViews>({});
  const groupViews = props.groupViews ?? ownGroupViews;
  const { onGroupViewChange } = props;
  const structure = useStructure(
    props.graph,
    showMarkers,
    layoutWidth,
    loopViews,
    groupViews,
  );
  // The group to bring into view: the one expanded or collapsed last, or
  // picked in the Event Groups tab. Only a group picked in the tab is
  // marked, until the user presses or scrolls the graph.
  const [panGroup, setPanGroup] = useState<string>();
  const [markGroup, setMarkGroup] = useState<string>();
  useEffect(() => {
    if (!props.focusGroup) return;
    setPanGroup(props.focusGroup.key);
    setMarkGroup(props.focusGroup.key);
  }, [props.focusGroup]);
  const changeGroupView = useCallback(
    (key: string, expanded: boolean | undefined) => {
      if (onGroupViewChange) onGroupViewChange(key, expanded);
      else {
        setOwnGroupViews(({ [key]: _old, ...views }) =>
          expanded === undefined ? views : { ...views, [key]: expanded },
        );
      }
    },
    [onGroupViewChange],
  );
  // A group the user expanded that has no room stays collapsed: the
  // request is dropped (so it holds no place) and a line says why, until
  // the user presses the graph again.
  const [requested, setRequested] = useState<string>();
  const [refused, setRefused] = useState<WorkflowEventGroup>();
  const plan = structure.groups?.plan;
  const toggleGroup = useCallback(
    (key: string) => {
      const expanded = !plan?.boxes.get(groupNodeId(key))?.expanded;
      changeGroupView(key, expanded);
      setPanGroup(key);
      setMarkGroup(undefined);
      setRefused(undefined);
      setRequested(expanded ? key : undefined);
    },
    [plan, changeGroupView],
  );
  const groupLayout = structure.groups;
  useEffect(() => {
    if (!requested || !groupLayout) return;
    setRequested(undefined);
    const group = groupLayout.refused.find(g => g.key === requested);
    if (!group) return;
    setRefused(group);
    changeGroupView(requested, undefined);
  }, [requested, groupLayout, changeGroupView]);
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
    if (changed.length > 0) {
      setFocusLoop(changed[changed.length - 1]);
      setPanGroup(undefined);
      setMarkGroup(undefined);
    }
  }, [loopViews]);
  const focusBox = structure.boxes.find(
    b => b.expanded && b.loop.name === focusLoop,
  );
  const laidOut = (key: string | undefined) =>
    key && structure.layout.positions.has(groupNodeId(key))
      ? groupNodeId(key)
      : undefined;
  // A step selected inside a collapsed group: its box is brought into view.
  const selectedBoxId =
    props.selectedId && !structure.layout.positions.has(props.selectedId)
      ? groupLayout?.graph.collapsed.find(b =>
          b.stepIds.includes(props.selectedId!),
        )?.id
      : undefined;
  const focusId =
    selectedBoxId ??
    laidOut(panGroup) ??
    (focusBox
      ? focusFrame(focusBox, loopViews[focusBox.loop.name])?.id
      : undefined);
  const { onGroupDisplay } = props;
  const { loops } = props.graph;
  useEffect(() => {
    if (!onGroupDisplay || !groupLayout) return;
    const display: GroupDisplay = {};
    for (const group of props.graph.eventGroups ?? []) {
      if (group.nodeIds.some(id => loopOfStep(loops, id))) {
        display[group.key] = 'loop';
      }
    }
    for (const tagged of groupLayout.plan.tags.values()) {
      for (const g of tagged) display[g.key] = 'label';
    }
    for (const box of groupLayout.plan.boxes.values()) {
      display[box.group.key] = 'box';
    }
    onGroupDisplay(display);
  }, [groupLayout, onGroupDisplay, loops, props.graph.eventGroups]);
  const notices = [
    ...layoutNotices(groupLayout),
    ...(refused ? [refusedNotice(refused)] : []),
  ];
  const clearMarks =
    markGroup || refused
      ? () => {
          setMarkGroup(undefined);
          setRefused(undefined);
        }
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
          onLoopViewChange={changeLoopView}
        />
        {notices.map(text => (
          <Text
            key={text}
            as="p"
            variant="body-small"
            color="secondary"
            role="status"
            className={tp('tp-group-notice')}
            data-testid="group-notice"
          >
            {text}
          </Text>
        ))}
        <div
          ref={areaRef}
          onPointerDown={clearMarks}
          onWheel={clearMarks}
          // Where the view is moved to, for tests.
          data-focus={focusId}
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
              onToggleGroup={toggleGroup}
              focusId={focusId}
              markId={laidOut(markGroup)}
              selectedBoxId={selectedBoxId}
            />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
