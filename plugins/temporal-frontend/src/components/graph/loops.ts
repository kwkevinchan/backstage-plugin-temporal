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

/**
 * How one loop is shown: collapsed into one box, or expanded with every
 * round of the run in its own frame.
 */
export interface LoopView {
  expanded: boolean;
  /**
   * The round to bring into view when expanded (a round picked in the
   * Loops tab). Left out: the running round, else a failed round, else the
   * last one.
   */
  iteration?: number;
}

export type LoopViews = Record<string, LoopView>;

/** The frame of one round of an expanded loop. */
export interface RoundFrame {
  /** `loop:<name>#<iteration>`. */
  id: string;
  round: WorkflowLoopRound;
  /** Steps of the round in the graph, in graph order. */
  stepIds: string[];
}

/** The box of a loop in the graph. */
export interface LoopBox {
  id: string;
  loop: WorkflowLoopGroup;
  expanded: boolean;
  /** The latest round. */
  round?: WorkflowLoopRound;
  /** Frames of the rounds of this run, oldest first; empty when collapsed. */
  frames: RoundFrame[];
  /** The loop started in an earlier run (continued as new). */
  fromEarlierRun?: boolean;
}

/** Prefix of the node IDs of loop boxes, so they never clash with steps. */
export const LOOP_NODE_PREFIX = 'loop:';

export function loopNodeId(name: string): string {
  return `${LOOP_NODE_PREFIX}${name}`;
}

/** ID of the frame of a round. */
export function roundFrameId(name: string, iteration: number): string {
  return `${loopNodeId(name)}#${iteration}`;
}

/**
 * The frame an expanded loop brings into view: the round named in the
 * view, else the running round, else the last failed round, else the last
 * round.
 */
export function focusFrame(
  box: LoopBox,
  view?: LoopView,
): RoundFrame | undefined {
  const { frames } = box;
  if (frames.length === 0) return undefined;
  const named =
    view?.iteration !== undefined
      ? frames.find(f => f.round.iteration === view.iteration)
      : undefined;
  if (named) return named;
  const running = frames.find(f => f.round.status === 'Running');
  if (running) return running;
  const failed = [...frames].reverse().find(f => f.round.status === 'Failed');
  return failed ?? frames[frames.length - 1];
}

/** The loop and round a step belongs to. */
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

export interface GroupedLoops {
  /**
   * Steps and loop boxes of the main graph. An expanded loop is one box
   * here too: its rounds are laid out inside it.
   */
  nodes: Node[];
  /** Arrows of the main graph. */
  edges: WorkflowGraphEdge[];
  boxes: LoopBox[];
  /** Steps of each round frame. */
  frameSteps: Map<string, WorkflowGraphNode[]>;
  /** Arrows between the steps of each round frame. */
  frameEdges: Map<string, WorkflowGraphEdge[]>;
}

/**
 * The graph with each loop as one box. A collapsed loop is one box for all
 * its rounds. An expanded loop is one box too, with a frame for each round
 * of the run: the steps of a round go into its frame, and arrows between
 * rounds are left out (the frames are joined in round order). Arrows into
 * and out of the loop go to its box.
 *
 * A step belongs to the first loop that lists it, so loops inside loops
 * show as boxes next to each other.
 */
export function groupLoops(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  loops: WorkflowLoopGroup[] | undefined,
  views: LoopViews,
  options: { previousRun?: boolean } = {},
): GroupedLoops {
  const empty = {
    frameSteps: new Map<string, WorkflowGraphNode[]>(),
    frameEdges: new Map<string, WorkflowGraphEdge[]>(),
  };
  if (!loops || loops.length === 0) {
    return { nodes, edges, boxes: [], ...empty };
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  /** Step ID to the box it is in. */
  const boxOf = new Map<string, string>();
  /** Step ID to its round frame, for expanded loops. */
  const frameOf = new Map<string, string>();
  const boxes: LoopBox[] = [];
  const { frameSteps, frameEdges } = empty;
  for (const loop of loops) {
    const id = loopNodeId(loop.name);
    const view = views[loop.name];
    const expanded = Boolean(view?.expanded) && loop.rounds.length > 0;
    let members = 0;
    const frames: RoundFrame[] = [];
    for (const round of loop.rounds) {
      const frame: RoundFrame = {
        id: roundFrameId(loop.name, round.iteration),
        round,
        stepIds: [],
      };
      for (const step of round.steps) {
        if (!byId.has(step.nodeId) || boxOf.has(step.nodeId)) continue;
        boxOf.set(step.nodeId, id);
        members++;
        if (expanded) {
          frameOf.set(step.nodeId, frame.id);
          frame.stepIds.push(step.nodeId);
        }
      }
      if (expanded) frames.push(frame);
    }
    if (members === 0 && loop.rounds.length === 0) continue;
    const first = loop.rounds[0];
    boxes.push({
      id,
      loop,
      expanded,
      round: loop.rounds[loop.rounds.length - 1],
      frames,
      fromEarlierRun: Boolean(options.previousRun && first?.iteration > 1),
    });
  }
  if (boxes.length === 0) return { nodes, edges, boxes, ...empty };

  // Steps of each frame in graph order.
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  for (const box of boxes) {
    for (const frame of box.frames) {
      frame.stepIds.sort((a, b) => order.get(a)! - order.get(b)!);
      frameSteps.set(
        frame.id,
        frame.stepIds.map(s => byId.get(s)!),
      );
      frameEdges.set(frame.id, []);
    }
  }

  const out: Node[] = [];
  const placed = new Set<string>();
  const boxById = new Map(boxes.map(b => [b.id, b]));
  for (const node of nodes) {
    const box = boxOf.get(node.id);
    if (!box) {
      out.push(node);
      continue;
    }
    if (!placed.has(box)) {
      placed.add(box);
      out.push({ id: box, loopBox: boxById.get(box)! });
    }
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
  for (const edge of edges) {
    const frame = frameOf.get(edge.source);
    if (frame && frame === frameOf.get(edge.target)) {
      frameEdges.get(frame)!.push(edge);
      continue;
    }
    link(
      boxOf.get(edge.source) ?? edge.source,
      boxOf.get(edge.target) ?? edge.target,
    );
  }
  return { nodes: out, edges: result, boxes, frameSteps, frameEdges };
}
