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
import type { WorkflowLlmSummary, WorkflowToolLink } from './llm';

/**
 * Status of a workflow execution, named like the Temporal visibility
 * `ExecutionStatus` values.
 *
 * @public
 */
export type WorkflowStatus =
  | 'Running'
  | 'Completed'
  | 'Failed'
  | 'Canceled'
  | 'Terminated'
  | 'ContinuedAsNew'
  | 'TimedOut'
  | 'Unknown';

/**
 * Every status that can be used to filter workflow lists.
 *
 * @public
 */
export const WORKFLOW_STATUSES: readonly Exclude<WorkflowStatus, 'Unknown'>[] =
  [
    'Running',
    'Completed',
    'Failed',
    'Canceled',
    'Terminated',
    'ContinuedAsNew',
    'TimedOut',
  ];

/**
 * Identifies one workflow execution. Without `runId` it means the latest run.
 *
 * @public
 */
export interface WorkflowRef {
  namespace: string;
  workflowId: string;
  runId?: string;
}

/**
 * One row of a workflow list.
 *
 * @public
 */
export interface WorkflowSummary {
  namespace: string;
  workflowId: string;
  runId: string;
  workflowType: string;
  taskQueue?: string;
  status: WorkflowStatus;
  /** ISO 8601 timestamp. */
  startTime?: string;
  /** ISO 8601 timestamp, set when the execution is closed. */
  closeTime?: string;
  historyLength?: number;
  /** Catalog entity reference from the configured search attribute. */
  entityRef?: string;
  /**
   * The `TemporalWorkflow` entity this run matches, when it is listed for an
   * entity that depends on one.
   */
  workflowEntityRef?: string;
  /** Link to the execution in the Temporal Web UI, when configured. */
  webUiUrl?: string;
  /** Data added by backend workflow enrichers, keyed by enricher. */
  extensions?: { [enricherId: string]: JsonValue };
}

/**
 * A failure with its cause chain flattened, outermost first.
 *
 * @public
 */
export interface WorkflowFailure {
  message: string;
  /** Failure kind, for example `ApplicationFailure` or `TimeoutFailure`. */
  kind?: string;
  /** Application error type, for `ApplicationFailure`. */
  type?: string;
  source?: string;
  stackTrace?: string;
  nonRetryable?: boolean;
  cause?: WorkflowFailure;
}

/**
 * An activity that is scheduled, started or waiting for a retry.
 *
 * @public
 */
export interface PendingActivity {
  activityId: string;
  activityType: string;
  state: string;
  attempt?: number;
  maximumAttempts?: number;
  scheduledTime?: string;
  lastStartedTime?: string;
  lastHeartbeatTime?: string;
  lastFailure?: WorkflowFailure;
}

/**
 * Details of one workflow execution.
 *
 * @public
 */
export interface WorkflowDetail extends WorkflowSummary {
  executionTime?: string;
  parent?: { workflowId: string; runId?: string; namespace?: string };
  searchAttributes?: JsonObject;
  memo?: JsonObject;
  /** Failure of a closed execution (failed, timed out, terminated). */
  failure?: WorkflowFailure;
  pendingActivities: PendingActivity[];
}

/**
 * Response of the entity workflow list.
 *
 * @public
 */
export interface WorkflowListResponse {
  items: WorkflowSummary[];
  /** Opaque token for the next page, absent on the last page. */
  nextPageToken?: string;
  namespace: string;
}

/**
 * Summary of an entity's most recent workflow runs.
 *
 * @public
 */
export interface WorkflowStatsResponse {
  namespace: string;
  /** Number of most recent runs the numbers are computed from. */
  sampleSize: number;
  /** The requested maximum of runs. */
  limit: number;
  /** Runs by status. */
  byStatus: Partial<Record<WorkflowStatus, number>>;
  /** Completed runs. */
  succeeded: number;
  /** Failed, timed out or terminated runs. */
  failed: number;
  /** Running runs. */
  running: number;
  /** Mean duration of the closed runs in the sample, in milliseconds. */
  averageDurationMs?: number;
}

/**
 * One history event. `attributes` holds the event attributes as JSON, with
 * payloads shown as `{ encoding, value }` (decoded JSON) or
 * `{ encoding, data }` (base64 of data that is not plain JSON, for example
 * encrypted payloads).
 *
 * @public
 */
export interface WorkflowHistoryEvent {
  eventId: string;
  eventTime?: string;
  /** Event type without the `EVENT_TYPE_` prefix, for example `WorkflowExecutionStarted`. */
  eventType: string;
  attributes?: JsonObject;
}

/**
 * One page of history events.
 *
 * @public
 */
export interface WorkflowHistoryResponse {
  events: WorkflowHistoryEvent[];
  nextPageToken?: string;
}

/**
 * A payload stored in S3-compatible storage, with a claim check (encoding
 * `json/claim-check`) in the history.
 *
 * - `inline`: the data was downloaded and is shown as the `value` of the
 *   payload;
 * - `preview`: the data is larger than the backend shows inline, or not
 *   JSON; `preview` holds the start of text data;
 * - `unconfigured`: the backend has no S3 configuration
 *   (`temporal.payloads.s3`), only the claim check is shown;
 * - `error`: the data could not be read or did not match the claim check.
 *
 * `downloadable` payloads can be downloaded through the backend:
 * `GET <workflow path>/payloads/download?key=<key>`.
 *
 * @public
 */
export interface ExternalPayload {
  store: string;
  bucket: string;
  key: string;
  /** Size of the data in bytes. */
  size: number;
  /** SHA-256 of the data, lowercase hex. */
  sha256: string;
  /** Encoding of the original payload, for example `json/plain`. */
  encoding: string;
  /** Media type of the data, for example `application/json` or `image/png`. */
  contentType: string;
  state: 'inline' | 'preview' | 'unconfigured' | 'error';
  /** Start of the data as UTF-8 text, for text media types. */
  preview?: string;
  /** True when `preview` is shorter than the data. */
  previewTruncated?: boolean;
  downloadable?: boolean;
  error?: string;
}

/**
 * Encoding of claim check payloads.
 *
 * @public
 */
export const CLAIM_CHECK_ENCODING = 'json/claim-check';

/**
 * A payload decoded with the default data converter. JSON payloads have a
 * `value`; payloads that cannot be decoded (binary, encrypted by a codec)
 * only show their encoding and size in bytes. Payloads stored in S3 have
 * `external`: with a `value` when the data is shown inline, without one
 * otherwise.
 *
 * @public
 */
export type DecodedPayload =
  | { encoding: string; value: JsonValue; external?: ExternalPayload }
  | {
      encoding: string;
      size: number;
      undecodable: true;
      metadata?: JsonObject;
    }
  | { encoding: typeof CLAIM_CHECK_ENCODING; external: ExternalPayload };

/**
 * One activity of a workflow run, from scheduling to its result.
 *
 * @public
 */
export interface ActivityStep {
  activityId: string;
  activityType: string;
  /** Event ID of `ActivityTaskScheduled`, unique within the run. */
  scheduledEventId: string;
  status:
    | 'Scheduled'
    | 'Started'
    | 'Completed'
    | 'Failed'
    | 'TimedOut'
    | 'Canceled';
  attempt?: number;
  scheduledTime?: string;
  startedTime?: string;
  closeTime?: string;
  /** Decoded input; one argument is a single payload, more are an array. */
  input?: JsonValue;
  /** Decoded result of a completed activity. */
  result?: JsonValue;
  failure?: WorkflowFailure;
  /** A model call (activity ID `llm/...`). */
  llm?: WorkflowLlmSummary;
  /** A tool call of a model call (activity ID `tool/...`). */
  tool?: WorkflowToolLink;
}

/**
 * Inputs and outputs of a workflow run: the workflow input and result, and
 * every activity with its input, result or failure.
 *
 * @public
 */
export interface WorkflowStepsResponse {
  /** Decoded workflow input. */
  input?: JsonValue;
  /** Decoded workflow result, when completed. */
  result?: JsonValue;
  failure?: WorkflowFailure;
  activities: ActivityStep[];
  /** True when the history was longer than the backend reads for steps. */
  truncated: boolean;
}
