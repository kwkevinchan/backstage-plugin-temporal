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

import { Entity } from '@backstage/catalog-model';
import type {
  WorkflowDetail,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowLlmCallResponse,
  WorkflowProgressResponse,
  WorkflowStatsResponse,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowStepsResponse,
  WorkflowLoopsResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type { TemporalApi } from './extensions';

export const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'orders',
    namespace: 'default',
    annotations: { 'temporal.io/task-queue': 'orders' },
  },
  spec: { type: 'service', owner: 'guests' },
};

/** A TemporalWorkflow entity, as the catalog returns it. */
export const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
    system: 'shop',
    lifecycle: 'production',
  },
  relations: [
    { type: 'ownedBy', targetRef: 'group:default/team-a' },
    { type: 'partOf', targetRef: 'system:default/shop' },
    { type: 'dependencyOf', targetRef: 'component:default/checkout' },
  ],
};

/** A component with an annotation that depends on a TemporalWorkflow entity. */
export const checkoutEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'checkout',
    namespace: 'default',
    annotations: { 'temporal.io/workflow-type': 'deploymentWorkflow' },
  },
  spec: {
    type: 'service',
    owner: 'group:default/team-a',
    dependsOn: ['temporalworkflow:default/order-workflow'],
  },
  relations: [
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/order-workflow' },
  ],
};

export const statsResponse: WorkflowStatsResponse = {
  namespace: 'default',
  sampleSize: 7,
  limit: 50,
  byStatus: { Completed: 4, Failed: 2, Running: 1 },
  succeeded: 4,
  failed: 2,
  running: 1,
  averageDurationMs: 2500,
};

export const listResponse: WorkflowListResponse = {
  namespace: 'default',
  nextPageToken: 'next',
  items: [
    {
      namespace: 'default',
      workflowId: 'order-1',
      runId: 'run-1',
      workflowType: 'orderWorkflow',
      status: 'Completed',
      startTime: '2026-01-01T10:00:00.000Z',
      closeTime: '2026-01-01T10:00:05.000Z',
    },
    {
      namespace: 'default',
      workflowId: 'payment-1',
      runId: 'run-2',
      workflowType: 'paymentWorkflow',
      status: 'Failed',
      startTime: '2026-01-01T11:00:00.000Z',
      closeTime: '2026-01-01T11:00:01.000Z',
    },
  ],
};

export const failedWorkflow: WorkflowDetail = {
  ...listResponse.items[1],
  taskQueue: 'orders',
  webUiUrl:
    'http://temporal-ui/namespaces/default/workflows/payment-1/run-2/history',
  failure: {
    message: 'Payment could not be completed',
    kind: 'ApplicationFailure',
    type: 'PaymentFailed',
    cause: {
      message: 'Activity task failed',
      kind: 'ActivityFailure',
      cause: { message: 'Card declined', kind: 'ApplicationFailure' },
    },
  },
  pendingActivities: [
    {
      activityId: '3',
      activityType: 'waitForUpstream',
      state: 'Scheduled',
      attempt: 4,
      lastFailure: { message: 'Upstream not ready' },
    },
  ],
};

export const historyResponse: WorkflowHistoryResponse = {
  events: [
    {
      eventId: '1',
      eventTime: '2026-01-01T11:00:00.000Z',
      eventType: 'WorkflowExecutionStarted',
      attributes: {
        input: { payloads: [{ encoding: 'json/plain', value: 1 }] },
      },
    },
  ],
};

export const stepsResponse: WorkflowStepsResponse = {
  input: { encoding: 'json/plain', value: { paymentId: 'pay-1', amount: 42 } },
  truncated: false,
  activities: [
    {
      activityId: '1',
      activityType: 'reserveStock',
      scheduledEventId: '5',
      status: 'Completed',
      input: { encoding: 'json/plain', value: { sku: 'BOOK-1' } },
      result: { encoding: 'json/plain', value: { reserved: true } },
    },
    {
      activityId: '2',
      activityType: 'chargeCard',
      scheduledEventId: '11',
      status: 'Failed',
      input: { encoding: 'binary/encrypted', size: 64, undecodable: true },
      failure: { message: 'Card declined', kind: 'ApplicationFailure' },
    },
  ],
};

export const graphResponse: WorkflowGraphResponse = {
  status: 'Failed',
  current: 'Failed at chargeCard',
  completedSteps: 1,
  totalSteps: 2,
  truncated: false,
  payloadsHidden: false,
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      startTime: '2026-01-01T11:00:00.000Z',
      endTime: '2026-01-01T11:00:00.000Z',
      input: {
        encoding: 'json/plain',
        value: { paymentId: 'pay-1', amount: 42 },
      },
      events: [{ eventId: '1', eventType: 'WorkflowExecutionStarted' }],
    },
    {
      id: 'workflowTask-2',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      events: [
        { eventId: '2', eventType: 'WorkflowTaskScheduled' },
        { eventId: '3', eventType: 'WorkflowTaskStarted' },
        { eventId: '4', eventType: 'WorkflowTaskCompleted' },
      ],
    },
    {
      id: 'activity-5',
      kind: 'activity',
      name: 'reserveStock',
      stepId: '1',
      status: 'Completed',
      attempt: 1,
      startTime: '2026-01-01T11:00:00.100Z',
      endTime: '2026-01-01T11:00:00.300Z',
      input: { encoding: 'json/plain', value: { sku: 'BOOK-1' } },
      result: { encoding: 'json/plain', value: { reserved: true } },
      events: [
        { eventId: '5', eventType: 'ActivityTaskScheduled' },
        { eventId: '6', eventType: 'ActivityTaskStarted' },
        { eventId: '7', eventType: 'ActivityTaskCompleted' },
      ],
    },
    {
      id: 'activity-11',
      kind: 'activity',
      name: 'chargeCard',
      stepId: '2',
      status: 'Failed',
      attempt: 2,
      maximumAttempts: 2,
      startTime: '2026-01-01T11:00:00.400Z',
      endTime: '2026-01-01T11:00:00.900Z',
      input: { encoding: 'binary/encrypted', size: 64, undecodable: true },
      failure: { message: 'Card declined', kind: 'ApplicationFailure' },
      attempts: [
        { attempt: 1, status: 'Failed', failure: { message: 'Bank timeout' } },
        {
          attempt: 2,
          status: 'Failed',
          failure: { message: 'Card declined', kind: 'ApplicationFailure' },
        },
      ],
      events: [
        { eventId: '11', eventType: 'ActivityTaskScheduled' },
        { eventId: '12', eventType: 'ActivityTaskStarted' },
        { eventId: '13', eventType: 'ActivityTaskFailed' },
      ],
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Failed',
      failure: { message: 'Payment could not be completed' },
      events: [{ eventId: '17', eventType: 'WorkflowExecutionFailed' }],
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    {
      id: 'activity-5->activity-11',
      source: 'activity-5',
      target: 'activity-11',
    },
    { id: 'activity-11->end', source: 'activity-11', target: 'end' },
  ],
};

export const progressResponse: WorkflowProgressResponse = {
  status: 'Failed',
  completedSteps: 1,
  totalSteps: 2,
  current: 'Failed at chargeCard',
  truncated: false,
};

const loopStep = (
  id: string,
  name: string,
  iteration: number,
  time: number,
): WorkflowGraphResponse['nodes'][number] => ({
  id,
  kind: 'activity',
  name,
  status: 'Completed',
  stepId: `loop/draft-review/${iteration}/${name}`,
  loop: { loop: 'draft-review', iteration, step: name },
  startTime: new Date(Date.UTC(2026, 0, 1, 11, 0, time)).toISOString(),
  endTime: new Date(Date.UTC(2026, 0, 1, 11, 0, time + 1)).toISOString(),
  events: [],
});

/** A run with a loop of two rounds (draft, review), then publish. */
export const loopGraphResponse: WorkflowGraphResponse = {
  status: 'Completed',
  completedSteps: 5,
  totalSteps: 5,
  truncated: false,
  payloadsHidden: false,
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      events: [],
    },
    loopStep('activity-5', 'llmDraft', 1, 1),
    loopStep('activity-8', 'llmReview', 1, 2),
    loopStep('activity-12', 'llmDraft', 2, 3),
    loopStep('activity-15', 'llmReview', 2, 4),
    {
      id: 'activity-20',
      kind: 'activity',
      name: 'publishDraft',
      status: 'Completed',
      events: [],
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Completed',
      events: [],
    },
  ],
  edges: [
    ['start', 'activity-5'],
    ['activity-5', 'activity-8'],
    ['activity-8', 'activity-12'],
    ['activity-12', 'activity-15'],
    ['activity-15', 'activity-20'],
    ['activity-20', 'end'],
  ].map(([source, target]) => ({ id: `${source}->${target}`, source, target })),
  loops: [
    {
      name: 'draft-review',
      status: 'done',
      iteration: 2,
      maxIterations: 5,
      decision: 'accept',
      score: 0.9,
      rounds: [1, 2].map(iteration => ({
        iteration,
        status: 'Completed' as const,
        decision: iteration === 2 ? 'accept' : 'revise',
        score: iteration === 2 ? 0.9 : 0.5,
        steps: [
          {
            nodeId: iteration === 1 ? 'activity-5' : 'activity-12',
            name: 'llmDraft',
            kind: 'activity' as const,
            status: 'Completed' as const,
          },
          {
            nodeId: iteration === 1 ? 'activity-8' : 'activity-15',
            name: 'llmReview',
            kind: 'activity' as const,
            status: 'Completed' as const,
          },
        ],
      })),
    },
  ],
};

/** The loop across two runs: round 1 ran in an earlier run. */
export const loopsResponse: WorkflowLoopsResponse = {
  source: 'history',
  truncated: false,
  runs: [
    { runId: 'run-1', segment: 1, status: 'ContinuedAsNew' },
    { runId: 'run-2', segment: 2, status: 'Completed' },
  ],
  loops: [
    {
      ...loopGraphResponse.loops![0],
      rounds: loopGraphResponse.loops![0].rounds.map(r => ({
        ...r,
        runId: r.iteration === 1 ? 'run-1' : 'run-2',
        segment: r.iteration === 1 ? 1 : 2,
      })),
    },
  ],
};

/** Start of the run in {@link timelineNodes}. */
export const TIMELINE_T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const tAt = (seconds: number) =>
  new Date(TIMELINE_T0 + seconds * 1000).toISOString();

/**
 * Steps of a running order workflow for the timeline: a quick activity, a
 * failed one after retries, a timer, a signal, a running activity and a
 * wait.
 */
export const timelineNodes: WorkflowGraphNode[] = [
  {
    id: 'start',
    kind: 'workflowStarted',
    name: 'Start',
    status: 'Completed',
    startTime: tAt(0),
    endTime: tAt(0),
    events: [],
  },
  {
    id: 'activity-5',
    kind: 'activity',
    name: 'reserveStock',
    status: 'Completed',
    startTime: tAt(1),
    endTime: tAt(4),
    attempt: 1,
    events: [
      { eventId: '5', eventType: 'ActivityTaskScheduled', eventTime: tAt(1) },
      { eventId: '6', eventType: 'ActivityTaskStarted', eventTime: tAt(2) },
      { eventId: '7', eventType: 'ActivityTaskCompleted', eventTime: tAt(4) },
    ],
  },
  {
    id: 'activity-9',
    kind: 'activity',
    name: 'chargeCard',
    status: 'Failed',
    startTime: tAt(5),
    endTime: tAt(20),
    attempt: 3,
    maximumAttempts: 3,
    events: [
      { eventId: '9', eventType: 'ActivityTaskScheduled', eventTime: tAt(5) },
      { eventId: '10', eventType: 'ActivityTaskStarted', eventTime: tAt(15) },
      { eventId: '11', eventType: 'ActivityTaskFailed', eventTime: tAt(20) },
    ],
  },
  {
    id: 'timer-12',
    kind: 'timer',
    name: 'Timer 10s',
    status: 'Completed',
    startTime: tAt(21),
    endTime: tAt(31),
    events: [],
  },
  {
    id: 'signal-14',
    kind: 'signal',
    name: 'approve',
    status: 'Completed',
    startTime: tAt(25),
    endTime: tAt(25),
    events: [],
  },
  {
    id: 'wft-3',
    kind: 'workflowTask',
    name: 'Workflow task',
    status: 'Completed',
    internal: true,
    startTime: tAt(0),
    events: [],
  },
  {
    id: 'activity-16',
    kind: 'activity',
    name: 'ship',
    status: 'Running',
    startTime: tAt(32),
    attempt: 1,
    attempts: [{ attempt: 1, status: 'Running', startedTime: tAt(34) }],
    events: [
      { eventId: '16', eventType: 'ActivityTaskScheduled', eventTime: tAt(32) },
    ],
  },
  {
    id: 'waiting',
    kind: 'waiting',
    name: 'Waiting',
    status: 'Waiting',
    events: [],
  },
];

/** An agent run: a model call with a tool call, then a final model call. */
export const llmGraphResponse: WorkflowGraphResponse = {
  status: 'Completed',
  completedSteps: 3,
  totalSteps: 3,
  truncated: false,
  payloadsHidden: false,
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      startTime: '2026-11-03T10:00:00.000Z',
      endTime: '2026-11-03T10:00:00.000Z',
      events: [],
    },
    {
      id: 'activity-5',
      kind: 'activity',
      name: 'callModel',
      status: 'Completed',
      stepId: 'llm/r1/loop/agent/1/callModel',
      startTime: '2026-11-03T10:00:01.000Z',
      endTime: '2026-11-03T10:00:03.000Z',
      loop: { loop: 'agent', iteration: 1, step: 'callModel' },
      llm: {
        call: 'r1',
        record: 'available',
        operation: 'chat',
        provider: 'openai',
        model: 'fake-reasoner-1',
        usage: { inputTokens: 1240, outputTokens: 96, reasoningTokens: 40 },
        durationMs: 1500,
        reasoning: true,
        toolCalls: [
          {
            id: 'call_1a',
            name: 'search',
            nodeId: 'activity-8',
            status: 'Completed',
          },
        ],
      },
      events: [],
    },
    {
      id: 'activity-8',
      kind: 'activity',
      name: 'search',
      status: 'Completed',
      stepId: 'tool/r1/call_1a/loop/agent/1/search',
      startTime: '2026-11-03T10:00:04.000Z',
      endTime: '2026-11-03T10:00:04.300Z',
      attempt: 2,
      result: { encoding: 'json/plain', value: { hits: 2 } },
      loop: { loop: 'agent', iteration: 1, step: 'search' },
      tool: {
        call: 'r1',
        toolCallId: 'call_1a',
        llmNodeId: 'activity-5',
        name: 'search',
      },
      events: [],
    },
    {
      id: 'activity-11',
      kind: 'activity',
      name: 'callModel',
      status: 'Completed',
      stepId: 'llm/r2/loop/agent/2/callModel',
      startTime: '2026-11-03T10:00:05.000Z',
      endTime: '2026-11-03T10:00:06.000Z',
      loop: { loop: 'agent', iteration: 2, step: 'callModel' },
      llm: {
        call: 'r2',
        record: 'available',
        model: 'fake-reasoner-1',
        usage: { inputTokens: 1500, outputTokens: 300 },
        durationMs: 900,
        reasoning: false,
        toolCalls: [],
      },
      events: [],
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Completed',
      startTime: '2026-11-03T10:00:07.000Z',
      endTime: '2026-11-03T10:00:07.000Z',
      events: [],
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    {
      id: 'activity-5->activity-8',
      source: 'activity-5',
      target: 'activity-8',
    },
    {
      id: 'activity-8->activity-11',
      source: 'activity-8',
      target: 'activity-11',
    },
    { id: 'activity-11->end', source: 'activity-11', target: 'end' },
  ],
  loops: [
    {
      name: 'agent',
      status: 'done',
      iteration: 2,
      rounds: [
        {
          iteration: 1,
          status: 'Completed',
          usage: { inputTokens: 1240, outputTokens: 96, reasoningTokens: 40 },
          llmCalls: 1,
          steps: [
            {
              nodeId: 'activity-5',
              name: 'callModel',
              kind: 'activity',
              status: 'Completed',
              llm: 'llm',
              usage: { inputTokens: 1240, outputTokens: 96 },
            },
            {
              nodeId: 'activity-8',
              name: 'search',
              kind: 'activity',
              status: 'Completed',
              llm: 'tool',
            },
          ],
        },
        {
          iteration: 2,
          status: 'Completed',
          usage: { inputTokens: 1500, outputTokens: 300 },
          llmCalls: 1,
          steps: [
            {
              nodeId: 'activity-11',
              name: 'callModel',
              kind: 'activity',
              status: 'Completed',
              llm: 'llm',
              usage: { inputTokens: 1500, outputTokens: 300 },
            },
          ],
        },
      ],
    },
  ],
};

/** The full record of the first model call of {@link llmGraphResponse}. */
export const llmCallResponse: WorkflowLlmCallResponse = {
  nodeId: 'activity-5',
  activityId: 'llm/r1/loop/agent/1/callModel',
  activityType: 'callModel',
  call: 'r1',
  status: 'Completed',
  record: {
    operation: 'chat',
    provider: 'openai',
    requestModel: 'fake-reasoner-1',
    responseModel: 'fake-reasoner-1',
    finishReasons: ['tool_call'],
    usage: { inputTokens: 1240, outputTokens: 96, reasoningTokens: 40 },
    systemInstructions: [],
    inputMessages: [
      {
        role: 'system',
        parts: [{ type: 'text', content: 'You are a helpful assistant.' }],
      },
      {
        role: 'user',
        parts: [
          { type: 'text', content: `Explain storage. ${'More. '.repeat(150)}` },
        ],
      },
    ],
    outputMessages: [
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', content: 'I should search the docs first.' },
          { type: 'text', content: 'Searching.' },
          {
            type: 'tool_call',
            id: 'call_1a',
            name: 'search',
            arguments: { query: 'storage' },
          },
        ],
      },
    ],
    toolExecutions: [
      {
        id: 'ctx_profile',
        name: 'user_profile',
        result: { role: 'developer' },
        durationMs: 80,
      },
    ],
    durationMs: 1500,
  },
  raw: { v: 1, attributes: { 'gen_ai.request.model': 'fake-reasoner-1' } },
};

export function mockTemporalApi(): jest.Mocked<TemporalApi> {
  return {
    listEntityWorkflows: jest.fn().mockResolvedValue(listResponse),
    listWorkflows: jest.fn().mockResolvedValue(listResponse),
    getEntityWorkflowStats: jest.fn().mockResolvedValue(statsResponse),
    getWorkflow: jest.fn().mockResolvedValue(failedWorkflow),
    getWorkflowHistory: jest.fn().mockResolvedValue(historyResponse),
    getWorkflowSteps: jest.fn().mockResolvedValue(stepsResponse),
    getWorkflowGraph: jest.fn().mockResolvedValue(graphResponse),
    getWorkflowProgress: jest.fn().mockResolvedValue(progressResponse),
    getWorkflowLoops: jest.fn().mockResolvedValue(loopsResponse),
    getLlmCall: jest.fn().mockResolvedValue(llmCallResponse),
    downloadPayload: jest
      .fn()
      .mockResolvedValue(new Blob(['{}'], { type: 'application/json' })),
    queryWorkflow: jest.fn().mockResolvedValue({ result: { notes: [] } }),
    getWorkflowHandlers: jest.fn().mockResolvedValue({
      signals: [{ name: 'approve' }],
      updates: [{ name: 'setPriority' }],
      queries: [{ name: 'notes' }],
    }),
  };
}
