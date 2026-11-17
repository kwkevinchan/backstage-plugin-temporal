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

import type {
  WorkflowEventGroup,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '../../common';
import {
  boxSize,
  hideSteps,
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

/**
 * The color of a group: one of `GROUP_HUES` hues, or the color of
 * messages for the groups of signals and updates.
 */
export type GroupHue = 1 | 2 | 3 | 4 | 'message';
/** How many hues the groups take turns with. */
export const GROUP_HUES = 4;

/**
 * The color of each group, by key, only to tell the groups apart: the
 * outermost groups take the hues in turn, in the order they started (so
 * two groups next to each other differ, and a run shows the same colors
 * every time), and the groups inside them take the hue of the outermost
 * one. The groups of signals and updates have the color of messages.
 */
export function groupHues(
  groups: WorkflowEventGroup[] | undefined,
): Map<string, GroupHue> {
  const hues = new Map<string, GroupHue>();
  let next = 0;
  let outer: GroupHue = 1;
  for (const { group, level } of groupTree(groups ?? [])) {
    const message = group.kind === 'event' || group.kind === 'update';
    if (level === 0) {
      outer = message ? 'message' : (((next++ % GROUP_HUES) + 1) as GroupHue);
    }
    hues.set(group.key, message ? 'message' : outer);
  }
  return hues;
}

/** The box of an event group. */
export interface GroupBox {
  /** Node ID: `group:<key>`. */
  id: string;
  group: WorkflowEventGroup;
  /** Its color (see `groupHues`). */
  hue: GroupHue;
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
 * that get no box (their box would cover other steps, or would hold too
 * many). With `noFrames`, a group that would be expanded is shown as
 * labels too: only collapsed boxes are drawn.
 */
export function planGroups(
  stepIds: string[],
  groups: WorkflowEventGroup[] | undefined,
  views: GroupViews,
  noBox: ReadonlySet<string> = new Set(),
  options: { noFrames?: boolean } = {},
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
  const hues = groupHues(groups);
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
    const expanded = views[group.key] ?? defaultExpanded(group, depth, byKey);
    if (
      steps.length === 0 ||
      !fits ||
      depth >= MAX_GROUP_DEPTH ||
      noBox.has(group.key) ||
      (options.noFrames && expanded)
    ) {
      if (steps.length > 0) tag(group, steps);
      around.set(group.key, outer);
      continue;
    }
    const box: GroupBox = {
      id: groupNodeId(group.key),
      group,
      hue: hues.get(group.key) ?? 1,
      depth,
      parent: outer?.id,
      children: [],
      expanded,
      stepIds: steps,
    };
    plan.boxes.set(box.id, box);
    outer?.children.push(box.id);
    for (const id of steps) plan.boxOf.set(id, box.id);
    around.set(group.key, box);
  }
  return plan;
}

/**
 * Most boxes the expanded frames hold when they open by default. A
 * compound layout takes longer than a plain one; in a large run the
 * groups past it start collapsed.
 */
export const FRAME_BUDGET = 200;
/** Most boxes the expanded frames hold, with the groups the user opened. */
export const FRAME_LIMIT = 300;
/**
 * Largest graph laid out as a compound graph, as boxes laid out times
 * `2 × depth + 1` (the ranks dagre adds for the borders of the frames).
 * dagre recurses along the ranks and runs out of stack on longer graphs;
 * past it the expanded groups are shown as labels.
 */
export const COMPOUND_LIMIT = 1000;

/** What `allocateFrames` changed in a plan. */
interface Allocation {
  /** Groups to show as labels: they would hold more than any budget. */
  tag: string[];
  /** Groups the user opened that stay collapsed: no room left. */
  refused: string[];
}

/**
 * Opens the expanded groups while the frames have room: first the groups
 * the user opened (up to `FRAME_LIMIT` boxes), then those that open by
 * default (up to `FRAME_BUDGET`). A group past it is collapsed; an
 * outermost one that alone holds more than `FRAME_LIMIT` boxes (a whole
 * batch in one group) is shown as labels, so its steps stay in sight.
 */
function allocateFrames(plan: GroupPlan, views: GroupViews): Allocation {
  // Boxes directly in each frame: its own steps and the boxes inside.
  const direct = new Map<string, number>();
  const add = (id: string) => direct.set(id, (direct.get(id) ?? 0) + 1);
  for (const id of plan.boxOf.values()) add(id);
  for (const box of plan.boxes.values()) if (box.parent) add(box.parent);
  const cost = (box: GroupBox) => direct.get(box.id) ?? 0;
  const open = new Set<string>();
  const result: Allocation = { tag: [], refused: [] };
  let framed = 0;
  const overflow = (box: GroupBox) => {
    box.expanded = false;
    if (!box.parent && cost(box) > FRAME_LIMIT) result.tag.push(box.group.key);
  };
  const boxes = [...plan.boxes.values()];
  for (const box of boxes) {
    if (views[box.group.key] !== true) continue;
    const chain = boxChain(plan, box.id);
    if (chain.some(b => !b.expanded)) continue;
    const closed = chain.filter(b => !open.has(b.id));
    const needed = closed.reduce((sum, b) => sum + cost(b), 0);
    if (framed + needed > FRAME_LIMIT) {
      result.refused.push(box.group.key);
      overflow(box);
      continue;
    }
    for (const b of closed) open.add(b.id);
    framed += needed;
  }
  for (const box of boxes) {
    if (!box.expanded || open.has(box.id)) continue;
    if (box.parent && !open.has(box.parent)) continue;
    if (framed + cost(box) > FRAME_BUDGET) {
      overflow(box);
      continue;
    }
    open.add(box.id);
    framed += cost(box);
  }
  return result;
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
   * group around it; `after` places it in a stacked frame (see
   * `stackGroups`).
   */
  nodes: { id: string; parent?: string; after?: string }[];
  /** Arrows; those into and out of a collapsed group go to its box. */
  edges: WorkflowGraphEdge[];
  /** Expanded groups shown, outer ones first. */
  frames: LayoutFrame[];
  /** Collapsed groups shown. */
  collapsed: GroupBox[];
  /**
   * Signals and updates left out of the graph, by node ID: the frame of
   * the group they started (its ID) stands for them.
   */
  sourceFrames: Map<string, string>;
}

/**
 * True for a step that the frame of the group it started can stand for: a
 * signal, or an update that completed. A failed, rejected or running
 * update, and the start of the run, stay boxes of their own, with their
 * status.
 */
export function framableSource(node: {
  kind: WorkflowGraphNode['kind'];
  status: WorkflowGraphNode['status'];
}): boolean {
  return (
    (node.kind === 'signal' || node.kind === 'update') &&
    node.status === 'Completed'
  );
}

/**
 * The signals and updates that the frames of their groups stand for, by
 * node ID, with the ID of the frame. A step marked `framable` (see
 * `framableSource`) is left out when the group it started is drawn as a
 * frame and the step is in no group, started no other group with steps in
 * the graph, and leads to a step of that group: by an arrow, or through
 * other framable steps only (signals received together, one after the
 * other). Otherwise (the group collapsed or shown as labels, or any of
 * these not so) it stays a box of its own.
 */
function framedSources(
  nodes: { id: string; framable?: boolean }[],
  edges: WorkflowGraphEdge[],
  plan: GroupPlan,
  frames: LayoutFrame[],
): Map<string, string> {
  const result = new Map<string, string>();
  const framable = new Set(nodes.filter(n => n.framable).map(n => n.id));
  if (framable.size === 0) return result;
  const next = new Map<string, string[]>();
  for (const e of edges) {
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  /** True when `from` leads to `steps`, through framable steps only. */
  const leadsTo = (from: string, steps: Set<string>) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      for (const id of next.get(queue.pop()!) ?? []) {
        if (steps.has(id)) return true;
        if (seen.has(id) || !framable.has(id)) continue;
        seen.add(id);
        queue.push(id);
      }
    }
    return false;
  };
  const groupsBySource = new Map<string, Set<string>>();
  const started = (group: WorkflowEventGroup) => {
    if (!group.sourceNodeId) return;
    const keys = groupsBySource.get(group.sourceNodeId) ?? new Set<string>();
    keys.add(group.key);
    groupsBySource.set(group.sourceNodeId, keys);
  };
  for (const box of plan.boxes.values()) started(box.group);
  for (const tagged of plan.tags.values()) tagged.forEach(started);
  for (const frame of frames) {
    const { group, stepIds } = plan.boxes.get(frame.id)!;
    const source = group.sourceNodeId;
    const message = group.kind === 'event' || group.kind === 'update';
    if (!message || !source || !framable.has(source)) continue;
    if (plan.boxOf.has(source) || plan.tags.has(source)) continue;
    if (groupsBySource.get(source)!.size !== 1) continue;
    const steps = new Set(stepIds);
    if (!leadsTo(source, steps)) continue;
    result.set(source, frame.id);
  }
  return result;
}

/**
 * The graph with the boxes of a plan: the steps of a collapsed group are
 * one box, the steps of an expanded group get the group as their frame.
 * A signal or update whose group is a frame is left out (see
 * `framedSources`): the arrows into it go on to the steps it leads to,
 * the first steps of its group, unless another path already leads there.
 * An arrow into a collapsed group that leads back from it (a step that ran
 * between two steps of the group) is left out, so the arrows go one way.
 */
export function groupGraph(
  allNodes: { id: string; framable?: boolean }[],
  allEdges: WorkflowGraphEdge[],
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
  const sourceFrames = framedSources(allNodes, allEdges, plan, frames);
  const { nodes, edges } =
    sourceFrames.size > 0
      ? hideSteps(allNodes, allEdges, new Set(sourceFrames.keys()))
      : { nodes: allNodes, edges: allEdges };
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
  if (collapsed.size === 0) {
    return { nodes: out, edges, frames, collapsed: [], sourceFrames };
  }

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
    sourceFrames,
  };
}

/**
 * The graph with the child groups of some frames stacked in rows: a frame
 * with two or more child groups, at least one of them a frame, stacks them
 * (`LayoutFrame.stacked`), in the order they started. Boxes are listed in
 * the order their first steps ran (`stepIds`).
 *
 * The group of a signal or update that arrows from a stacked frame lead
 * to, and whose arrows out lead nowhere but back into it (a signal received
 * during a round of a loop), goes in that frame, in a row below the row the
 * first arrow into it comes from (`after`): its box, and the signal or
 * update when it is drawn. Its frame or box gets the stacked frame as its
 * parent. Of stacked frames in each other, the innermost one around every
 * other end of these arrows is the one, unless the group is in a frame that
 * is not around that one.
 *
 * Without such frames, the graph is as it was.
 */
export function stackGroups(
  graph: GroupedGraph,
  plan: GroupPlan,
  stepIds: string[],
): GroupedGraph {
  const laidOut = new Set(graph.frames.map(f => f.id));
  const stacked = new Set(
    graph.frames
      .filter(({ id }) => {
        const { children } = plan.boxes.get(id)!;
        return children.length >= 2 && children.some(c => laidOut.has(c));
      })
      .map(f => f.id),
  );
  if (stacked.size === 0) return graph;

  const index = new Map(stepIds.map((id, i) => [id, i]));
  const orderOf = (id: string) => {
    const box = plan.boxes.get(id);
    if (!box) return index.get(id) ?? Infinity;
    return Math.min(...box.stepIds.map(s => index.get(s) ?? Infinity));
  };
  const parentOf = new Map<string, string | undefined>([
    ...graph.frames.map(f => [f.id, f.parent] as const),
    ...graph.nodes.map(n => [n.id, n.parent] as const),
  ]);
  const chainOf = (id: string) => {
    const chain: string[] = [];
    for (let p = parentOf.get(id); p && chain.length <= parentOf.size; ) {
      chain.push(p);
      p = parentOf.get(p);
    }
    return chain;
  };
  const shown = new Set(graph.nodes.map(n => n.id));
  const placed = new Map<string, { stack: string; after: string }>();
  for (const box of plan.boxes.values()) {
    const { group, id } = box;
    if (group.kind !== 'event' && group.kind !== 'update') continue;
    if (!parentOf.has(id) || placed.has(id)) continue;
    const source = group.sourceNodeId;
    const withSource =
      source && shown.has(source) && parentOf.get(source) === parentOf.get(id)
        ? [id, source]
        : undefined;
    for (const unit of [withSource, [id]]) {
      if (!unit) continue;
      const found = detour(unit, graph, chainOf, stacked, laidOut, orderOf);
      if (!found) continue;
      for (const item of unit) placed.set(item, found);
      break;
    }
  }
  if (placed.size === 0) {
    return {
      ...graph,
      frames: graph.frames.map(f =>
        stacked.has(f.id) ? { ...f, stacked: true } : f,
      ),
      nodes: sortByTime(graph.nodes, orderOf),
    };
  }
  const moved = <T extends { id: string; parent?: string }>(item: T): T => {
    const to = placed.get(item.id);
    return to ? ({ ...item, parent: to.stack, after: to.after } as T) : item;
  };
  const frames = graph.frames.map(f => ({
    ...moved(f),
    ...(stacked.has(f.id) ? { stacked: true } : {}),
  }));
  // Outer frames first, also for the frames that moved in another.
  const frameParent = new Map(frames.map(f => [f.id, f.parent]));
  const depthOf = (id: string) => {
    let depth = 0;
    for (let p = frameParent.get(id); p && depth <= frames.length; depth++) {
      p = frameParent.get(p);
    }
    return depth;
  };
  const depths = new Map(frames.map(f => [f.id, depthOf(f.id)]));
  return {
    ...graph,
    frames: frames
      .map((f, i) => ({ f, i }))
      .sort((a, b) => depths.get(a.f.id)! - depths.get(b.f.id)! || a.i - b.i)
      .map(({ f }) => f),
    nodes: sortByTime(graph.nodes.map(moved), orderOf),
  };
}

/** The boxes in the order their first steps ran. */
function sortByTime<T extends { id: string }>(
  nodes: T[],
  orderOf: (id: string) => number,
): T[] {
  return nodes
    .map((n, i) => ({ n, i, order: orderOf(n.id) }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ n }) => n);
}

/**
 * The stacked frame that the arrows into the boxes and frames of `unit`
 * come from and the arrows out of them lead back to, and the box the first
 * arrow into them comes from; nothing without an arrow into them, when
 * they also lead elsewhere, or when their frame is not around that one.
 */
function detour(
  unit: string[],
  graph: GroupedGraph,
  chainOf: (id: string) => string[],
  stacked: Set<string>,
  frames: Set<string>,
  orderOf: (id: string) => number,
): { stack: string; after: string } | undefined {
  const inUnit = (id: string) =>
    unit.includes(id) || chainOf(id).some(f => unit.includes(f));
  const ends: string[] = [];
  const into: { source: string }[] = [];
  for (const e of graph.edges) {
    const [s, t] = [inUnit(e.source), inUnit(e.target)];
    if (s === t) continue;
    ends.push(s ? e.target : e.source);
    if (t) into.push(e);
  }
  if (into.length === 0) return undefined;
  // The innermost stacked frame around every other end.
  const around = chainOf(ends[0]).filter(
    f => stacked.has(f) && ends.every(end => chainOf(end).includes(f)),
  );
  const stack = around[0];
  if (!stack) return undefined;
  // The unit stays in the frames around the stacked frame.
  const outer = chainOf(unit[0])[0];
  if (outer !== undefined && !chainOf(stack).includes(outer)) {
    return undefined;
  }
  const first = into.reduce((a, b) =>
    orderOf(b.source) < orderOf(a.source) ? b : a,
  );
  // All other ends in one expanded frame of the stacked frame that is not
  // stacked itself (a round of a loop): the unit goes in that frame, beside
  // its boxes. Unless it leads back to more than one box, or to a box that
  // the source of the first arrow into it does not lead to in that frame,
  // or into the box or frame of the frame that source is in, or the source
  // is not the last box of the frames around it in that frame, or the
  // target not the first one: an arrow would have to pass other boxes of
  // the frame on its way out or in.
  const rows = new Set(ends.map(end => childIn(stack, end, chainOf)));
  const [row] = rows;
  if (
    rows.size === 1 &&
    row !== undefined &&
    frames.has(row) &&
    !stacked.has(row)
  ) {
    const from = childIn(row, first.source, chainOf);
    const targets = [
      ...new Set(
        graph.edges
          .filter(e => inUnit(e.source) && !inUnit(e.target))
          .map(e => e.target),
      ),
    ];
    // The boxes of the round that the source leads to, by the arrows
    // between them.
    const inRow = (id: string) => chainOf(id).includes(row);
    const reached = new Set([first.source]);
    for (const queue = [first.source]; queue.length > 0; ) {
      const at = queue.pop()!;
      for (const e of graph.edges) {
        if (e.source !== at || reached.has(e.target)) continue;
        if (inUnit(e.target) || !inRow(e.target)) continue;
        reached.add(e.target);
        queue.push(e.target);
      }
    }
    /** True when `end` is the first (or last) box of its frames in the row. */
    const outermost = (end: string, last: boolean) => {
      const frameIds = chainOf(end);
      const inner = frameIds.slice(0, frameIds.indexOf(row));
      return inner.every(f =>
        graph.nodes.every(
          n =>
            !chainOf(n.id).includes(f) ||
            (last
              ? orderOf(n.id) <= orderOf(end)
              : orderOf(n.id) >= orderOf(end)),
        ),
      );
    };
    if (
      targets.length <= 1 &&
      targets.every(t => reached.has(t)) &&
      targets.every(t => childIn(row, t, chainOf) !== from) &&
      outermost(first.source, true) &&
      targets.every(t => outermost(t, false))
    ) {
      return { stack: row, after: first.source };
    }
  }
  return { stack, after: first.source };
}

/** The child of `frame` that `id` is in (or is). */
function childIn(
  frame: string,
  id: string,
  chainOf: (id: string) => string[],
): string | undefined {
  const up = [id, ...chainOf(id)];
  const at = up.indexOf(frame);
  return at > 0 ? up[at - 1] : undefined;
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

/** Why some groups are not drawn as the user or the defaults wanted. */
export type GroupNotice =
  /** The graph is too long for frames: expanded groups are labels. */
  | 'tooLarge'
  /** Laying out the frames failed: every group is a label. */
  | 'failed';

/** A laid out graph with group boxes. */
export interface GroupedLayout {
  layout: StepLayout;
  plan: GroupPlan;
  graph: GroupedGraph;
  /** Groups the user opened that stay collapsed (no room left). */
  refused: WorkflowEventGroup[];
  /**
   * Groups shown as labels because each alone holds more boxes than the
   * frames may (`FRAME_LIMIT`).
   */
  tooBig: WorkflowEventGroup[];
  notice?: GroupNotice;
}

/** Frames deep, at most, of a graph: 0 without frames. */
function frameDepth(frames: LayoutFrame[]): number {
  const parentOf = new Map(frames.map(f => [f.id, f.parent]));
  let deepest = 0;
  for (const frame of frames) {
    let d = 1;
    for (let p = frame.parent; p && d <= frames.length; d++) {
      p = parentOf.get(p);
    }
    deepest = Math.max(deepest, d);
  }
  return deepest;
}

/**
 * Lays out steps with the boxes of their event groups.
 *
 * - The frames open within their budgets (`allocateFrames`).
 * - A graph too long for a compound layout (`COMPOUND_LIMIT`) shows the
 *   expanded groups as labels.
 * - A group whose frame would cover other boxes is shown as labels, and
 *   the graph laid out again; if frames still cover other boxes after
 *   that, the expanded groups are shown as labels.
 * - If the compound layout fails, every group is shown as labels on its
 *   steps, laid out like a graph without groups.
 */
export function layoutGroupedSteps(
  /** `framable`: see `framableSource`. */
  nodes: { id: string; size?: NodeSize; framable?: boolean }[],
  edges: WorkflowGraphEdge[],
  groups: WorkflowEventGroup[],
  views: GroupViews,
  width?: number,
  /** Lays out the graph; for tests. */
  lay: typeof layoutGraph = layoutGraph,
): GroupedLayout {
  const sizes = new Map(nodes.map(n => [n.id, n.size]));
  const ids = nodes.map(n => n.id);
  const byKey = new Map(groups.map(g => [g.key, g]));
  const noBox = new Set<string>();
  const refused = new Set<string>();
  const tooBig = new Set<string>();
  const plan = (noFrames = false) => {
    for (let i = 0; i <= groups.length; i++) {
      const p = planGroups(ids, groups, views, noBox, { noFrames });
      const allocation = allocateFrames(p, views);
      for (const key of allocation.refused) refused.add(key);
      if (allocation.tag.length === 0) return p;
      for (const key of allocation.tag) {
        noBox.add(key);
        tooBig.add(key);
      }
    }
    return planGroups(ids, groups, views, noBox, { noFrames: true });
  };
  const groupsOf = (keys: Set<string>) =>
    [...keys]
      .map(k => byKey.get(k))
      .filter((g): g is WorkflowEventGroup => Boolean(g));
  const layOut = (p: GroupPlan, notice?: GroupNotice): GroupedLayout => {
    const graph = stackGroups(groupGraph(nodes, edges, p), p, ids);
    const layout = lay(
      graph.nodes.map(n => {
        const size = p.boxes.has(n.id)
          ? { width: GROUP_NODE_WIDTH, height: GROUP_NODE_HEIGHT }
          : sizes.get(n.id);
        return { ...n, ...(size ? { size } : {}) };
      }),
      graph.edges,
      width,
      { frames: graph.frames },
    );
    const result: GroupedLayout = {
      layout,
      plan: p,
      graph,
      refused: groupsOf(refused),
      tooBig: groupsOf(tooBig),
    };
    if (notice) result.notice = notice;
    return result;
  };
  try {
    let notice: GroupNotice | undefined;
    let current = plan();
    let graph = groupGraph(nodes, edges, current);
    if (
      graph.frames.length > 0 &&
      graph.nodes.length * (2 * frameDepth(graph.frames) + 1) > COMPOUND_LIMIT
    ) {
      notice = 'tooLarge';
      current = plan(true);
      graph = groupGraph(nodes, edges, current);
    }
    let result = layOut(current, notice);
    for (let attempt = 0; attempt < 3; attempt++) {
      const covering = coveringFrames(result.layout, result.graph);
      if (covering.length === 0) return result;
      if (attempt === 2) break;
      for (const id of covering)
        noBox.add(result.plan.boxes.get(id)!.group.key);
      result = layOut(plan(notice === 'tooLarge'), notice);
    }
    // Frames still cover other boxes: no frames at all.
    return layOut(plan(true), notice);
  } catch {
    // A compound layout that fails (too deep for dagre, or anything else)
    // must not break the page: the groups become labels on their steps.
    const tagged = planGroups(ids, groups, views, new Set(byKey.keys()));
    const graph = groupGraph(nodes, edges, tagged);
    return {
      layout: layoutGraph(nodes, edges, width),
      plan: tagged,
      graph,
      refused: [],
      tooBig: [],
      notice: 'failed',
    };
  }
}
