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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edge, ReactFlowProvider } from '@xyflow/react';
import type {
  WorkflowEventGroup,
  WorkflowGraphEdge,
  WorkflowGraphResponse,
} from '../../common';
import { Flex, Switch, Text } from '@backstage/ui';
import { ErrorAlert } from '../feedback';
import { isMarkerStep, isOpenStep } from '../steps';
import {
  graphHeight,
  layoutSteps,
  MIN_GRAPH_HEIGHT,
  StepLayout,
  stepSize,
  visibleSteps,
} from './layout';
import { layoutNotices, refusedNotice } from './groupNotice';
import {
  GroupedLayout,
  groupHues,
  groupNodeId,
  GroupViews,
  framableSource,
  layoutGroupedSteps,
} from './eventGroups';

/**
 * How each event group is drawn, by key: as a box, or as labels on its
 * steps.
 */
export type GroupDisplay = Record<string, 'box' | 'label'>;

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
  flowNodeBase,
  EDGE_ARROW_ID,
  GraphCanvas,
  RELAYOUT_DELAY_MS,
  useSettledWidth,
  useGraphFullscreen,
  ViewButtons,
} from './GraphCanvas';
import { frameInsets } from './frameEdge';
import { StepFlowNode, StepNode } from './StepNode';
import { edgeKindTint } from './edgeKind';
import { tp } from '../styles';

const nodeTypes = {
  step: StepNode,
  groupFrame: GroupFrameNode,
  // Not `group`: React Flow styles nodes of that type itself.
  eventGroup: GroupNode,
  groupTag: GroupTagNode,
};
type FlowNode =
  | StepFlowNode
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

/** Shown in place of the engine's own message when the call stack ran out. */
const TOO_MANY_STEPS =
  'The run has too many steps in a row to lay out as a graph.';

/** Used when layout throws, so the rest of the page can still render. */
const EMPTY_LAYOUT: StepLayout = {
  positions: new Map(),
  width: 1,
  height: 1,
  wrapped: false,
};

function useStructure(
  graph: WorkflowGraphResponse,
  showMarkers: boolean,
  layoutWidth: number | undefined,
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
    const sized = visible.nodes.some(n => n.llm || n.tool);
    const sizeOf = (n: (typeof visible.nodes)[number]) =>
      sized ? stepSize(n) : undefined;
    const nextRun = graph.runChain?.index
      ? graph.runChain.index + 1
      : undefined;
    const mainNodes = visible.nodes.map(n => {
      const size = sizeOf(n);
      return {
        id: n.id,
        ...(size ? { size } : {}),
        // A frame can stand for a completed signal or update only.
        ...(framableSource(n) ? { framable: true } : {}),
      };
    });
    let groups: GroupedLayout | undefined;
    let layout: StepLayout = EMPTY_LAYOUT;
    let layoutError: Error | undefined;
    try {
      if (graph.eventGroups && graph.eventGroups.length > 0) {
        groups = layoutGroupedSteps(
          mainNodes,
          visibleEdges,
          graph.eventGroups,
          groupViews,
          layoutWidth,
        );
        layout = groups.layout;
      } else {
        layout = layoutSteps(mainNodes, visibleEdges, layoutWidth);
      }
    } catch (err) {
      // A long chain can exhaust the call stack in dagre (`RangeError`);
      // other layout failures must not take down the run page either.
      if (err instanceof RangeError) {
        layoutError = new Error(TOO_MANY_STEPS);
      } else {
        layoutError = err instanceof Error ? err : new Error(String(err));
      }
      groups = undefined;
      layout = EMPTY_LAYOUT;
    }
    const groupKey = groups
      ? `:${[...groups.plan.boxes.values()]
          .filter(b => b.expanded)
          .map(b => b.id)
          .join(',')}`
      : '';
    const edges = groups ? groups.graph.edges : visibleEdges;
    return {
      nodes: visible.nodes,
      edges,
      layout,
      layoutError,
      toolEdges,
      nextRun,
      groups,
      hues: groupHues(graph.eventGroups),
      key: layoutError
        ? 'layout-error'
        : `${visible.nodes.length}:${edges.length}:${layout.width}x${layout.height}${groupKey}`,
    };
  }, [graph, showMarkers, layoutWidth, groupViews]);
}

function StepCanvas(
  props: WorkflowGraphProps & {
    structure: Structure;
    layoutWidth?: number;
    onToggleGroup(key: string): void;
    focusId?: string;
    /** The group picked in the Event Groups tab: its box is marked. */
    markId?: string;
    /**
     * The box that stands for the selected step: the collapsed group with
     * the step in it, or the frame of the group a selected signal or update
     * started, when the frame stands for it.
     */
    selectedBoxId?: string;
  },
) {
  const { structure, onSelect, focusId } = props;
  const { onToggleGroup, markId, selectedBoxId } = props;
  // A step selected inside a collapsed group, or a signal or update that a
  // frame stands for: the box or the frame is selected instead.
  const selectedId = selectedBoxId ? undefined : props.selectedId;
  const { layout } = structure;
  const running = props.graph.status === 'Running';
  const nodes: FlowNode[] = useMemo(() => {
    const under: FlowNode[] = [];
    const over: FlowNode[] = [];
    const groups = structure.groups;
    if (groups) {
      // Outer frames first, so the frames inside are drawn over them.
      for (const frame of groups.graph.frames) {
        const box = groups.plan.boxes.get(frame.id)!;
        const source = box.group.sourceNodeId;
        // The frame stands for the signal or update, which is not drawn.
        const standsFor =
          source !== undefined &&
          groups.graph.sourceFrames.get(source) === frame.id;
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
              source && (standsFor || layout.positions.has(source))
                ? onSelect
                : undefined,
            sourceKind: structure.nodes.find(n => n.id === source)?.kind,
            ...(standsFor ? { selected: frame.id === selectedBoxId } : {}),
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
      over.push({
        ...flowNodeBase(layout, step.id),
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
        data: {
          groups: tagged,
          hue: structure.hues.get(tagged[0].key) ?? 1,
        },
      });
    }
    return [...under, ...over, ...tags];
  }, [
    structure,
    layout,
    selectedId,
    onSelect,
    onToggleGroup,
    running,
    markId,
    selectedBoxId,
  ]);

  const edges: Edge[] = useMemo(() => {
    const open = new Set<string>();
    for (const box of structure.groups?.graph.collapsed ?? []) {
      if (running && box.group.status === 'Running') open.add(box.id);
    }
    for (const n of structure.nodes) {
      if (isOpenStep(n)) open.add(n.id);
    }
    const toFlow = (e: {
      id: string;
      source: string;
      target: string;
    }): Edge => {
      // Kind color of the step the arrow leads to. Running steps and
      // tool calls keep their own look: those CSS classes beat the kind
      // color.
      const tint = edgeKindTint(
        e.target,
        structure.nodes,
        structure.groups?.plan.boxes,
      );
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        markerEnd: EDGE_ARROW_ID,
        // Arrows into open steps move, like the step itself.
        animated: open.has(e.target),
        className:
          [
            tint ? tp(`tp-edge-kind-${tint}`) : '',
            open.has(e.target) ? tp('tp-edge-active') : '',
            // A plain class too, for tests and custom styles.
            structure.toolEdges.has(e.id)
              ? `${tp('tp-edge-tool')} temporal-llm-tool-edge`
              : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined,
        focusable: false,
      };
    };
    const result: Edge[] = [];
    // With frames of event groups, the arrows between steps and group boxes
    // turn outside the frames they leave or enter.
    const grouped = structure.groups?.graph;
    const parentOf = new Map<string, string | undefined>();
    if (grouped?.frames.length) {
      for (const f of grouped.frames) parentOf.set(f.id, f.parent);
      for (const n of grouped.nodes) parentOf.set(n.id, n.parent);
    }
    for (const e of structure.edges) {
      const edge = toFlow(e);
      if (parentOf.size > 0) {
        edge.type = 'frameEdge';
        edge.data = frameInsets(layout, parentOf, e.source, e.target);
      }
      result.push(edge);
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
      // Group boxes open and close from their own button; frames and labels
      // are not steps.
      selectable={node => node.type === 'step'}
    />
  );
}

function GraphToolbar(props: {
  hasMarkers: boolean;
  showMarkers: boolean;
  onShowMarkersChange?(show: boolean): void;
}) {
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
  const [ownGroupViews, setOwnGroupViews] = useState<GroupViews>({});
  const groupViews = props.groupViews ?? ownGroupViews;
  const { onGroupViewChange } = props;
  const structure = useStructure(
    props.graph,
    showMarkers,
    layoutWidth,
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
  const laidOut = (key: string | undefined) =>
    key && structure.layout.positions.has(groupNodeId(key))
      ? groupNodeId(key)
      : undefined;
  // A step selected inside a collapsed group, or a signal or update that
  // the frame of its group stands for: the box or the frame is selected and
  // brought into view.
  const selectedBoxId =
    props.selectedId && !structure.layout.positions.has(props.selectedId)
      ? groupLayout?.graph.sourceFrames.get(props.selectedId) ??
        groupLayout?.graph.collapsed.find(b =>
          b.stepIds.includes(props.selectedId!),
        )?.id
      : undefined;
  const focusId = selectedBoxId ?? laidOut(panGroup);
  const { onGroupDisplay } = props;
  useEffect(() => {
    if (!onGroupDisplay || !groupLayout) return;
    const display: GroupDisplay = {};
    for (const tagged of groupLayout.plan.tags.values()) {
      for (const g of tagged) display[g.key] = 'label';
    }
    for (const box of groupLayout.plan.boxes.values()) {
      display[box.group.key] = 'box';
    }
    onGroupDisplay(display);
  }, [groupLayout, onGroupDisplay]);
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
  const minHeight = structure.layoutError
    ? MIN_GRAPH_HEIGHT
    : graphHeight(structure.layout, layoutWidth ?? structure.layout.width);
  return (
    <ReactFlowProvider>
      <div className={tp('tp-graph-column')}>
        <GraphToolbar
          hasMarkers={hasMarkers}
          showMarkers={showMarkers}
          onShowMarkersChange={props.onShowMarkersChange}
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
          {structure.layoutError ? (
            <div style={{ padding: 12 }}>
              <ErrorAlert
                title="The graph could not be laid out"
                error={structure.layoutError}
              />
            </div>
          ) : (
            <div className={tp('tp-graph-canvas')}>
              <StepCanvas
                {...props}
                structure={structure}
                layoutWidth={layoutWidth}
                onToggleGroup={toggleGroup}
                focusId={focusId}
                markId={laidOut(markGroup)}
                selectedBoxId={selectedBoxId}
              />
            </div>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
