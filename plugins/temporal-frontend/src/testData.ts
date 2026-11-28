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
import type { JsonObject } from '@backstage/types';
import type {
  WorkflowDetail,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowLlmCallResponse,
  WorkflowProgressResponse,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  TemporalSchedule,
  TemporalScheduleListResponse,
} from './common';
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

/** One payload of each kind the plugin cannot decode. */
export const undecodablePayloads: Record<string, JsonObject> = {
  encrypted: {
    encoding: 'binary/encrypted',
    size: 64,
    undecodable: true,
    metadata: { 'encryption-key-id': 'payments-key-1' },
  },
  binary: { encoding: 'binary/plain', size: 2048, undecodable: true },
  protobuf: {
    encoding: 'binary/protobuf',
    size: 96,
    undecodable: true,
    metadata: { messageType: 'acme.payments.v1.ChargeRequest' },
  },
  invalidJson: { encoding: 'json/plain', size: 17, undecodable: true },
  custom: {
    encoding: 'binary/acme-compressed',
    size: 310,
    undecodable: true,
    metadata: { codec: 'zstd' },
  },
};

export const graphResponse: WorkflowGraphResponse = {
  status: 'Failed',
  current: 'Failed at chargeCard',
  completedSteps: 1,
  totalSteps: 2,
  truncated: false,
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
      input: undecodablePayloads.encrypted,
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
      summary: 'r1',
      status: 'Completed',
      stepId: 'model-1',
      startTime: '2026-11-03T10:00:01.000Z',
      endTime: '2026-11-03T10:00:03.000Z',
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
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
      stepId: 'search-1',
      startTime: '2026-11-03T10:00:04.000Z',
      endTime: '2026-11-03T10:00:04.300Z',
      attempt: 2,
      result: { encoding: 'json/plain', value: { hits: 2 } },
      tool: {
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
      summary: 'r2',
      status: 'Completed',
      stepId: 'model-2',
      startTime: '2026-11-03T10:00:05.000Z',
      endTime: '2026-11-03T10:00:06.000Z',
      llm: {
        framework: 'vercel-ai-sdk',
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
};

/** The full record of the first model call of {@link llmGraphResponse}. */
export const llmCallResponse: WorkflowLlmCallResponse = {
  framework: 'vercel-ai-sdk',
  nodeId: 'activity-5',
  activityId: 'model-1',
  activityType: 'invokeModel',
  status: 'Completed',
  record: {
    provider: 'openai',
    requestModel: 'fake-reasoner-1',
    responseModel: 'fake-reasoner-1',
    responseId: 'resp_9f2c',
    finishReasons: ['tool_call'],
    parameters: { temperature: 0.2, maxOutputTokens: 512 },
    toolDefinitions: [
      {
        type: 'function',
        name: 'search',
        description: 'Search the docs.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ],
    usage: {
      inputTokens: 1240,
      outputTokens: 96,
      reasoningTokens: 40,
      cacheReadInputTokens: 800,
      cacheWriteInputTokens: 440,
    },
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
    durationMs: 1500,
  },
  raw: { v: 1, attributes: { 'gen_ai.request.model': 'fake-reasoner-1' } },
};

/** One schedule of the Temporal page. */
export const nightlySchedule: TemporalSchedule = {
  namespace: 'default',
  scheduleId: 'nightly-orders',
  workflowType: 'orderWorkflow',
  spec: ['02:00 on MONDAY-FRIDAY', 'every 1h'],
  timezone: 'Asia/Taipei',
  paused: false,
  nextActionTimes: ['2026-01-02T02:00:00.000Z'],
  recentActions: [
    {
      takenAt: '2026-01-01T02:00:01.000Z',
      workflowId: 'nightly-orders-2026-01-01T02:00:00Z',
      runId: 'run-n1',
    },
  ],
};

export const scheduleListResponse: TemporalScheduleListResponse = {
  items: [
    nightlySchedule,
    {
      ...nightlySchedule,
      scheduleId: 'weekly-report',
      workflowType: 'reportWorkflow',
      spec: ['every 7d'],
      paused: true,
      note: 'Paused from Backstage by user:default/alice',
      nextActionTimes: [],
      recentActions: [],
    },
  ],
  truncated: false,
};

export function mockTemporalApi(): jest.Mocked<TemporalApi> {
  return {
    listEntityWorkflows: jest.fn().mockResolvedValue(listResponse),
    listWorkflows: jest.fn().mockResolvedValue(listResponse),
    listSchedules: jest.fn().mockResolvedValue(scheduleListResponse),
    listEntitySchedules: jest
      .fn()
      .mockResolvedValue({ items: [], truncated: false }),
    getWorkflowTypeOverview: jest.fn(async (entityRefs: string[]) => ({
      items: entityRefs.map(entityRef => ({
        entityRef,
        running: 0,
        completed: 0,
        failed: 0,
        windowDays: 7,
        sampleSize: 0,
        updatedAt: new Date().toISOString(),
      })),
    })),
    // The run list of the workflow ID of `failedWorkflow`: that run only.
    listWorkflowRuns: jest.fn().mockResolvedValue({
      namespace: 'default',
      items: [failedWorkflow],
    }),
    getWorkflow: jest.fn().mockResolvedValue(failedWorkflow),
    getWorkflowHistory: jest.fn().mockResolvedValue(historyResponse),
    getWorkflowGraph: jest.fn().mockResolvedValue(graphResponse),
    getWorkflowProgress: jest.fn().mockResolvedValue(progressResponse),
    getLlmCall: jest.fn().mockResolvedValue(llmCallResponse),
    queryWorkflow: jest.fn().mockResolvedValue({ result: { notes: [] } }),
    getWorkflowMessageDefinitions: jest.fn().mockResolvedValue({
      signals: [{ name: 'approve' }],
      updates: [{ name: 'setPriority' }],
      queries: [{ name: 'notes' }],
    }),
    signalWorkflow: jest.fn().mockResolvedValue(undefined),
    updateWorkflow: jest.fn().mockResolvedValue({ result: 'ok' }),
    cancelWorkflow: jest.fn().mockResolvedValue(undefined),
    terminateWorkflow: jest.fn().mockResolvedValue(undefined),
    rerunWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'order-1-rerun-abc',
      runId: 'run-new',
    }),
    startWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'started-1',
      runId: 'run-started',
    }),
    runWorkflowAction: jest.fn().mockResolvedValue({ result: { ok: true } }),
    runScheduleOperation: jest.fn().mockResolvedValue(undefined),
  };
}
