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
 * Identifies a workflow ID, or one run of it with `runId`. Lists and links
 * may name a workflow without a run; the routes that read or change a run
 * take a {@link WorkflowRunRef}.
 *
 * @public
 */
export interface WorkflowRef {
  namespace: string;
  workflowId: string;
  runId?: string;
}

/**
 * Identifies one run (workflow execution).
 *
 * @public
 */
export type WorkflowRunRef = Required<WorkflowRef>;

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
   * Entity reference of the user who started the workflow, from the search
   * attribute `temporal.searchAttributes.initiator`, when configured.
   */
  initiator?: string;
  /**
   * The `TemporalWorkflow` entity this run matches, when it is listed for or
   * opened through an entity that depends on one.
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
  /**
   * True when the caller cannot read the event history: `failure` and the
   * `lastFailure` of the pending activities have only `message`, `kind` and
   * `type`, without the stack trace and the causes.
   */
  failureDetailsHidden?: boolean;
  /** The run this one continued as, for a run that continued as new. */
  continuedAsNewRunId?: string;
  /**
   * Run ID of the first execution in this run's chain (Continue-As-New,
   * workflow retry, cron or reset).
   */
  firstRunId?: string;
  pendingActivities: PendingActivity[];
}

/**
 * How many TemporalWorkflow entities an entity depends on, and how many of
 * them were queried for the merged list and statistics. At most 20 are
 * queried. Present on entity lists and statistics when the entity depends
 * on at least one; absent on namespace lists.
 *
 * @public
 */
export interface RelatedWorkflows {
  /** Number of TemporalWorkflow entities the entity depends on. */
  total: number;
  /**
   * Number of those entities included in the query, at most 20. When
   * `total` is greater, the rest are left out.
   */
  queried: number;
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
  /**
   * Present on entity lists when the entity depends on TemporalWorkflow
   * entities. Absent on namespace lists.
   */
  relatedWorkflows?: RelatedWorkflows;
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
  /**
   * Present when the entity depends on TemporalWorkflow entities. Absent
   * when it depends on none, or is itself a TemporalWorkflow entity.
   */
  relatedWorkflows?: RelatedWorkflows;
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
 * Where a payload in Temporal External Storage (the S3 driver of the
 * Temporal SDKs) is stored, from the reference payload in the history. The
 * backend does not read the stored data.
 *
 * @public
 */
export interface ExternalPayload {
  store: string;
  bucket: string;
  key: string;
  /** Size of the stored payload in bytes, as the reference records it. */
  size: number;
  /** SHA-256 of the stored object, lowercase hex. */
  sha256: string;
}

/**
 * A payload decoded with the default data converter. JSON payloads have a
 * `value`; payloads that cannot be decoded (binary, encrypted by a codec)
 * only show their encoding, their size in bytes and the other keys of their
 * metadata as text. Payloads in External Storage
 * have `external`, where they are stored, and no value.
 *
 * @public
 */
export type DecodedPayload =
  | { encoding: string; value: JsonValue }
  | {
      encoding: string;
      size: number;
      undecodable: true;
      metadata?: JsonObject;
    }
  | { encoding: string; external: ExternalPayload };

/**
 * The result or failure of a workflow run, read from its close event. A
 * running run has only `status`.
 *
 * @public
 */
export interface WorkflowResultResponse {
  status: WorkflowStatus;
  /** Decoded workflow result, when completed. */
  result?: JsonValue;
  failure?: WorkflowFailure;
}
