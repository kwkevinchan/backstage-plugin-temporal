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
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowLoopGroup,
  WorkflowLoopRound,
} from '../../common';
import { hideSteps } from './layout';

/** How one loop is shown: collapsed, or expanded to one round. */
export interface LoopView {
  expanded: boolean;
  /** The round shown when expanded; the latest round when left out. */
  iteration?: number;
}

export type LoopViews = Record<string, LoopView>;

/** The box of a loop in the graph. */
export interface LoopBox {
  id: string;
  loop: WorkflowLoopGroup;
  expanded: boolean;
  /** The round shown (expanded) or the latest round (collapsed). */
  round?: WorkflowLoopRound;
}

export const LOOP_NODE_PREFIX = 'loop:';

export function loopNodeId(name: string): string {
  return `${LOOP_NODE_PREFIX}${name}`;
}

export function isLoopNodeId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(LOOP_NODE_PREFIX));
}

/** The round of a loop that a view shows: the chosen one, else the latest. */
export function shownRound(
  loop: WorkflowLoopGroup,
  view?: LoopView,
): WorkflowLoopRound | undefined {
  const rounds = loop.rounds;
  if (view?.iteration !== undefined) {
    const chosen = rounds.find(r => r.iteration === view.iteration);
    if (chosen) return chosen;
  }
  return rounds[rounds.length - 1];
}

/**
 * The loop that a step belongs to, by the steps of its rounds, with the
 * round.
 */
export function loopOfStep(
  loops: WorkflowLoopGroup[] | undefined,
  nodeId: string,
): { loop: WorkflowLoopGroup; round: WorkflowLoopRound } | undefined {
  for (const loop of loops ?? []) {
    for (const round of loop.rounds) {
      if (round.steps.some(s => s.nodeId === nodeId)) return { loop, round };
    }
  }
  return undefined;
}

type Node = WorkflowGraphNode | { id: string; loopBox: LoopBox };

export function isLoopBoxNode(
  node: Node,
): node is { id: string; loopBox: LoopBox } {
  return 'loopBox' in node;
}

/**
 * Replaces the steps of each loop with one box. A collapsed loop is the box
 * alone, with the arrows into and out of its rounds. An expanded loop is
 * the box followed by the steps of one round; the other rounds are left
 * out and the arrows through them are joined. Steps after the loop follow
 * it. Without loops, the steps are returned as they are.
 */
export function groupLoops(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  loops: WorkflowLoopGroup[] | undefined,
  views: LoopViews,
): { nodes: Node[]; edges: WorkflowGraphEdge[]; boxes: LoopBox[] } {
  if (!loops || loops.length === 0) return { nodes, edges, boxes: [] };
  const present = new Set(nodes.map(n => n.id));
  const hidden = new Set<string>();
  const mergeInto = new Map<string, string>();
  const shownBy = new Map<string, string>();
  const boxes: LoopBox[] = [];
  for (const loop of loops) {
    const view = views[loop.name];
    const round = shownRound(loop, view);
    const id = loopNodeId(loop.name);
    const members = loop.rounds
      .flatMap(r => r.steps.map(s => s.nodeId))
      .filter(m => present.has(m) && !mergeInto.has(m) && !shownBy.has(m));
    if (members.length === 0 && loop.rounds.length === 0) continue;
    const shown = new Set(
      view?.expanded && round
        ? round.steps.map(s => s.nodeId).filter(m => members.includes(m))
        : [],
    );
    const expanded = Boolean(view?.expanded) && shown.size > 0;
    boxes.push({ id, loop, expanded, round });
    for (const m of members) {
      if (!expanded) mergeInto.set(m, id);
      else if (shown.has(m)) shownBy.set(m, id);
      else hidden.add(m);
    }
  }
  if (boxes.length === 0) return { nodes, edges, boxes };

  // Other rounds of expanded loops: left out, arrows joined through them.
  const reduced = hideSteps(nodes, edges, hidden);

  const out: Node[] = [];
  const placed = new Set<string>();
  const boxById = new Map(boxes.map(b => [b.id, b]));
  for (const node of reduced.nodes) {
    const box = mergeInto.get(node.id) ?? shownBy.get(node.id);
    if (box && !placed.has(box)) {
      placed.add(box);
      out.push({ id: box, loopBox: boxById.get(box)! });
    }
    if (!mergeInto.has(node.id)) out.push(node);
  }
  // A loop whose steps are all hidden (markers) still shows its box.
  for (const box of boxes) {
    if (!placed.has(box.id)) out.push({ id: box.id, loopBox: box });
  }

  const result: WorkflowGraphEdge[] = [];
  const seen = new Set<string>();
  const link = (source: string, target: string) => {
    if (source === target) return;
    const id = `${source}->${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    result.push({ id, source, target });
  };
  for (const edge of reduced.edges) {
    const source = mergeInto.get(edge.source) ?? edge.source;
    const target = mergeInto.get(edge.target) ?? edge.target;
    const intoRound = shownBy.get(target);
    // Arrows into the shown round go through the box of its loop.
    if (intoRound && shownBy.get(source) !== intoRound) {
      link(source, intoRound);
      link(intoRound, target);
      continue;
    }
    link(source, target);
  }
  // The box of an expanded loop leads to the round's first steps, also when
  // no arrow led into them (the loop started the workflow).
  for (const box of boxes.filter(b => b.expanded)) {
    if (!result.some(e => e.source === box.id)) {
      const first = out.find(n => shownBy.get(n.id) === box.id);
      if (first) link(box.id, first.id);
    }
  }
  return { nodes: out, edges: result, boxes };
}
