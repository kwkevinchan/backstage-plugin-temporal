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

// Written by scripts/event-group-graphs.mjs from test-fixtures/event-groups/parallel.json:
// two groups in parallel, one with a nested group, then two groups that share a step without one being inside the other. Run `yarn sync:test-graphs` to write it again.

import type { WorkflowGraphResponse } from '../common';

export const parallelGraph: WorkflowGraphResponse = {
  status: 'Completed',
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      input: null,
      details: {
        workflowType: 'parallelGroups',
        taskQueue: 'event-groups',
        attempt: 1,
      },
      events: [
        {
          eventId: '1',
          eventType: 'WorkflowExecutionStarted',
          eventTime: '2026-11-14T08:21:39.447Z',
        },
      ],
      startTime: '2026-11-14T08:21:39.447Z',
      endTime: '2026-11-14T08:21:39.447Z',
    },
    {
      id: 'workflowTask-2',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:39.447Z',
      attempt: 1,
      events: [
        {
          eventId: '2',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:39.447Z',
        },
        {
          eventId: '3',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:39.457Z',
        },
        {
          eventId: '4',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:39.475Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.475Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '1',
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.475Z',
      input: { encoding: 'json/plain', value: { name: 'a1', ms: 300 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-5',
      events: [
        {
          eventId: '5',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:39.475Z',
        },
        {
          eventId: '13',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:39.475Z',
        },
        {
          eventId: '14',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:39.783Z',
        },
      ],
      groups: ['label:par:a'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:39.475Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.783Z',
      result: { encoding: 'json/plain', value: { name: 'a1' } },
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '2',
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.475Z',
      input: { encoding: 'json/plain', value: { name: 'b1', ms: 100 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-6',
      events: [
        {
          eventId: '6',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:39.475Z',
        },
        {
          eventId: '7',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:39.475Z',
        },
        {
          eventId: '8',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:39.583Z',
        },
      ],
      groups: ['label:par:b'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:39.475Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.583Z',
      result: { encoding: 'json/plain', value: { name: 'b1' } },
    },
    {
      id: 'workflowTask-9',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:39.583Z',
      attempt: 1,
      events: [
        {
          eventId: '9',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:39.583Z',
        },
        {
          eventId: '10',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:39.589Z',
        },
        {
          eventId: '11',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:39.598Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.598Z',
    },
    {
      kind: 'timer',
      name: 'Timer 200ms',
      stepId: '1',
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.598Z',
      details: { duration: '200ms' },
      id: 'timer-12',
      events: [
        {
          eventId: '12',
          eventType: 'TimerStarted',
          eventTime: '2026-11-14T08:21:39.598Z',
        },
        {
          eventId: '30',
          eventType: 'TimerFired',
          eventTime: '2026-11-14T08:21:40.590Z',
        },
      ],
      groups: ['label:par:b'],
      endTime: '2026-11-14T08:21:40.590Z',
    },
    {
      id: 'workflowTask-15',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:39.783Z',
      attempt: 1,
      events: [
        {
          eventId: '15',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:39.783Z',
        },
        {
          eventId: '16',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:39.789Z',
        },
        {
          eventId: '17',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:39.798Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.798Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '3',
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.798Z',
      input: { encoding: 'json/plain', value: { name: 'a-sub-1', ms: 100 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-18',
      events: [
        {
          eventId: '18',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:39.798Z',
        },
        {
          eventId: '19',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:39.798Z',
        },
        {
          eventId: '20',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:39.904Z',
        },
      ],
      groups: ['label:par:a', 'label:par:a:sub'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:39.798Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.904Z',
      result: { encoding: 'json/plain', value: { name: 'a-sub-1' } },
    },
    {
      id: 'workflowTask-21',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:39.904Z',
      attempt: 1,
      events: [
        {
          eventId: '21',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:39.904Z',
        },
        {
          eventId: '22',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:39.910Z',
        },
        {
          eventId: '23',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:39.919Z',
        },
      ],
      endTime: '2026-11-14T08:21:39.919Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '4',
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.919Z',
      input: { encoding: 'json/plain', value: { name: 'a2', ms: 300 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-24',
      events: [
        {
          eventId: '24',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:39.919Z',
        },
        {
          eventId: '25',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:39.919Z',
        },
        {
          eventId: '26',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:40.227Z',
        },
      ],
      groups: ['label:par:a'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:39.919Z',
        },
      ],
      endTime: '2026-11-14T08:21:40.227Z',
      result: { encoding: 'json/plain', value: { name: 'a2' } },
    },
    {
      id: 'workflowTask-27',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:40.227Z',
      attempt: 1,
      events: [
        {
          eventId: '27',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:40.227Z',
        },
        {
          eventId: '28',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:40.233Z',
        },
        {
          eventId: '29',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:40.241Z',
        },
      ],
      endTime: '2026-11-14T08:21:40.241Z',
    },
    {
      id: 'workflowTask-31',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:40.590Z',
      attempt: 1,
      events: [
        {
          eventId: '31',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:40.590Z',
        },
        {
          eventId: '32',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:40.596Z',
        },
        {
          eventId: '33',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:40.605Z',
        },
      ],
      endTime: '2026-11-14T08:21:40.605Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '5',
      status: 'Completed',
      startTime: '2026-11-14T08:21:40.605Z',
      input: { encoding: 'json/plain', value: { name: 'b2', ms: 500 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-34',
      events: [
        {
          eventId: '34',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:40.605Z',
        },
        {
          eventId: '35',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:40.605Z',
        },
        {
          eventId: '36',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:41.112Z',
        },
      ],
      groups: ['label:par:b'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:40.605Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.112Z',
      result: { encoding: 'json/plain', value: { name: 'b2' } },
    },
    {
      id: 'workflowTask-37',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:41.112Z',
      attempt: 1,
      events: [
        {
          eventId: '37',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:41.112Z',
        },
        {
          eventId: '38',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:41.118Z',
        },
        {
          eventId: '39',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:41.127Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.127Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '6',
      status: 'Completed',
      startTime: '2026-11-14T08:21:41.127Z',
      input: { encoding: 'json/plain', value: { name: 'x-and-y', ms: 10 } },
      details: { taskQueue: 'event-groups' },
      id: 'activity-40',
      events: [
        {
          eventId: '40',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:41.127Z',
        },
        {
          eventId: '41',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:41.127Z',
        },
        {
          eventId: '42',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:41.143Z',
        },
      ],
      groups: ['label:tag:x', 'label:tag:y'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:41.127Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.143Z',
      result: { encoding: 'json/plain', value: { name: 'x-and-y' } },
    },
    {
      id: 'workflowTask-43',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:41.143Z',
      attempt: 1,
      events: [
        {
          eventId: '43',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:41.143Z',
        },
        {
          eventId: '44',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:41.148Z',
        },
        {
          eventId: '45',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:41.157Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.157Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '7',
      status: 'Completed',
      startTime: '2026-11-14T08:21:41.157Z',
      input: { encoding: 'json/plain', value: { name: 'y-only', ms: 10 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-46',
      events: [
        {
          eventId: '46',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:41.157Z',
        },
        {
          eventId: '47',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:41.157Z',
        },
        {
          eventId: '48',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:41.173Z',
        },
      ],
      groups: ['label:tag:y'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:41.157Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.173Z',
      result: { encoding: 'json/plain', value: { name: 'y-only' } },
    },
    {
      id: 'workflowTask-49',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:41.173Z',
      attempt: 1,
      events: [
        {
          eventId: '49',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:41.173Z',
        },
        {
          eventId: '50',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:41.178Z',
        },
        {
          eventId: '51',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:41.186Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.186Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '8',
      status: 'Completed',
      startTime: '2026-11-14T08:21:41.186Z',
      input: { encoding: 'json/plain', value: { name: 'a-and-x', ms: 10 } },
      details: { taskQueue: 'event-groups' },
      id: 'activity-52',
      events: [
        {
          eventId: '52',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:21:41.186Z',
        },
        {
          eventId: '53',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:21:41.186Z',
        },
        {
          eventId: '54',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:21:41.202Z',
        },
      ],
      groups: ['label:par:a', 'label:tag:x'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:21:41.186Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.202Z',
      result: { encoding: 'json/plain', value: { name: 'a-and-x' } },
    },
    {
      id: 'workflowTask-55',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:21:41.202Z',
      attempt: 1,
      events: [
        {
          eventId: '55',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:21:41.202Z',
        },
        {
          eventId: '56',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:21:41.208Z',
        },
        {
          eventId: '57',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:21:41.216Z',
        },
      ],
      endTime: '2026-11-14T08:21:41.216Z',
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Completed',
      events: [
        {
          eventId: '58',
          eventType: 'WorkflowExecutionCompleted',
          eventTime: '2026-11-14T08:21:41.216Z',
        },
      ],
      startTime: '2026-11-14T08:21:41.216Z',
      endTime: '2026-11-14T08:21:41.216Z',
      result: { encoding: 'json/plain', value: 'ok' },
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    { id: 'start->activity-6', source: 'start', target: 'activity-6' },
    { id: 'activity-6->timer-12', source: 'activity-6', target: 'timer-12' },
    {
      id: 'activity-5->activity-18',
      source: 'activity-5',
      target: 'activity-18',
    },
    {
      id: 'activity-6->activity-18',
      source: 'activity-6',
      target: 'activity-18',
    },
    {
      id: 'activity-18->activity-24',
      source: 'activity-18',
      target: 'activity-24',
    },
    { id: 'timer-12->activity-34', source: 'timer-12', target: 'activity-34' },
    {
      id: 'activity-24->activity-34',
      source: 'activity-24',
      target: 'activity-34',
    },
    {
      id: 'activity-34->activity-40',
      source: 'activity-34',
      target: 'activity-40',
    },
    {
      id: 'activity-40->activity-46',
      source: 'activity-40',
      target: 'activity-46',
    },
    {
      id: 'activity-46->activity-52',
      source: 'activity-46',
      target: 'activity-52',
    },
    { id: 'activity-52->end', source: 'activity-52', target: 'end' },
  ],
  completedSteps: 9,
  totalSteps: 9,
  truncated: false,
  payloadsHidden: false,
  eventGroups: [
    {
      key: 'label:par:a',
      kind: 'label',
      id: 'par:a',
      name: 'Parallel A',
      nodeIds: ['activity-5', 'activity-18', 'activity-24', 'activity-52'],
      children: ['label:par:a:sub'],
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.475Z',
      endTime: '2026-11-14T08:21:41.202Z',
    },
    {
      key: 'label:par:b',
      kind: 'label',
      id: 'par:b',
      name: 'Parallel B',
      nodeIds: ['activity-6', 'timer-12', 'activity-34'],
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.475Z',
      endTime: '2026-11-14T08:21:41.112Z',
    },
    {
      key: 'label:par:a:sub',
      kind: 'label',
      id: 'par:a:sub',
      name: 'A sub',
      nodeIds: ['activity-18'],
      parent: 'label:par:a',
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:21:39.798Z',
      endTime: '2026-11-14T08:21:39.904Z',
    },
    {
      key: 'label:tag:x',
      kind: 'label',
      id: 'tag:x',
      name: 'Tag X',
      nodeIds: ['activity-40', 'activity-52'],
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:21:41.127Z',
      endTime: '2026-11-14T08:21:41.202Z',
    },
    {
      key: 'label:tag:y',
      kind: 'label',
      id: 'tag:y',
      name: 'Tag Y',
      nodeIds: ['activity-40', 'activity-46'],
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:21:41.127Z',
      endTime: '2026-11-14T08:21:41.173Z',
    },
  ],
};
