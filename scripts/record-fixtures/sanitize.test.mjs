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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeHistory } from './sanitize.mjs';

test('normalizes client and worker identities and keeps payload data intact', () => {
  const payloadData = Buffer.from(
    JSON.stringify({ identity: 'keep-me-inside-payload' }),
  ).toString('base64');
  const history = {
    events: [
      {
        eventId: '1',
        eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
        workflowExecutionStartedEventAttributes: {
          workflowType: { name: 'internalWorkflow' },
          taskQueue: { name: 'dev-queue-123' },
          identity: 'alice@laptop',
          input: {
            payloads: [
              {
                metadata: { encoding: 'anNvbi9wbGFpbg==' },
                data: payloadData,
              },
            ],
          },
        },
      },
      {
        eventId: '3',
        eventType: 'EVENT_TYPE_WORKFLOW_TASK_STARTED',
        workflowTaskStartedEventAttributes: {
          identity: '9999@dev-host.local',
        },
      },
      {
        eventId: '10',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED',
        activityTaskFailedEventAttributes: {
          identity: '9999@dev-host.local',
          failure: {
            message: 'Error: temporary failure',
            stackTrace:
              'Error: temporary failure\n    at Object.callTool (/path/to/src/tool.js:42:11)\n    at async run (/path/to/src/worker.js:10:5)',
            cause: {
              message: 'Inner',
              stackTrace: 'Error: inner\n    at /path/to/inner.js:1:1',
            },
          },
        },
      },
    ],
  };

  const out = sanitizeHistory(history, {
    workflowType: 'publicWorkflow',
    taskQueue: 'public-queue',
  });

  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.identity,
    'client',
  );
  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.workflowType.name,
    'publicWorkflow',
  );
  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.taskQueue.name,
    'public-queue',
  );
  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.input.payloads[0]
      .data,
    payloadData,
  );
  assert.equal(
    out.events[1].workflowTaskStartedEventAttributes.identity,
    'worker@host',
  );
  assert.equal(
    out.events[2].activityTaskFailedEventAttributes.identity,
    'worker@host',
  );
  assert.equal(
    out.events[2].activityTaskFailedEventAttributes.failure.stackTrace,
    'Error: temporary failure',
  );
  assert.equal(
    out.events[2].activityTaskFailedEventAttributes.failure.cause.stackTrace,
    'Error: inner',
  );
});

test('keeps child workflow type distinct from parent workflowType override', () => {
  const history = {
    events: [
      {
        eventId: '1',
        workflowExecutionStartedEventAttributes: {
          workflowType: { name: 'origParent' },
          taskQueue: { name: 'orig-tq' },
          identity: 'me@host',
        },
      },
      {
        eventId: '18',
        startChildWorkflowExecutionInitiatedEventAttributes: {
          workflowId: 'local-child-uuid',
          workflowType: { name: 'origChild' },
          taskQueue: { name: 'orig-tq' },
        },
      },
    ],
  };

  const out = sanitizeHistory(history, {
    workflowType: 'groupsWithChildren',
    taskQueue: 'event-groups',
    renameWorkflowIds: { 'local-child-uuid': 'event-groups-child.child-2' },
    renameChildTypes: { origChild: 'childWithGroup' },
  });

  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.workflowType.name,
    'groupsWithChildren',
  );
  assert.equal(
    out.events[1].startChildWorkflowExecutionInitiatedEventAttributes
      .workflowType.name,
    'childWithGroup',
  );
  assert.equal(
    out.events[1].startChildWorkflowExecutionInitiatedEventAttributes
      .workflowId,
    'event-groups-child.child-2',
  );
  assert.equal(
    out.events[1].startChildWorkflowExecutionInitiatedEventAttributes.taskQueue
      .name,
    'event-groups',
  );
});

test('applies --workflow-type only to the run itself, never to child workflows', () => {
  const history = {
    events: [
      {
        eventId: '1',
        workflowExecutionStartedEventAttributes: {
          workflowType: { name: 'origParent' },
        },
      },
      {
        eventId: '5',
        childWorkflowExecutionStartedEventAttributes: {
          workflowType: { name: 'origChild' },
        },
      },
      {
        eventId: '6',
        childWorkflowExecutionCompletedEventAttributes: {
          workflowType: { name: 'origChild' },
        },
      },
      {
        eventId: '7',
        workflowExecutionContinuedAsNewEventAttributes: {
          workflowType: { name: 'origParent' },
        },
      },
    ],
  };

  const out = sanitizeHistory(history, {
    workflowType: 'publicParent',
    renameChildTypes: { origChild: 'publicChild' },
  });

  assert.equal(
    out.events[0].workflowExecutionStartedEventAttributes.workflowType.name,
    'publicParent',
  );
  assert.equal(
    out.events[1].childWorkflowExecutionStartedEventAttributes.workflowType
      .name,
    'publicChild',
  );
  assert.equal(
    out.events[2].childWorkflowExecutionCompletedEventAttributes.workflowType
      .name,
    'publicChild',
  );
  assert.equal(
    out.events[3].workflowExecutionContinuedAsNewEventAttributes.workflowType
      .name,
    'publicParent',
  );

  const untouched = sanitizeHistory(history, { workflowType: 'publicParent' });
  assert.equal(
    untouched.events[2].childWorkflowExecutionCompletedEventAttributes
      .workflowType.name,
    'origChild',
  );
});

const STICKY_HISTORY = () => ({
  events: [
    {
      eventId: '2',
      workflowTaskScheduledEventAttributes: {
        taskQueue: { name: 'orig-tq', kind: 'TASK_QUEUE_KIND_NORMAL' },
      },
    },
    {
      eventId: '8',
      workflowTaskScheduledEventAttributes: {
        taskQueue: {
          name: '4242@alice-laptop.local-5f7647f2-bf7c-4998-a855-f0dbfe77cfc9',
          kind: 'TASK_QUEUE_KIND_STICKY',
          normalName: 'orig-tq',
        },
      },
    },
  ],
});

test('rewrites sticky task queue names even without --task-queue', () => {
  const out = sanitizeHistory(STICKY_HISTORY(), {});
  const sticky = out.events[1].workflowTaskScheduledEventAttributes.taskQueue;
  assert.equal(sticky.name, 'worker@host-5f7647f2bf7c4998a855f0dbfe77cfc9');
  assert.equal(sticky.normalName, 'orig-tq');
  assert.equal(
    out.events[0].workflowTaskScheduledEventAttributes.taskQueue.name,
    'orig-tq',
  );
  const text = JSON.stringify(out);
  assert.ok(!text.includes('4242'));
  assert.ok(!text.includes('alice-laptop'));
});

test('renames sticky normalName together with the normal queue under --task-queue', () => {
  const out = sanitizeHistory(STICKY_HISTORY(), { taskQueue: 'public-queue' });
  assert.equal(
    out.events[0].workflowTaskScheduledEventAttributes.taskQueue.name,
    'public-queue',
  );
  const sticky = out.events[1].workflowTaskScheduledEventAttributes.taskQueue;
  assert.equal(sticky.name, 'worker@host-5f7647f2bf7c4998a855f0dbfe77cfc9');
  assert.equal(sticky.kind, 'TASK_QUEUE_KIND_STICKY');
  assert.equal(sticky.normalName, 'public-queue');
});

test('leaves an already sanitized committed history unchanged', () => {
  const file = new URL(
    '../../test-fixtures/event-groups/loop-ts-sdk-1.25.json',
    import.meta.url,
  );
  const history = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(sanitizeHistory(history, {}), history);
});
