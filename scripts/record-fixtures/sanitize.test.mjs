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
              'Error: temporary failure\n    at Object.callTool (/home/user/src/tool.js:42:11)\n    at async run (/home/user/src/worker.js:10:5)',
            cause: {
              message: 'Inner',
              stackTrace: 'Error: inner\n    at /home/user/inner.js:1:1',
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
