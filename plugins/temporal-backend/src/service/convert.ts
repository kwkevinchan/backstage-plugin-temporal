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

import type { JsonObject, JsonValue } from '@backstage/types';
import {
  type ActivityStep,
  PendingActivity,
  WorkflowStepsResponse,
  WorkflowDetail,
  WorkflowFailure,
  WorkflowHistoryEvent,
  WorkflowNodeStatus,
  WorkflowStatus,
  WorkflowSummary,
  parseLlmMarker,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { linkLlmSteps, summarizeLlmCall } from './llm';
import { EXTERNAL_PAYLOAD, referenceInfo, referenceOf } from './payloads';

/** Encoding of a reference payload in the history. */
const EXTERNAL_STORAGE_ENCODING = 'json/protobuf';

/*
 * Conversion from Temporal API messages to the plugin's JSON types. The input
 * is the protobuf JSON form (`message.toJSON()`): 64-bit numbers and bytes are
 * strings, enums are names, timestamps are `{ seconds, nanos }`.
 */

type Json = any;

const STATUS_NAMES: Record<string, WorkflowStatus> = {
  WORKFLOW_EXECUTION_STATUS_RUNNING: 'Running',
  WORKFLOW_EXECUTION_STATUS_COMPLETED: 'Completed',
  WORKFLOW_EXECUTION_STATUS_FAILED: 'Failed',
  WORKFLOW_EXECUTION_STATUS_CANCELED: 'Canceled',
  WORKFLOW_EXECUTION_STATUS_TERMINATED: 'Terminated',
  WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW: 'ContinuedAsNew',
  WORKFLOW_EXECUTION_STATUS_TIMED_OUT: 'TimedOut',
};

export function toStatus(value: unknown): WorkflowStatus {
  return (typeof value === 'string' && STATUS_NAMES[value]) || 'Unknown';
}

function isTimestampLike(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every(k => k === 'seconds' || k === 'nanos')
  );
}

export function toIsoTime(value: Json): string | undefined {
  if (!isTimestampLike(value)) return undefined;
  const ms =
    Number(value.seconds ?? 0) * 1000 +
    Math.floor(Number(value.nanos ?? 0) / 1e6);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}

/** Milliseconds of a `Duration` message (JSON form). */
export function durationToMs(value: Json): number | undefined {
  if (!isTimestampLike(value)) return undefined;
  const ms = Number(value.seconds ?? 0) * 1000 + Number(value.nanos ?? 0) / 1e6;
  return Number.isFinite(ms) ? ms : undefined;
}

function toDuration(value: Json): string {
  const seconds = Number(value.seconds ?? 0) + Number(value.nanos ?? 0) / 1e9;
  return `${Number(seconds.toFixed(3))}s`;
}

function decodeBase64(value: unknown): string {
  return typeof value === 'string'
    ? Buffer.from(value, 'base64').toString('utf8')
    : '';
}

function isPayload(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.metadata === 'object' &&
    value.metadata !== null &&
    'encoding' in value.metadata &&
    // `externalPayloads`: the size of a payload in External Storage.
    Object.keys(value).every(
      k => k === 'metadata' || k === 'data' || k === 'externalPayloads',
    )
  );
}

/**
 * Decodes a payload like the default data converter. JSON payloads become
 * `{ encoding, value }`. Anything else (binary, protobuf, encrypted by a
 * codec, broken JSON) becomes `{ encoding, size, undecodable: true }`, since
 * the backend has no codec; the data itself is not sent. References of
 * payloads in External Storage become `{ encoding, external }` (the
 * encoding of the stored payload once it is read), or the decoded data with
 * `external` when it is shown inline (see `ExternalPayloads.resolve`).
 */
export function decodePayload(payload: Json): JsonObject {
  const external = payload[EXTERNAL_PAYLOAD];
  if (external) {
    if (external.state === 'inline') {
      return { ...decodePlainPayload(payload), external };
    }
    return {
      encoding: external.encoding || EXTERNAL_STORAGE_ENCODING,
      external,
    };
  }
  // A reference that was not looked at (no S3 configured).
  const reference = referenceOf(payload);
  if (reference) {
    return {
      encoding: EXTERNAL_STORAGE_ENCODING,
      external: referenceInfo(reference) as unknown as JsonObject,
    };
  }
  return decodePlainPayload(payload);
}

function decodePlainPayload(payload: Json): JsonObject {
  const metadata: JsonObject = {};
  for (const [key, raw] of Object.entries(payload.metadata ?? {})) {
    metadata[key] = decodeBase64(raw);
  }
  const encoding = String(metadata.encoding ?? '');
  if (encoding === 'binary/null') {
    return { encoding, value: null };
  }
  if (encoding === 'json/plain' || encoding === 'json/protobuf') {
    try {
      return {
        encoding,
        value: JSON.parse(decodeBase64(payload.data ?? '')) as JsonValue,
      };
    } catch {
      // fall through to the raw form
    }
  }
  const size =
    typeof payload.data === 'string'
      ? Buffer.from(payload.data, 'base64').length
      : 0;
  const raw: JsonObject = { encoding, size, undecodable: true };
  const extra = Object.fromEntries(
    Object.entries(metadata).filter(([k]) => k !== 'encoding'),
  );
  if (Object.keys(extra).length > 0) raw.metadata = extra;
  return raw;
}

/** Converts protobuf JSON into display JSON: payloads, times, durations. */
export function toDisplayJson(value: Json, key = ''): JsonValue {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(v => toDisplayJson(v, key));
  if (typeof value !== 'object') return value as JsonValue;
  if (isPayload(value)) return decodePayload(value);
  if (isTimestampLike(value)) {
    return /time(stamp)?$/i.test(key)
      ? toIsoTime(value) ?? null
      : toDuration(value);
  }
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = toDisplayJson(v, k);
  }
  return out;
}

/** Decodes the indexed fields of search attributes into plain values. */
export function decodeSearchAttributes(raw: Json): JsonObject {
  const out: JsonObject = {};
  for (const [name, payload] of Object.entries(raw?.indexedFields ?? {})) {
    const decoded = decodePayload(payload);
    out[name] = 'value' in decoded ? decoded.value : decoded;
  }
  return out;
}

function firstString(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export interface ConvertOptions {
  namespace: string;
  entityRefAttribute?: string;
  webUiUrl?: (ref: {
    namespace: string;
    workflowId: string;
    runId: string;
  }) => string | undefined;
}

/** Converts a `WorkflowExecutionInfo` message (JSON form). */
export function toWorkflowSummary(
  info: Json,
  options: ConvertOptions,
): WorkflowSummary {
  const workflowId: string = info.execution?.workflowId ?? '';
  const runId: string = info.execution?.runId ?? '';
  const searchAttributes = decodeSearchAttributes(info.searchAttributes);
  const summary: WorkflowSummary = {
    namespace: options.namespace,
    workflowId,
    runId,
    workflowType: info.type?.name ?? '',
    taskQueue: info.taskQueue || undefined,
    status: toStatus(info.status),
    startTime: toIsoTime(info.startTime),
    closeTime: toIsoTime(info.closeTime),
    historyLength:
      info.historyLength !== undefined ? Number(info.historyLength) : undefined,
  };
  if (options.entityRefAttribute) {
    summary.entityRef = firstString(
      searchAttributes[options.entityRefAttribute],
    );
  }
  const webUiUrl = options.webUiUrl?.({
    namespace: options.namespace,
    workflowId,
    runId,
  });
  if (webUiUrl) summary.webUiUrl = webUiUrl;
  return dropUndefined(summary);
}

const FAILURE_KINDS: Record<string, string> = {
  applicationFailureInfo: 'ApplicationFailure',
  timeoutFailureInfo: 'TimeoutFailure',
  canceledFailureInfo: 'CanceledFailure',
  terminatedFailureInfo: 'TerminatedFailure',
  serverFailureInfo: 'ServerFailure',
  resetWorkflowFailureInfo: 'ResetWorkflowFailure',
  activityFailureInfo: 'ActivityFailure',
  childWorkflowExecutionFailureInfo: 'ChildWorkflowFailure',
  nexusOperationExecutionFailureInfo: 'NexusOperationFailure',
};

const MAX_CAUSE_DEPTH = 20;

/** Converts a `Failure` message (JSON form), keeping the cause chain. */
export function toWorkflowFailure(
  failure: Json,
  depth = 0,
): WorkflowFailure | undefined {
  if (!failure || typeof failure !== 'object') return undefined;
  const kindKey = Object.keys(FAILURE_KINDS).find(k => k in failure);
  const info = kindKey ? failure[kindKey] : undefined;
  let message: string = failure.message ?? '';
  if (!message && kindKey === 'activityFailureInfo') {
    message = `Activity ${info?.activityType?.name ?? ''} failed`.trim();
  }
  if (!message && kindKey === 'timeoutFailureInfo') {
    message = `Timeout (${info?.timeoutType ?? 'unknown'})`;
  }
  const out: WorkflowFailure = {
    message,
    kind: kindKey ? FAILURE_KINDS[kindKey] : undefined,
    type:
      kindKey === 'applicationFailureInfo'
        ? info?.type || undefined
        : undefined,
    source: failure.source || undefined,
    stackTrace: failure.stackTrace || undefined,
    nonRetryable:
      kindKey === 'applicationFailureInfo'
        ? Boolean(info?.nonRetryable)
        : undefined,
    cause:
      depth < MAX_CAUSE_DEPTH
        ? toWorkflowFailure(failure.cause, depth + 1)
        : undefined,
  };
  return dropUndefined(out);
}

/** Failure of a closed execution, from its closing history event. */
export function failureFromCloseEvent(
  event: Json,
): WorkflowFailure | undefined {
  if (!event) return undefined;
  if (event.workflowExecutionFailedEventAttributes) {
    return toWorkflowFailure(
      event.workflowExecutionFailedEventAttributes.failure,
    );
  }
  if (event.workflowExecutionTimedOutEventAttributes) {
    return { message: 'Workflow execution timed out', kind: 'TimeoutFailure' };
  }
  if (event.workflowExecutionTerminatedEventAttributes) {
    const reason = event.workflowExecutionTerminatedEventAttributes.reason;
    return {
      message: reason ? `Terminated: ${reason}` : 'Terminated',
      kind: 'TerminatedFailure',
    };
  }
  return undefined;
}

const PENDING_STATES: Record<string, string> = {
  PENDING_ACTIVITY_STATE_SCHEDULED: 'Scheduled',
  PENDING_ACTIVITY_STATE_STARTED: 'Started',
  PENDING_ACTIVITY_STATE_CANCEL_REQUESTED: 'CancelRequested',
  PENDING_ACTIVITY_STATE_PAUSED: 'Paused',
  PENDING_ACTIVITY_STATE_PAUSE_REQUESTED: 'PauseRequested',
};

export function toPendingActivity(raw: Json): PendingActivity {
  return dropUndefined({
    activityId: raw.activityId ?? '',
    activityType: raw.activityType?.name ?? '',
    state: PENDING_STATES[raw.state] ?? String(raw.state ?? 'Unknown'),
    attempt: raw.attempt !== undefined ? Number(raw.attempt) : undefined,
    maximumAttempts:
      raw.maximumAttempts !== undefined
        ? Number(raw.maximumAttempts)
        : undefined,
    scheduledTime: toIsoTime(raw.scheduledTime),
    lastStartedTime: toIsoTime(raw.lastStartedTime),
    lastHeartbeatTime: toIsoTime(raw.lastHeartbeatTime),
    lastFailure: toWorkflowFailure(raw.lastFailure),
  });
}

/** Converts a `DescribeWorkflowExecutionResponse` message (JSON form). */
export function toWorkflowDetail(
  describe: Json,
  options: ConvertOptions & { closeEvent?: Json },
): WorkflowDetail {
  const info = describe.workflowExecutionInfo ?? {};
  const summary = toWorkflowSummary(info, options);
  const memo: JsonObject = {};
  for (const [k, payload] of Object.entries(info.memo?.fields ?? {})) {
    const decoded = decodePayload(payload);
    memo[k] = 'value' in decoded ? decoded.value : decoded;
  }
  const parent = info.parentExecution?.workflowId
    ? dropUndefined({
        workflowId: info.parentExecution.workflowId as string,
        runId: (info.parentExecution.runId as string) || undefined,
        namespace: (info.parentNamespaceId as string) || undefined,
      })
    : undefined;
  return dropUndefined({
    ...summary,
    executionTime: toIsoTime(info.executionTime),
    parent,
    searchAttributes: decodeSearchAttributes(info.searchAttributes),
    memo: Object.keys(memo).length > 0 ? memo : undefined,
    failure: failureFromCloseEvent(options.closeEvent),
    pendingActivities: (describe.pendingActivities ?? []).map(
      toPendingActivity,
    ),
  });
}

const EVENT_ATTRIBUTES_SUFFIX = 'EventAttributes';

/** `EVENT_TYPE_ACTIVITY_TASK_SCHEDULED` becomes `ActivityTaskScheduled`. */
export function eventTypeName(value: unknown): string {
  return String(value ?? 'Unspecified')
    .replace(/^EVENT_TYPE_/, '')
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_m, _s, c: string) => c.toUpperCase());
}

/** Converts a `HistoryEvent` message (JSON form). */
export function toHistoryEvent(event: Json): WorkflowHistoryEvent {
  const attributesKey = Object.keys(event).find(k =>
    k.endsWith(EVENT_ATTRIBUTES_SUFFIX),
  );
  return dropUndefined({
    eventId: String(event.eventId ?? ''),
    eventTime: toIsoTime(event.eventTime),
    eventType: eventTypeName(event.eventType),
    attributes: attributesKey
      ? (toDisplayJson(event[attributesKey]) as JsonObject)
      : undefined,
  });
}

export function dropUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/** Page tokens are opaque base64 strings for the frontend. */
export function encodePageToken(token: unknown): string | undefined {
  if (!token) return undefined;
  if (typeof token === 'string') return token || undefined;
  if (token instanceof Uint8Array) {
    return token.length > 0 ? Buffer.from(token).toString('base64') : undefined;
  }
  return undefined;
}

export function decodePageToken(token: unknown): Uint8Array | undefined {
  if (token === undefined || token === '') return undefined;
  if (typeof token !== 'string' || !/^[A-Za-z0-9+/=_-]{1,4096}$/.test(token)) {
    throw new TypeError('Invalid page token');
  }
  return Buffer.from(token, 'base64');
}

/** Decodes `{ payloads: [...] }`: one payload becomes its value. */
export function decodePayloads(raw: Json): JsonValue | undefined {
  const payloads: Json[] | undefined = raw?.payloads;
  if (!Array.isArray(payloads) || payloads.length === 0) return undefined;
  const decoded = payloads.map(p =>
    isPayload(p) ? decodePayload(p) : (toDisplayJson(p) as JsonObject),
  );
  return decoded.length === 1 ? decoded[0] : decoded;
}

const ACTIVITY_CLOSE_EVENTS: Record<string, ActivityStep['status']> = {
  activityTaskCompletedEventAttributes: 'Completed',
  activityTaskFailedEventAttributes: 'Failed',
  activityTaskTimedOutEventAttributes: 'TimedOut',
  activityTaskCanceledEventAttributes: 'Canceled',
};

/**
 * Builds workflow input/result and one step per activity from history events
 * (JSON form, oldest first).
 */
export function toWorkflowSteps(
  events: Json[],
  truncated: boolean,
): WorkflowStepsResponse {
  const response: WorkflowStepsResponse = { activities: [], truncated };
  const byScheduledId = new Map<string, ActivityStep>();
  // Model calls: call name and decoded result, by scheduled event ID.
  const llmCalls = new Map<string, { call: string; result?: unknown }>();
  for (const event of events) {
    const time = toIsoTime(event.eventTime);
    const started = event.workflowExecutionStartedEventAttributes;
    if (started) {
      response.input = decodePayloads(started.input) ?? null;
      continue;
    }
    const completed = event.workflowExecutionCompletedEventAttributes;
    if (completed) {
      response.result = decodePayloads(completed.result) ?? null;
      continue;
    }
    const failed = event.workflowExecutionFailedEventAttributes;
    if (failed) {
      response.failure = toWorkflowFailure(failed.failure);
      continue;
    }
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled) {
      const step: ActivityStep = dropUndefined({
        activityId: scheduled.activityId ?? '',
        activityType: scheduled.activityType?.name ?? '',
        scheduledEventId: String(event.eventId ?? ''),
        status: 'Scheduled' as const,
        scheduledTime: time,
        input: decodePayloads(scheduled.input),
      });
      const marker = parseLlmMarker(step.activityId);
      if (marker?.kind === 'llm') {
        llmCalls.set(step.scheduledEventId, { call: marker.call });
      } else if (marker) {
        step.tool = { call: marker.call, toolCallId: marker.toolCallId };
      }
      byScheduledId.set(step.scheduledEventId, step);
      response.activities.push(step);
      continue;
    }
    const startedActivity = event.activityTaskStartedEventAttributes;
    if (startedActivity) {
      const step = byScheduledId.get(String(startedActivity.scheduledEventId));
      if (step) {
        step.status = 'Started';
        step.attempt = Number(startedActivity.attempt ?? 1);
        if (time) step.startedTime = time;
      }
      continue;
    }
    for (const [key, status] of Object.entries(ACTIVITY_CLOSE_EVENTS)) {
      const attrs = event[key];
      if (!attrs) continue;
      const step = byScheduledId.get(String(attrs.scheduledEventId));
      if (!step) break;
      step.status = status;
      if (time) step.closeTime = time;
      if (attrs.result) step.result = decodePayloads(attrs.result) ?? null;
      if (attrs.failure) step.failure = toWorkflowFailure(attrs.failure);
      const llm = llmCalls.get(step.scheduledEventId);
      if (llm) llm.result = step.result;
      break;
    }
  }
  if (llmCalls.size > 0 || response.activities.some(s => s.tool)) {
    const nodes = response.activities.map(step => {
      const llm = llmCalls.get(step.scheduledEventId);
      const status: WorkflowNodeStatus =
        step.status === 'Started' ? 'Running' : step.status;
      return {
        step,
        node: {
          id: `activity-${step.scheduledEventId}`,
          kind: 'activity' as const,
          name: step.activityType,
          status,
          startTime: step.startedTime ?? step.scheduledTime,
          endTime: step.closeTime,
          events: [],
          first: Number(step.scheduledEventId),
          tool: step.tool,
          llm: llm
            ? summarizeLlmCall(
                {
                  status,
                  startTime: step.startedTime ?? step.scheduledTime,
                  endTime: step.closeTime,
                },
                llm.call,
                llm.result,
              )
            : undefined,
        },
      };
    });
    linkLlmSteps(nodes.map(n => n.node));
    for (const { step, node } of nodes) {
      if (node.llm) step.llm = node.llm;
    }
  }
  return response;
}
