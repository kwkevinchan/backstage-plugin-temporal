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

// Written by scripts/event-group-graphs.mjs from test-fixtures/event-groups/ambiguous.json:
// groups given as options to single steps, read as nesting. Run `yarn sync:test-graphs` to write it again.

import type { WorkflowGraphResponse } from '../common';

export const ambiguousGraph: WorkflowGraphResponse = {
  status: 'Completed',
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      input: null,
      details: {
        workflowType: 'ambiguousGroups',
        taskQueue: 'event-groups',
        attempt: 1,
      },
      events: [
        {
          eventId: '1',
          eventType: 'WorkflowExecutionStarted',
          eventTime: '2026-11-14T08:25:33.118Z',
        },
      ],
      startTime: '2026-11-14T08:25:33.118Z',
      endTime: '2026-11-14T08:25:33.118Z',
    },
    {
      id: 'workflowTask-2',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:25:33.118Z',
      attempt: 1,
      events: [
        {
          eventId: '2',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:25:33.118Z',
        },
        {
          eventId: '3',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:25:33.127Z',
        },
        {
          eventId: '4',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:25:33.222Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.222Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '1',
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.222Z',
      input: { encoding: 'json/plain', value: { name: 'a-1', ms: 10 } },
      maximumAttempts: 3,
      details: { taskQueue: 'event-groups' },
      id: 'activity-5',
      events: [
        {
          eventId: '5',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:25:33.222Z',
        },
        {
          eventId: '6',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:25:33.222Z',
        },
        {
          eventId: '7',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:25:33.245Z',
        },
      ],
      groups: ['label:amb:a'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:25:33.222Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.245Z',
      result: { encoding: 'json/plain', value: { name: 'a-1' } },
    },
    {
      id: 'workflowTask-8',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:25:33.245Z',
      attempt: 1,
      events: [
        {
          eventId: '8',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:25:33.245Z',
        },
        {
          eventId: '9',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:25:33.251Z',
        },
        {
          eventId: '10',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:25:33.263Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.263Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '2',
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.263Z',
      input: { encoding: 'json/plain', value: { name: 'a-2-and-z', ms: 10 } },
      details: { taskQueue: 'event-groups' },
      id: 'activity-11',
      events: [
        {
          eventId: '11',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:25:33.263Z',
        },
        {
          eventId: '12',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:25:33.263Z',
        },
        {
          eventId: '13',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:25:33.280Z',
        },
      ],
      groups: ['label:amb:a', 'label:amb:z'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:25:33.263Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.280Z',
      result: { encoding: 'json/plain', value: { name: 'a-2-and-z' } },
    },
    {
      id: 'workflowTask-14',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:25:33.280Z',
      attempt: 1,
      events: [
        {
          eventId: '14',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:25:33.280Z',
        },
        {
          eventId: '15',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:25:33.286Z',
        },
        {
          eventId: '16',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:25:33.295Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.295Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '3',
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.295Z',
      input: { encoding: 'json/plain', value: { name: 'p-and-q-1', ms: 10 } },
      details: { taskQueue: 'event-groups' },
      id: 'activity-17',
      events: [
        {
          eventId: '17',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:25:33.295Z',
        },
        {
          eventId: '18',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:25:33.295Z',
        },
        {
          eventId: '19',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:25:33.312Z',
        },
      ],
      groups: ['label:amb:p', 'label:amb:q'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:25:33.295Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.312Z',
      result: { encoding: 'json/plain', value: { name: 'p-and-q-1' } },
    },
    {
      id: 'workflowTask-20',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:25:33.312Z',
      attempt: 1,
      events: [
        {
          eventId: '20',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:25:33.312Z',
        },
        {
          eventId: '21',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:25:33.318Z',
        },
        {
          eventId: '22',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:25:33.328Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.328Z',
    },
    {
      kind: 'activity',
      name: 'slowStep',
      stepId: '4',
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.328Z',
      input: { encoding: 'json/plain', value: { name: 'p-and-q-2', ms: 10 } },
      details: { taskQueue: 'event-groups' },
      id: 'activity-23',
      events: [
        {
          eventId: '23',
          eventType: 'ActivityTaskScheduled',
          eventTime: '2026-11-14T08:25:33.328Z',
        },
        {
          eventId: '24',
          eventType: 'ActivityTaskStarted',
          eventTime: '2026-11-14T08:25:33.328Z',
        },
        {
          eventId: '25',
          eventType: 'ActivityTaskCompleted',
          eventTime: '2026-11-14T08:25:33.344Z',
        },
      ],
      groups: ['label:amb:p', 'label:amb:q'],
      attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'Completed',
          startedTime: '2026-11-14T08:25:33.328Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.344Z',
      result: { encoding: 'json/plain', value: { name: 'p-and-q-2' } },
    },
    {
      id: 'workflowTask-26',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      startTime: '2026-11-14T08:25:33.344Z',
      attempt: 1,
      events: [
        {
          eventId: '26',
          eventType: 'WorkflowTaskScheduled',
          eventTime: '2026-11-14T08:25:33.344Z',
        },
        {
          eventId: '27',
          eventType: 'WorkflowTaskStarted',
          eventTime: '2026-11-14T08:25:33.350Z',
        },
        {
          eventId: '28',
          eventType: 'WorkflowTaskCompleted',
          eventTime: '2026-11-14T08:25:33.360Z',
        },
      ],
      endTime: '2026-11-14T08:25:33.360Z',
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Completed',
      events: [
        {
          eventId: '29',
          eventType: 'WorkflowExecutionCompleted',
          eventTime: '2026-11-14T08:25:33.360Z',
        },
      ],
      startTime: '2026-11-14T08:25:33.360Z',
      endTime: '2026-11-14T08:25:33.360Z',
      result: { encoding: 'json/plain', value: 'ok' },
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    {
      id: 'activity-5->activity-11',
      source: 'activity-5',
      target: 'activity-11',
    },
    {
      id: 'activity-11->activity-17',
      source: 'activity-11',
      target: 'activity-17',
    },
    {
      id: 'activity-17->activity-23',
      source: 'activity-17',
      target: 'activity-23',
    },
    { id: 'activity-23->end', source: 'activity-23', target: 'end' },
  ],
  completedSteps: 4,
  totalSteps: 4,
  truncated: false,
  payloadsHidden: false,
  eventGroups: [
    {
      key: 'label:amb:a',
      kind: 'label',
      id: 'amb:a',
      name: 'A',
      nodeIds: ['activity-5', 'activity-11'],
      children: ['label:amb:z'],
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.222Z',
      endTime: '2026-11-14T08:25:33.280Z',
    },
    {
      key: 'label:amb:z',
      kind: 'label',
      id: 'amb:z',
      name: 'Z (unrelated tag)',
      nodeIds: ['activity-11'],
      parent: 'label:amb:a',
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.263Z',
      endTime: '2026-11-14T08:25:33.280Z',
    },
    {
      key: 'label:amb:p',
      kind: 'label',
      id: 'amb:p',
      name: 'P',
      nodeIds: ['activity-17', 'activity-23'],
      children: ['label:amb:q'],
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.295Z',
      endTime: '2026-11-14T08:25:33.344Z',
    },
    {
      key: 'label:amb:q',
      kind: 'label',
      id: 'amb:q',
      name: 'Q',
      nodeIds: ['activity-17', 'activity-23'],
      parent: 'label:amb:p',
      children: [],
      status: 'Completed',
      startTime: '2026-11-14T08:25:33.295Z',
      endTime: '2026-11-14T08:25:33.344Z',
    },
  ],
};
