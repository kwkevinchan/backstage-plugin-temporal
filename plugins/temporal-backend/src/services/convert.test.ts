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

import {
  decodePageToken,
  decodePayload,
  decodeSearchAttributes,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  toWorkflowFailure,
  toWorkflowSteps,
} from './convert';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const jsonPayload = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});

describe('decodePayload', () => {
  it('decodes JSON payloads', () => {
    expect(decodePayload(jsonPayload({ a: 1 }))).toEqual({
      encoding: 'json/plain',
      value: { a: 1 },
    });
  });

  it('shows only encoding and size of payloads it cannot decode', () => {
    const payload = {
      metadata: {
        encoding: b64('binary/encrypted'),
        'encryption-key-id': b64('k1'),
      },
      data: 'AAEC',
    };
    expect(decodePayload(payload)).toEqual({
      encoding: 'binary/encrypted',
      size: 3,
      undecodable: true,
      metadata: { 'encryption-key-id': 'k1' },
    });
    expect(
      decodePayload({
        metadata: { encoding: b64('json/plain') },
        data: b64('{broken'),
      }),
    ).toEqual({ encoding: 'json/plain', size: 7, undecodable: true });
  });
});

describe('toWorkflowFailure', () => {
  it('keeps the cause chain', () => {
    const failure = toWorkflowFailure({
      message: 'Payment failed',
      applicationFailureInfo: { type: 'PaymentFailed', nonRetryable: true },
      cause: {
        message: 'Activity task failed',
        activityFailureInfo: { activityType: { name: 'chargeCard' } },
        cause: {
          message: 'Card declined',
          applicationFailureInfo: { type: 'CardDeclined' },
        },
      },
    });
    expect(failure).toEqual({
      message: 'Payment failed',
      kind: 'ApplicationFailure',
      type: 'PaymentFailed',
      nonRetryable: true,
      cause: {
        message: 'Activity task failed',
        kind: 'ActivityFailure',
        cause: {
          message: 'Card declined',
          kind: 'ApplicationFailure',
          type: 'CardDeclined',
          nonRetryable: false,
        },
      },
    });
  });
});

describe('toWorkflowDetail', () => {
  it('converts describe output with pending activities and failure', () => {
    const detail = toWorkflowDetail(
      {
        workflowExecutionInfo: {
          execution: { workflowId: 'wf', runId: 'run' },
          type: { name: 'deploy' },
          taskQueue: 'q',
          status: 'WORKFLOW_EXECUTION_STATUS_FAILED',
          startTime: { seconds: '1700000000', nanos: 0 },
          closeTime: { seconds: '1700000060', nanos: 500000000 },
          historyLength: '12',
          searchAttributes: {
            indexedFields: {
              BackstageEntityRef: jsonPayload(['component:default/x']),
            },
          },
        },
        pendingActivities: [
          {
            activityId: '2',
            activityType: { name: 'wait' },
            state: 'PENDING_ACTIVITY_STATE_SCHEDULED',
            attempt: 3,
            lastFailure: { message: 'not ready', applicationFailureInfo: {} },
          },
        ],
      },
      {
        namespace: 'default',
        entityRefAttribute: 'BackstageEntityRef',
        webUiUrl: r => `http://ui/${r.workflowId}/${r.runId}`,
        closeEvent: {
          workflowExecutionFailedEventAttributes: {
            failure: { message: 'boom' },
          },
        },
      },
    );
    expect(detail).toMatchObject({
      namespace: 'default',
      workflowId: 'wf',
      runId: 'run',
      workflowType: 'deploy',
      taskQueue: 'q',
      status: 'Failed',
      startTime: '2023-11-14T22:13:20.000Z',
      closeTime: '2023-11-14T22:14:20.500Z',
      historyLength: 12,
      entityRef: 'component:default/x',
      webUiUrl: 'http://ui/wf/run',
      failure: { message: 'boom' },
      pendingActivities: [
        {
          activityId: '2',
          activityType: 'wait',
          state: 'Scheduled',
          attempt: 3,
          lastFailure: { message: 'not ready', kind: 'ApplicationFailure' },
        },
      ],
    });
  });
});

describe('toHistoryEvent', () => {
  it('names the event type and decodes payloads', () => {
    expect(
      toHistoryEvent({
        eventId: '1',
        eventTime: { seconds: '1700000000', nanos: 0 },
        eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
        workflowExecutionStartedEventAttributes: {
          input: { payloads: [jsonPayload('hello')] },
          workflowTaskTimeout: { seconds: '10' },
        },
      }),
    ).toEqual({
      eventId: '1',
      eventTime: '2023-11-14T22:13:20.000Z',
      eventType: 'WorkflowExecutionStarted',
      attributes: {
        input: { payloads: [{ encoding: 'json/plain', value: 'hello' }] },
        workflowTaskTimeout: '10s',
      },
    });
  });
});

describe('toWorkflowSteps', () => {
  it('pairs activity inputs with results and failures', () => {
    const steps = toWorkflowSteps(
      [
        {
          eventId: '1',
          workflowExecutionStartedEventAttributes: {
            input: { payloads: [jsonPayload({ orderId: 'o-1' })] },
          },
        },
        {
          eventId: '5',
          eventTime: { seconds: '1700000000' },
          activityTaskScheduledEventAttributes: {
            activityId: '1',
            activityType: { name: 'reserve' },
            input: { payloads: [jsonPayload('a'), jsonPayload(2)] },
          },
        },
        {
          eventId: '6',
          activityTaskStartedEventAttributes: {
            scheduledEventId: '5',
            attempt: 2,
          },
        },
        {
          eventId: '7',
          eventTime: { seconds: '1700000003' },
          activityTaskCompletedEventAttributes: {
            scheduledEventId: '5',
            result: { payloads: [jsonPayload({ ok: true })] },
          },
        },
        {
          eventId: '11',
          activityTaskScheduledEventAttributes: {
            activityId: '2',
            activityType: { name: 'charge' },
            input: {
              payloads: [
                {
                  metadata: { encoding: b64('binary/encrypted') },
                  data: 'AAAA',
                },
              ],
            },
          },
        },
        {
          eventId: '13',
          activityTaskFailedEventAttributes: {
            scheduledEventId: '11',
            failure: { message: 'declined', applicationFailureInfo: {} },
          },
        },
        {
          eventId: '20',
          workflowExecutionCompletedEventAttributes: {
            result: { payloads: [jsonPayload('done')] },
          },
        },
      ],
      false,
    );
    expect(steps).toEqual({
      truncated: false,
      input: { encoding: 'json/plain', value: { orderId: 'o-1' } },
      result: { encoding: 'json/plain', value: 'done' },
      activities: [
        {
          activityId: '1',
          activityType: 'reserve',
          scheduledEventId: '5',
          status: 'Completed',
          attempt: 2,
          scheduledTime: '2023-11-14T22:13:20.000Z',
          closeTime: '2023-11-14T22:13:23.000Z',
          input: [
            { encoding: 'json/plain', value: 'a' },
            { encoding: 'json/plain', value: 2 },
          ],
          result: { encoding: 'json/plain', value: { ok: true } },
        },
        {
          activityId: '2',
          activityType: 'charge',
          scheduledEventId: '11',
          status: 'Failed',
          input: { encoding: 'binary/encrypted', size: 3, undecodable: true },
          failure: {
            message: 'declined',
            kind: 'ApplicationFailure',
            nonRetryable: false,
          },
        },
      ],
    });
  });
});

describe('page tokens', () => {
  it('round-trips and rejects garbage', () => {
    const token = encodePageToken(new Uint8Array([1, 2, 3]));
    expect(token).toBe('AQID');
    expect(Array.from(decodePageToken(token)!)).toEqual([1, 2, 3]);
    expect(encodePageToken(new Uint8Array())).toBeUndefined();
    expect(() => decodePageToken('not a token!')).toThrow();
  });
});

describe('search attributes and memo', () => {
  // Temporal sends both maps in no fixed order.
  const shuffled = {
    Zone: jsonPayload('eu'),
    ApprovalPending: jsonPayload(true),
    BackstageEntityRef: jsonPayload('component:default/orders'),
    approvalNote: jsonPayload('soon'),
  };
  const sortedKeys = [
    'ApprovalPending',
    'BackstageEntityRef',
    'Zone',
    'approvalNote',
  ];

  it('decodes the search attributes by key', () => {
    const decoded = decodeSearchAttributes({ indexedFields: shuffled });
    expect(Object.keys(decoded)).toEqual(sortedKeys);
    expect(decoded.ApprovalPending).toBe(true);
  });

  it('gives the search attributes and the memo of a detail by key', () => {
    const detail = toWorkflowDetail(
      {
        workflowExecutionInfo: {
          execution: { workflowId: 'wf-1', runId: 'r-1' },
          type: { name: 'orderWorkflow' },
          status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
          searchAttributes: { indexedFields: shuffled },
          memo: { fields: shuffled },
        },
      },
      { namespace: 'default' },
    );
    expect(Object.keys(detail.searchAttributes!)).toEqual(sortedKeys);
    expect(Object.keys(detail.memo!)).toEqual(sortedKeys);
  });

  it('gives the payload maps of a history event by key', () => {
    const event = toHistoryEvent({
      eventId: '1',
      eventType: 'EVENT_TYPE_UPSERT_WORKFLOW_SEARCH_ATTRIBUTES',
      upsertWorkflowSearchAttributesEventAttributes: {
        searchAttributes: { indexedFields: shuffled },
      },
    });
    const attributes = event.attributes as any;
    expect(Object.keys(attributes.searchAttributes.indexedFields)).toEqual(
      sortedKeys,
    );
  });
});
