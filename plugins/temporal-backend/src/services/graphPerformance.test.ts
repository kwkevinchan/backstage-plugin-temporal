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

import { performance } from 'node:perf_hooks';
import type { WorkflowGraphEdge } from '../common';
import {
  agentInferredToolsHistory,
  agentMultiCallReversedHistory,
  agentToolCallIdHistory,
  largePayloadFewStepsHistory,
  largePayloadManyEventsHistory,
  localActivitiesHistory,
  plainParallelBatchHistory,
  syntheticMultiCallAdapter,
} from '../__testUtils__/syntheticHistory';
import {
  buildWorkflowGraph,
  buildWorkflowGraphWithLlm,
  MAX_GRAPH_EDGES,
} from './graph';
import { LlmAdapters } from './llm/LlmAdapters';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const enc = (v: unknown) => ({
  payloads: [
    {
      metadata: { encoding: b64('json/plain') },
      data: b64(JSON.stringify(v)),
    },
  ],
});

/**
 * Reference O(N^2) interval transitive reduction for edge equivalence checks.
 */
function referenceEdges(
  spans: Array<{ id: string; first: number; last?: number }>,
): WorkflowGraphEdge[] {
  const ordered = [...spans].sort((x, y) => x.first - y.first);
  const edges: WorkflowGraphEdge[] = [];
  for (const target of ordered) {
    let latestStart = -Infinity;
    for (const other of ordered) {
      if (other.last !== undefined && other.last < target.first) {
        latestStart = Math.max(latestStart, other.first);
      }
    }
    for (const source of ordered) {
      if (
        source !== target &&
        source.last !== undefined &&
        source.last < target.first &&
        source.last >= latestStart
      ) {
        if (edges.length >= MAX_GRAPH_EDGES) return edges;
        edges.push({
          id: `${source.id}->${target.id}`,
          source: source.id,
          target: target.id,
        });
      }
    }
  }
  return edges;
}

describe('graph building performance and edge/linking equivalence', () => {
  it('produces the exact transitive-reduction edges for overlapping, open and capped intervals', () => {
    const events: any[] = [
      {
        eventId: '1',
        eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
        workflowExecutionStartedEventAttributes: {
          workflowType: { name: 'overlapTest' },
          taskQueue: { name: 'default' },
        },
      },
      // Two overlapping closed timers and one open timer sharing start boundaries.
      {
        eventId: '2',
        eventType: 'EVENT_TYPE_TIMER_STARTED',
        timerStartedEventAttributes: { timerId: 't1' },
      },
      {
        eventId: '3',
        eventType: 'EVENT_TYPE_TIMER_STARTED',
        timerStartedEventAttributes: { timerId: 't2' },
      },
      {
        eventId: '4',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        activityTaskScheduledEventAttributes: {
          activityId: 'open-act',
          activityType: { name: 'wait' },
        },
      },
      {
        eventId: '5',
        eventType: 'EVENT_TYPE_TIMER_FIRED',
        timerFiredEventAttributes: { timerId: 't1', startedEventId: '2' },
      },
      {
        eventId: '6',
        eventType: 'EVENT_TYPE_TIMER_FIRED',
        timerFiredEventAttributes: { timerId: 't2', startedEventId: '3' },
      },
      // Two parallel steps started after timers fired.
      {
        eventId: '7',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        activityTaskScheduledEventAttributes: {
          activityId: 'a1',
          activityType: { name: 'stepA' },
          input: enc({ n: 1 }),
        },
      },
      {
        eventId: '8',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED',
        activityTaskScheduledEventAttributes: {
          activityId: 'a2',
          activityType: { name: 'stepB' },
          input: enc({ n: 2 }),
        },
      },
      {
        eventId: '9',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED',
        activityTaskCompletedEventAttributes: { scheduledEventId: '7' },
      },
      {
        eventId: '10',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED',
        activityTaskCompletedEventAttributes: { scheduledEventId: '8' },
      },
      {
        eventId: '11',
        eventType: 'EVENT_TYPE_TIMER_STARTED',
        timerStartedEventAttributes: { timerId: 't3' },
      },
      {
        eventId: '12',
        eventType: 'EVENT_TYPE_TIMER_FIRED',
        timerFiredEventAttributes: { timerId: 't3', startedEventId: '11' },
      },
    ];

    const graph = buildWorkflowGraph(events, {
      namespace: 'default',
      workflowId: 'overlap-1',
      status: 'Running',
      truncated: false,
      includePayloads: false,
    });
    const visibleSpans = graph.nodes
      .filter(n => !n.internal)
      .map(n => ({
        id: n.id,
        first: Number(n.events[0].eventId),
        last:
          n.kind === 'activity' && n.id === 'activity-4'
            ? undefined
            : Number(n.events[n.events.length - 1].eventId),
      }));
    expect(graph.edges).toEqual(referenceEdges(visibleSpans));

    // Verify exact order when hitting MAX_GRAPH_EDGES on dense parallel fan-out.
    const onCapped = jest.fn();
    const capped = buildWorkflowGraph(plainParallelBatchHistory(150, 10), {
      namespace: 'default',
      workflowId: 'capped-1',
      status: 'Completed',
      truncated: false,
      includePayloads: false,
      onEdgesCapped: onCapped,
    });
    expect(capped.edges).toHaveLength(MAX_GRAPH_EDGES);
    expect(onCapped).toHaveBeenCalledTimes(1);
    const cappedSpans = capped.nodes
      .filter(n => !n.internal)
      .map(n => ({
        id: n.id,
        first: Number(n.events[0].eventId),
        last: Number(n.events[n.events.length - 1].eventId),
      }));
    expect(capped.edges).toEqual(referenceEdges(cappedSpans));
  });

  // Generous CI-safe ceiling (~1.5s vs ~30-40ms typical local runtime) to
  // catch quadratic regressions without flapping on shared runners.
  const CI_BUDGET_MS = 1500;

  it('links large ~5,000-event toolCallId and inferred OpenAI agent histories within budget', () => {
    const idEvents = agentToolCallIdHistory();
    const t0 = performance.now();
    const idResult = buildWorkflowGraphWithLlm(idEvents, {
      namespace: 'default',
      workflowId: 'perf-tool-id',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
    });
    const idMs = performance.now() - t0;
    expect(idMs).toBeLessThan(CI_BUDGET_MS);
    expect(idResult.graph.nodes.filter(n => n.llm)).toHaveLength(235);
    expect(
      idResult.graph.nodes.filter(n => n.tool?.llmNodeId && !n.tool.inferred),
    ).toHaveLength(940);

    const inferredEvents = agentInferredToolsHistory();
    const t1 = performance.now();
    const inferredResult = buildWorkflowGraphWithLlm(inferredEvents, {
      namespace: 'default',
      workflowId: 'perf-inferred',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
    });
    const inferredMs = performance.now() - t1;
    expect(inferredMs).toBeLessThan(CI_BUDGET_MS);
    expect(inferredResult.graph.nodes.filter(n => n.llm)).toHaveLength(235);
    expect(
      inferredResult.graph.nodes.filter(
        n => n.tool?.llmNodeId && n.tool.inferred,
      ),
    ).toHaveLength(940);
  });

  it('builds a reversed multi-call 1,550-tool agent workflow accurately within budget', () => {
    const adapters = LlmAdapters.builtIn();
    adapters.add(syntheticMultiCallAdapter);
    const events = agentMultiCallReversedHistory();

    const t0 = performance.now();
    const { graph, llm } = buildWorkflowGraphWithLlm(events, {
      namespace: 'default',
      workflowId: 'perf-multi-rev',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
      llmAdapters: adapters,
    });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(CI_BUDGET_MS);
    expect(llm.calls.size).toBe(31);
    const linked = graph.nodes.filter(
      n => n.tool?.llmNodeId && n.tool.inferred,
    );
    expect(linked).toHaveLength(1550);

    // Call 0-0 requested item-0-0; reversed scheduling placed it at tool-0-49.
    const firstAgent = graph.nodes.find(n => n.llm)!;
    const firstToolRef = firstAgent.llm!.toolCalls[0];
    const matchedNode = graph.nodes.find(n => n.id === firstToolRef.nodeId);
    expect(matchedNode?.stepId).toBe('tool-0-49');
  });

  it('builds edges for 4,400 local activities (~5,000 events) within budget', () => {
    const events = localActivitiesHistory();
    const t0 = performance.now();
    const graph = buildWorkflowGraph(events, {
      namespace: 'default',
      workflowId: 'perf-local-acts',
      status: 'Completed',
      truncated: false,
      includePayloads: false,
    });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(CI_BUDGET_MS);
    expect(graph.nodes.filter(n => !n.internal)).toHaveLength(4402);
    expect(graph.edges).toHaveLength(4401);
  });

  it('builds large-payload synthetic histories with expected event counts and payload visibility', () => {
    const fewStructured = largePayloadFewStepsHistory({
      activities: 2,
      payloadBytes: 2048,
      shape: 'structured',
    });
    expect(fewStructured).toHaveLength(17);
    const fewGraphWith = buildWorkflowGraph(fewStructured, {
      namespace: 'default',
      workflowId: 'perf-few-with',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
    });
    const fewActivitiesWith = fewGraphWith.nodes.filter(
      n => n.kind === 'activity',
    );
    expect(fewActivitiesWith).toHaveLength(2);
    const resultSize = Buffer.byteLength(
      JSON.stringify((fewActivitiesWith[0].result as { value: unknown }).value),
      'utf8',
    );
    expect(resultSize).toBeGreaterThan(1800);
    expect(resultSize).toBeLessThanOrEqual(2048);

    const fewString = largePayloadFewStepsHistory({
      activities: 2,
      payloadBytes: 2048,
      shape: 'string',
    });
    const fewStringGraph = buildWorkflowGraph(fewString, {
      namespace: 'default',
      workflowId: 'perf-few-str',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
    });
    const strAct = fewStringGraph.nodes.find(n => n.kind === 'activity')!;
    expect(
      Buffer.byteLength(
        JSON.stringify((strAct.result as { value: unknown }).value),
        'utf8',
      ),
    ).toBe(2048);

    const fewGraphWithout = buildWorkflowGraph(fewStructured, {
      namespace: 'default',
      workflowId: 'perf-few-without',
      status: 'Completed',
      truncated: false,
      includePayloads: false,
    });
    expect(
      fewGraphWithout.nodes.find(n => n.kind === 'activity')!.result,
    ).toBeUndefined();

    const many = largePayloadManyEventsHistory({
      activities: 3,
      payloadBytes: 1024,
    });
    expect(many).toHaveLength(23);
    const manyGraph = buildWorkflowGraph(many, {
      namespace: 'default',
      workflowId: 'perf-many',
      status: 'Completed',
      truncated: false,
      includePayloads: true,
    });
    const manyAct = manyGraph.nodes.find(n => n.kind === 'activity')!;
    const inputSize = Buffer.byteLength(
      JSON.stringify((manyAct.input as { value: unknown }).value),
      'utf8',
    );
    expect(inputSize).toBeGreaterThan(800);
    expect(inputSize).toBeLessThanOrEqual(1024);
  });
});
