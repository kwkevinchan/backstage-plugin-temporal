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

import type { WorkflowGraphEdge, WorkflowGraphResponse } from '../common';
import { dropUndefined } from './convert';
import { ProgressOptions, readRunState } from './graphProgress';
import { readSteps, Step } from './graphSteps';
import { LlmStepEntry, LlmSteps, readLlmSteps } from './llm/llm';

export { STEP_KINDS } from './graphProgress';

/*
 * The graph of a run: its steps (nodes, see `graphSteps.ts`), where the run
 * is (see `graphProgress.ts`) and the arrows between the steps (edges).
 *
 * Arrows: a step B follows a step A when B started after A ended (by event
 * ID). Only the closest such steps are linked (transitive reduction), so
 * steps whose time ranges overlap, for example activities scheduled in the
 * same workflow task, become parallel branches. Steps that are still open
 * have no outgoing arrows.
 */

type Json = any;

/** Most arrows of one graph; beyond that the graph is too dense to read. */
export const MAX_GRAPH_EDGES = 5000;

export interface BuildGraphOptions extends ProgressOptions {
  /** Called when arrows beyond {@link MAX_GRAPH_EDGES} were left out. */
  onEdgesCapped?: () => void;
}

export function buildWorkflowGraph(
  events: Json[],
  options: BuildGraphOptions,
): WorkflowGraphResponse {
  return buildWorkflowGraphWithLlm(events, options).graph;
}

/**
 * The graph of a run, the model calls the LLM adapters read from its steps
 * (by node ID), and the payloads of the activities and local activities
 * that the adapters read them from.
 */
export function buildWorkflowGraphWithLlm(
  events: Json[],
  options: BuildGraphOptions,
): {
  graph: WorkflowGraphResponse;
  llm: LlmSteps;
  llmEntries: LlmStepEntry[];
} {
  const steps = readSteps(events, options, { details: true });
  const { nodes, llmEntries } = steps;

  // Model calls and tool calls, read by the LLM adapters.
  const llm = readLlmSteps(llmEntries);
  // After the model calls: the groups add up their tokens.
  const groups = steps.eventGroups.build(nodes, {
    status: options.status,
    end: nodes.find(n => n.kind === 'workflowClosed'),
    truncated: options.truncated,
  });

  const state = readRunState(steps, options);
  const edges = buildEdges(state.visible, options.onEdgesCapped);

  const startNode = nodes.find(n => n.kind === 'workflowStarted');
  const endNode = nodes.find(n => n.kind === 'workflowClosed');
  const previousRunId = startNode?.details?.continuedFromRunId;
  const nextRunId =
    endNode?.status === 'ContinuedAsNew' ? endNode.workflow?.runId : undefined;
  const response: WorkflowGraphResponse = {
    status: options.status,
    nodes: nodes.map(({ first: _f, last: _l, ...node }) => dropUndefined(node)),
    edges,
    current: state.current,
    currentDeadline: state.currentDeadline,
    completedSteps: state.completedSteps,
    totalSteps: state.totalSteps,
    truncated: options.truncated,
    runChain:
      typeof previousRunId === 'string' || nextRunId
        ? dropUndefined({
            previousRunId:
              typeof previousRunId === 'string' ? previousRunId : undefined,
            nextRunId,
          })
        : undefined,
    eventGroups: groups.groups.length > 0 ? groups.groups : undefined,
    eventGroupsTruncated: groups.truncated || undefined,
  };
  return { graph: dropUndefined(response), llm, llmEntries };
}

/**
 * Arrows of the interval order of the steps, reduced to the closest
 * predecessors: A → B when A ended before B started and no step C started
 * after A ended and ended before B started.
 */
function buildEdges(nodes: Step[], onCapped?: () => void): WorkflowGraphEdge[] {
  const ordered = [...nodes].sort((x, y) => x.first - y.first);
  const closed = ordered
    .map((node, order) => ({ node, order, last: node.last }))
    .filter(
      (entry): entry is { node: Step; order: number; last: number } =>
        entry.last !== undefined,
    )
    .sort((a, b) => a.last - b.last || a.order - b.order);

  const edges: WorkflowGraphEdge[] = [];
  let endPtr = 0;
  let startPtr = 0;
  let latestStart = -Infinity;

  for (const target of ordered) {
    while (endPtr < closed.length && closed[endPtr].last < target.first) {
      if (closed[endPtr].node.first > latestStart) {
        latestStart = closed[endPtr].node.first;
      }
      endPtr++;
    }
    while (startPtr < endPtr && closed[startPtr].last < latestStart) {
      startPtr++;
    }
    if (startPtr >= endPtr) continue;

    // Preserve `ordered` source emission order when multiple predecessors tie.
    const count = endPtr - startPtr;
    if (count === 1) {
      const source = closed[startPtr].node;
      if (source !== target) {
        if (edges.length >= MAX_GRAPH_EDGES) {
          onCapped?.();
          return edges;
        }
        edges.push({
          id: `${source.id}->${target.id}`,
          source: source.id,
          target: target.id,
        });
      }
      continue;
    }

    const sources = closed
      .slice(startPtr, endPtr)
      .sort((a, b) => a.order - b.order);
    for (const { node: source } of sources) {
      if (source === target) continue;
      if (edges.length >= MAX_GRAPH_EDGES) {
        onCapped?.();
        return edges;
      }
      edges.push({
        id: `${source.id}->${target.id}`,
        source: source.id,
        target: target.id,
      });
    }
  }
  return edges;
}
