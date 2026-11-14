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

import type { WorkflowEventGroup, WorkflowGraphEdge } from '../../common';
import {
  boxSize,
  layoutGraph,
  LayoutFrame,
  NodeSize,
  StepLayout,
} from './layout';

/*
 * Temporal event groups as boxes around their steps: which groups get a
 * box, which boxes are expanded, and the graph that is laid out (a
 * collapsed box is one node; an expanded one is a frame around its steps).
 */

/** Expanded (true) or collapsed (false), by group key, as the user set it. */
export type GroupViews = Record<string, boolean>;

/** Prefix of the node IDs of group boxes, so they never clash with steps. */
export const GROUP_NODE_PREFIX = 'group:';

export function groupNodeId(key: string): string {
  return `${GROUP_NODE_PREFIX}${key}`;
}

/** Size of a collapsed group. */
export const GROUP_NODE_WIDTH = 240;
export const GROUP_NODE_HEIGHT = 64;

/**
 * Boxes are drawn this many groups deep; groups deeper inside are shown as
 * labels on their steps.
 */
export const MAX_GROUP_DEPTH = 5;
/** Groups this deep (0: outermost) start collapsed. */
export const COLLAPSED_DEPTH = 3;

/** The box of an event group. */
export interface GroupBox {
  /** Node ID: `group:<key>`. */
  id: string;
  group: WorkflowEventGroup;
  /** Boxes around this one: 0 for an outermost box. */
  depth: number;
  /** The box around this one. */
  parent?: string;
  /** Boxes directly inside, in the order they started. */
  children: string[];
  expanded: boolean;
  /** Steps of the graph in the group, at any depth. */
  stepIds: string[];
}

export interface GroupPlan {
  /** Boxes by node ID, outer boxes before the boxes inside them. */
  boxes: Map<string, GroupBox>;
  /** The innermost box of each step in a box. */
  boxOf: Map<string, string>;
  /**
   * Groups without a box, by step: groups whose steps are also in a box
   * that is neither around nor inside them, groups too deep, and groups
   * whose box would cover other steps.
   */
  tags: Map<string, WorkflowEventGroup[]>;
}

/**
 * Whether a group starts expanded: an outermost group does, and so does a
 * group with no other group next to it. Of several groups in one group
 * (the rounds of a loop) only the running one does, else the last failed
 * one; the others are a row of collapsed boxes. Groups deeper than
 * `COLLAPSED_DEPTH` start collapsed.
 */
export function defaultExpanded(
  group: WorkflowEventGroup,
  depth: number,
  byKey: Map<string, WorkflowEventGroup>,
): boolean {
  if (depth >= COLLAPSED_DEPTH) return false;
  const parent = group.parent ? byKey.get(group.parent) : undefined;
  if (!parent || depth === 0 || parent.children.length < 2) return true;
  const siblings = parent.children
    .map(k => byKey.get(k))
    .filter((g): g is WorkflowEventGroup => Boolean(g));
  const running = siblings.find(g => g.status === 'Running');
  if (running) return running.key === group.key;
  const failed = [...siblings].reverse().find(g => g.status === 'Failed');
  return failed?.key === group.key;
}

/** The groups as a tree, outer groups first, each in the order it started. */
export function groupTree(
  groups: WorkflowEventGroup[],
): { group: WorkflowEventGroup; level: number }[] {
  const byKey = new Map(groups.map(g => [g.key, g]));
  const out: { group: WorkflowEventGroup; level: number }[] = [];
  const seen = new Set<string>();
  const visit = (group: WorkflowEventGroup, level: number) => {
    if (seen.has(group.key)) return;
    seen.add(group.key);
    out.push({ group, level });
    for (const key of group.children) {
      const child = byKey.get(key);
      if (child && child.parent === group.key) visit(child, level + 1);
    }
  };
  for (const group of groups) {
    if (!group.parent || !byKey.has(group.parent)) visit(group, 0);
  }
  // Groups left out by a broken parent link.
  for (const group of groups) visit(group, 0);
  return out;
}

/**
 * Which groups get a box. A group gets one when it has steps in the graph
 * and its steps are in the boxes around it only: of two groups that share
 * steps without one being inside the other, the one that started first
 * gets the box and the other one is shown as labels. `noBox` names groups
 * that get no box (their box would cover other steps).
 */
export function planGroups(
  stepIds: string[],
  groups: WorkflowEventGroup[] | undefined,
  views: GroupViews,
  noBox: ReadonlySet<string> = new Set(),
): GroupPlan {
  const plan: GroupPlan = {
    boxes: new Map(),
    boxOf: new Map(),
    tags: new Map(),
  };
  if (!groups || groups.length === 0) return plan;
  const shown = new Set(stepIds);
  const order = new Map(stepIds.map((id, i) => [id, i]));
  const byKey = new Map(groups.map(g => [g.key, g]));
  const tag = (group: WorkflowEventGroup, steps: string[]) => {
    for (const id of steps) {
      const list = plan.tags.get(id) ?? [];
      list.push(group);
      plan.tags.set(id, list);
    }
  };
  /** The box drawn around each group, by group key. */
  const around = new Map<string, GroupBox | undefined>();
  for (const { group } of groupTree(groups)) {
    const outer = group.parent ? around.get(group.parent) : undefined;
    const steps = [...new Set(group.nodeIds.filter(id => shown.has(id)))];
    steps.sort((a, b) => order.get(a)! - order.get(b)!);
    const depth = outer ? outer.depth + 1 : 0;
    const fits = steps.every(id => plan.boxOf.get(id) === outer?.id);
    if (
      steps.length === 0 ||
      !fits ||
      depth >= MAX_GROUP_DEPTH ||
      noBox.has(group.key)
    ) {
      if (steps.length > 0) tag(group, steps);
      around.set(group.key, outer);
      continue;
    }
    const box: GroupBox = {
      id: groupNodeId(group.key),
      group,
      depth,
      parent: outer?.id,
      children: [],
      expanded: views[group.key] ?? defaultExpanded(group, depth, byKey),
      stepIds: steps,
    };
    plan.boxes.set(box.id, box);
    outer?.children.push(box.id);
    for (const id of steps) plan.boxOf.set(id, box.id);
    around.set(group.key, box);
  }
  limitFrames(plan, views);
  return plan;
}

/**
 * Most boxes the expanded frames hold when they open by default. A
 * compound layout takes longer than a plain one; in a large run the groups
 * the user did not open start collapsed once the frames would hold more.
 */
export const FRAME_BUDGET = 200;
/**
 * Most boxes the expanded frames hold even when the user opened them:
 * dagre recurses along the ranks of a compound graph, and runs out of
 * stack on long graphs. Groups past it stay collapsed.
 */
export const FRAME_LIMIT = 300;

function limitFrames(plan: GroupPlan, views: GroupViews) {
  // Boxes directly in each frame: its own steps and the boxes inside.
  const direct = new Map<string, number>();
  const add = (id: string) => direct.set(id, (direct.get(id) ?? 0) + 1);
  for (const id of plan.boxOf.values()) add(id);
  for (const box of plan.boxes.values()) if (box.parent) add(box.parent);
  const open = new Set<string>();
  let framed = 0;
  for (const box of plan.boxes.values()) {
    if (box.parent && !open.has(box.parent)) continue;
    if (!box.expanded) continue;
    const cost = direct.get(box.id) ?? 0;
    const limit =
      views[box.group.key] === undefined ? FRAME_BUDGET : FRAME_LIMIT;
    if (framed + cost > limit) {
      box.expanded = false;
      continue;
    }
    open.add(box.id);
    framed += cost;
  }
}

/** The boxes from the outermost one to `id`. */
export function boxChain(plan: GroupPlan, id: string | undefined): GroupBox[] {
  const chain: GroupBox[] = [];
  let box = id ? plan.boxes.get(id) : undefined;
  while (box) {
    chain.unshift(box);
    box = box.parent ? plan.boxes.get(box.parent) : undefined;
  }
  return chain;
}

export interface GroupedGraph {
  /**
   * Boxes of the laid out graph: the steps and other boxes outside a
   * collapsed group, and the collapsed groups. `parent` is the expanded
   * group around it.
   */
  nodes: { id: string; parent?: string }[];
  /** Arrows; those into and out of a collapsed group go to its box. */
  edges: WorkflowGraphEdge[];
  /** Expanded groups shown, outer ones first. */
  frames: LayoutFrame[];
  /** Collapsed groups shown. */
  collapsed: GroupBox[];
}

/**
 * The graph with the boxes of a plan: the steps of a collapsed group are
 * one box, the steps of an expanded group get the group as their frame.
 * An arrow into a collapsed group that leads back from it (a step that ran
 * between two steps of the group) is left out, so the arrows go one way.
 */
export function groupGraph(
  nodes: { id: string }[],
  edges: WorkflowGraphEdge[],
  plan: GroupPlan,
): GroupedGraph {
  const rep = new Map<string, string>();
  const collapsed = new Map<string, GroupBox>();
  const frames: LayoutFrame[] = [];
  for (const box of plan.boxes.values()) {
    const chain = boxChain(plan, box.id);
    const hidden = chain.slice(0, -1).some(b => !b.expanded);
    if (hidden) continue;
    if (box.expanded) frames.push({ id: box.id, parent: box.parent });
    else collapsed.set(box.id, box);
  }
  const out: { id: string; parent?: string }[] = [];
  for (const node of nodes) {
    const chain = boxChain(plan, plan.boxOf.get(node.id));
    const closed = chain.find(b => !b.expanded);
    if (closed) {
      rep.set(node.id, closed.id);
      continue;
    }
    const parent = chain[chain.length - 1]?.id;
    out.push(parent ? { id: node.id, parent } : { id: node.id });
  }
  for (const box of collapsed.values()) {
    out.push(box.parent ? { id: box.id, parent: box.parent } : { id: box.id });
  }
  if (collapsed.size === 0) return { nodes: out, edges, frames, collapsed: [] };

  const result: WorkflowGraphEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const source = rep.get(edge.source) ?? edge.source;
    const target = rep.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const moved = source !== edge.source || target !== edge.target;
    const id = moved ? `${source}->${target}` : edge.id;
    if (seen.has(`${source}\u0000${target}`)) continue;
    seen.add(`${source}\u0000${target}`);
    result.push(moved ? { id, source, target } : edge);
  }
  // Arrows that lead back into a collapsed group.
  const next = new Map<string, string[]>();
  for (const e of result) {
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const reach = (from: string) => {
    const seenNodes = new Set<string>();
    const queue = [...(next.get(from) ?? [])];
    while (queue.length > 0) {
      const n = queue.pop()!;
      if (seenNodes.has(n)) continue;
      seenNodes.add(n);
      queue.push(...(next.get(n) ?? []));
    }
    return seenNodes;
  };
  const back = new Set<WorkflowGraphEdge>();
  for (const id of collapsed.keys()) {
    const after = reach(id);
    for (const e of result) {
      if (e.target === id && after.has(e.source)) back.add(e);
    }
  }
  return {
    nodes: out,
    edges: back.size > 0 ? result.filter(e => !back.has(e)) : result,
    frames,
    collapsed: [...collapsed.values()],
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(layout: StepLayout, id: string): Rect | undefined {
  const p = layout.positions.get(id);
  if (!p) return undefined;
  const size: NodeSize = boxSize(layout, id);
  return { x: p.x, y: p.y, width: size.width, height: size.height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Groups whose frame covers a box that is not in it, or another frame
 * next to it. dagre keeps the steps of a frame together, so this is rare;
 * the graph is then laid out again with these groups as labels.
 */
export function coveringFrames(
  layout: StepLayout,
  graph: GroupedGraph,
): string[] {
  const parentOf = new Map<string, string | undefined>();
  for (const f of graph.frames) parentOf.set(f.id, f.parent);
  for (const n of graph.nodes) parentOf.set(n.id, n.parent);
  const inside = (id: string, frame: string) => {
    let p = parentOf.get(id);
    for (let i = 0; p && i <= graph.frames.length; i++) {
      if (p === frame) return true;
      p = parentOf.get(p);
    }
    return false;
  };
  const frameRects = graph.frames
    .map(f => ({ id: f.id, rect: rectOf(layout, f.id) }))
    .filter((f): f is { id: string; rect: Rect } => Boolean(f.rect));
  const bad = new Set<string>();
  frameRects.forEach((frame, i) => {
    for (const node of graph.nodes) {
      if (inside(node.id, frame.id)) continue;
      const rect = rectOf(layout, node.id);
      if (rect && overlaps(rect, frame.rect)) bad.add(frame.id);
    }
    // Of two frames that overlap, the later one.
    for (const other of frameRects.slice(0, i)) {
      if (
        !inside(other.id, frame.id) &&
        !inside(frame.id, other.id) &&
        overlaps(other.rect, frame.rect)
      ) {
        bad.add(frame.id);
      }
    }
  });
  return [...bad];
}

/** A laid out graph with group boxes. */
export interface GroupedLayout {
  layout: StepLayout;
  plan: GroupPlan;
  graph: GroupedGraph;
}

/**
 * Lays out steps with the boxes of their event groups. A group whose frame
 * would cover other boxes is shown as labels instead, and the graph laid
 * out again (twice at most).
 */
export function layoutGroupedSteps(
  nodes: { id: string; size?: NodeSize }[],
  edges: WorkflowGraphEdge[],
  groups: WorkflowEventGroup[],
  views: GroupViews,
  width?: number,
): GroupedLayout {
  const sizes = new Map(nodes.map(n => [n.id, n.size]));
  const ids = nodes.map(n => n.id);
  const noBox = new Set<string>();
  let result: GroupedLayout | undefined;
  const lay = (plan: GroupPlan) => {
    const graph = groupGraph(nodes, edges, plan);
    const layout = layoutGraph(
      graph.nodes.map(n => {
        const size = plan.boxes.has(n.id)
          ? { width: GROUP_NODE_WIDTH, height: GROUP_NODE_HEIGHT }
          : sizes.get(n.id);
        return { ...n, ...(size ? { size } : {}) };
      }),
      graph.edges,
      width,
      { frames: graph.frames },
    );
    return { layout, plan, graph };
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = planGroups(ids, groups, views, noBox);
    try {
      result = lay(plan);
    } catch (error) {
      // dagre recurses along the ranks: a graph that is still too deep for
      // it (very long arrows) is laid out with every group collapsed.
      if (!(error instanceof RangeError)) throw error;
      for (const box of plan.boxes.values()) box.expanded = false;
      return lay(plan);
    }
    const covering = coveringFrames(result.layout, result.graph);
    if (covering.length === 0) break;
    for (const id of covering) noBox.add(plan.boxes.get(id)!.group.key);
  }
  return result!;
}
