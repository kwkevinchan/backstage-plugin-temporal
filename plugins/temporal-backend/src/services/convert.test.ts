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
  ConvertOptions,
  decodePageToken,
  decodePayload,
  decodeSearchAttributes,
  encodePageToken,
  toHistoryEvent,
  toWorkflowDetail,
  toWorkflowFailure,
  resultFromCloseEvent,
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

describe('payloads in External Storage', () => {
  const reference = {
    metadata: {
      encoding: b64('json/protobuf'),
      messageType: b64('temporal.api.sdk.v1.ExternalStorageReference'),
    },
    data: b64(
      JSON.stringify({
        driverName: 'aws.s3driver',
        claimData: {
          bucket: 'payloads',
          key: 'v0/d/sha256/abc',
          hash_algorithm: 'sha256',
          hash_value: 'a'.repeat(64),
        },
      }),
    ),
    externalPayloads: [{ sizeBytes: '4096' }],
  };
  const external = {
    store: 's3',
    bucket: 'payloads',
    key: 'v0/d/sha256/abc',
    size: 4096,
    sha256: 'a'.repeat(64),
  };

  it('shows where the payload is, without its data', () => {
    expect(decodePayload(reference)).toEqual({
      encoding: 'json/protobuf',
      external,
    });
  });

  it('shows the reference in the history and in a map of payloads', () => {
    expect(
      toHistoryEvent({
        eventId: '5',
        eventType: 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED',
        activityTaskCompletedEventAttributes: {
          scheduledEventId: '3',
          result: { payloads: [reference] },
        },
      }).attributes,
    ).toMatchObject({
      result: { payloads: [{ encoding: 'json/protobuf', external }] },
    });
    expect(
      decodeSearchAttributes({ indexedFields: { report: reference } }),
    ).toEqual({ report: { encoding: 'json/protobuf', external } });
  });

  it('treats a JSON payload that only looks like a reference as JSON', () => {
    expect(
      decodePayload({
        metadata: { encoding: b64('json/protobuf') },
        data: b64('{"driverName":"x"}'),
      }),
    ).toEqual({ encoding: 'json/protobuf', value: { driverName: 'x' } });
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
    expect(detail.firstRunId).toBeUndefined();
  });

  it('includes firstRunId when set on workflow execution info', () => {
    const detail = toWorkflowDetail(
      {
        workflowExecutionInfo: {
          execution: { workflowId: 'wf', runId: 'run-2' },
          firstRunId: 'run-1',
          type: { name: 'deploy' },
          status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
        },
      },
      { namespace: 'default' },
    );
    expect(detail.firstRunId).toBe('run-1');
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

describe('resultFromCloseEvent', () => {
  it('decodes a completed result', () => {
    expect(
      resultFromCloseEvent({
        workflowExecutionCompletedEventAttributes: {
          result: { payloads: [jsonPayload('done')] },
        },
      }),
    ).toEqual({ result: { encoding: 'json/plain', value: 'done' } });
  });

  it('returns the failure of a failed close event', () => {
    expect(
      resultFromCloseEvent({
        workflowExecutionFailedEventAttributes: {
          failure: { message: 'boom', applicationFailureInfo: {} },
        },
      }),
    ).toEqual({
      failure: {
        message: 'boom',
        kind: 'ApplicationFailure',
        nonRetryable: false,
      },
    });
  });

  it('is empty for a running run and for canceled', () => {
    expect(resultFromCloseEvent(undefined)).toEqual({});
    expect(
      resultFromCloseEvent({
        workflowExecutionCanceledEventAttributes: {},
      }),
    ).toEqual({});
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

  function detailOf(
    indexedFields: Record<string, unknown>,
    options?: Partial<ConvertOptions>,
  ) {
    return toWorkflowDetail(
      {
        workflowExecutionInfo: {
          execution: { workflowId: 'wf-1', runId: 'r-1' },
          type: { name: 'orderWorkflow' },
          status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
          searchAttributes: { indexedFields },
          memo: { fields: shuffled },
        },
      },
      {
        namespace: 'default',
        entityRefAttribute: 'BackstageEntityRef',
        initiatorAttribute: 'BackstageInitiator',
        ...options,
      },
    );
  }

  it('gives the memo of a detail by key', () => {
    expect(Object.keys(detailOf(shuffled).memo!)).toEqual(sortedKeys);
  });

  it('puts the entity and initiator attributes of a detail first', () => {
    const detail = detailOf({
      ...shuffled,
      BackstageInitiator: jsonPayload('user:default/me'),
    });
    expect(Object.keys(detail.searchAttributes!)).toEqual([
      'BackstageEntityRef',
      'BackstageInitiator',
      'ApprovalPending',
      'Zone',
      'approvalNote',
    ]);
  });

  it('puts only the one that is present first', () => {
    const { BackstageEntityRef: _omit, ...withoutEntity } = shuffled;
    const initiator = detailOf({
      ...withoutEntity,
      BackstageInitiator: jsonPayload('user:default/me'),
    });
    expect(Object.keys(initiator.searchAttributes!)).toEqual([
      'BackstageInitiator',
      'ApprovalPending',
      'Zone',
      'approvalNote',
    ]);
    const entity = detailOf(shuffled);
    expect(Object.keys(entity.searchAttributes!)).toEqual([
      'BackstageEntityRef',
      'ApprovalPending',
      'Zone',
      'approvalNote',
    ]);
  });

  it('keeps the order by key when neither is present', () => {
    const { BackstageEntityRef: _omit, ...others } = shuffled;
    const detail = detailOf(others);
    expect(Object.keys(detail.searchAttributes!)).toEqual([
      'ApprovalPending',
      'Zone',
      'approvalNote',
    ]);
  });

  it('puts the configured attribute names first', () => {
    const detail = detailOf(
      {
        ...shuffled,
        TeamRef: jsonPayload('group:default/a'),
        TeamBy: jsonPayload('user:default/me'),
      },
      { entityRefAttribute: 'TeamRef', initiatorAttribute: 'TeamBy' },
    );
    expect(Object.keys(detail.searchAttributes!)).toEqual([
      'TeamRef',
      'TeamBy',
      'ApprovalPending',
      'BackstageEntityRef',
      'Zone',
      'approvalNote',
    ]);
  });

  it('puts no attribute first when no names are configured', () => {
    const detail = detailOf(shuffled, {
      entityRefAttribute: undefined,
      initiatorAttribute: undefined,
    });
    expect(Object.keys(detail.searchAttributes!)).toEqual(sortedKeys);
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
