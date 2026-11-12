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

import { randomUUID } from 'node:crypto';
import { Config } from '@backstage/config';
import {
  ConflictError,
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import type {
  WorkflowDetail,
  WorkflowRef,
  WorkflowStartResponse,
} from '../common';
import { TemporalService } from '../node';
import {
  decodeJsonPayloads,
  encodeJsonPayloads,
  TemporalJsonPayload,
} from '../node/alpha';

/** `temporal.control` settings. */
export interface ControlOptions {
  /** Empty allows every signal name. */
  allowedSignals: string[];
  /** Empty allows every update name. */
  allowedUpdates: string[];
}

export function readControlOptions(config: Config): ControlOptions {
  const control = config.getOptionalConfig('temporal.control');
  return {
    allowedSignals: control?.getOptionalStringArray('allowedSignals') ?? [],
    allowedUpdates: control?.getOptionalStringArray('allowedUpdates') ?? [],
  };
}

/** gRPC status codes of Temporal errors handled here. */
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_UNAUTHENTICATED = 16;
const GRPC_ALREADY_EXISTS = 6;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

/**
 * Rethrows a Temporal error as the Backstage error of its HTTP status. The
 * raw service calls throw the gRPC error itself; the schedule client wraps
 * it in a `ServiceError` with the gRPC error as `cause`.
 */
export function mapControlError(error: unknown): never {
  const message = (error as Error)?.message ?? String(error);
  const name = (error as Error)?.name;
  if (name === 'ScheduleNotFoundError' || name === 'NamespaceNotFoundError') {
    throw new NotFoundError(message);
  }
  const cause = (error as { cause?: { code?: unknown; details?: unknown } })
    ?.cause;
  const code = (error as { code?: unknown })?.code ?? cause?.code;
  if (code === GRPC_ALREADY_EXISTS || code === GRPC_FAILED_PRECONDITION) {
    throw new ConflictError(message);
  }
  if (code === GRPC_DEADLINE_EXCEEDED) {
    throw new ServiceUnavailableError(`No worker answered in time: ${message}`);
  }
  if (code === GRPC_NOT_FOUND) throw new NotFoundError(message);
  if (code === GRPC_INVALID_ARGUMENT) throw new InputError(message);
  if (code === GRPC_UNAVAILABLE) {
    throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
  }
  if (code === GRPC_PERMISSION_DENIED || code === GRPC_UNAUTHENTICATED) {
    // The backend's own credentials, not the user's: a server-side problem.
    throw new ServiceUnavailableError(
      `Temporal refused the credentials of the backend: ${message}`,
    );
  }
  throw error;
}

/** The message of a Temporal failure, with its causes. */
function failureMessage(failure: any): string {
  const parts: string[] = [];
  for (let f = failure, i = 0; f && i < 10; f = f.cause, i++) {
    if (f.message) parts.push(f.message);
  }
  return parts.join(': ') || 'The update failed';
}

/** Suffix of the workflow IDs made by rerun. */
const RERUN_SUFFIX = /-rerun-[a-z0-9]+$/;

/** A new workflow ID from a prefix: `<prefix>-<time>`. */
function newWorkflowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}

/** Most times an update that is not finished yet is polled for its result. */
const MAX_UPDATE_POLLS = 5;
const UPDATE_STAGE_COMPLETED = 3;

export interface StartOptions {
  namespace: string;
  workflowType: string;
  taskQueue: string;
  args?: JsonValue[];
  workflowId?: string;
  /** Keyword search attributes to set, by name. */
  searchAttributes: Record<string, string>;
  identity: string;
}

const JSON_ENCODING = Buffer.from('json/plain');
type Payload = TemporalJsonPayload;

function keywordAttributes(
  values: Record<string, string>,
): Record<string, Payload> {
  const indexedFields: Record<string, Payload> = {};
  for (const [name, value] of Object.entries(values)) {
    indexedFields[name] = {
      metadata: {
        encoding: JSON_ENCODING,
        type: Buffer.from('Keyword'),
      },
      data: Buffer.from(JSON.stringify(value)),
    };
  }
  return indexedFields;
}

/**
 * The operations that change workflows in Temporal: signal, update, cancel,
 * terminate, start and rerun. Permission checks are done by the routes,
 * through the access service of the plugin.
 */
export class WorkflowCommands {
  constructor(
    private readonly temporal: TemporalService,
    readonly options: ControlOptions,
  ) {}

  private async service() {
    return (await this.temporal.getConnection()).workflowService;
  }

  checkSignal(name: string) {
    const allowed = this.options.allowedSignals;
    if (allowed.length > 0 && !allowed.includes(name)) {
      throw new InputError(`Signal ${name} is not allowed`);
    }
  }

  checkUpdate(name: string) {
    const allowed = this.options.allowedUpdates;
    if (allowed.length > 0 && !allowed.includes(name)) {
      throw new InputError(`Update ${name} is not allowed`);
    }
  }

  async signal(
    ref: Required<WorkflowRef>,
    name: string,
    args: JsonValue[] | undefined,
    identity: string,
  ): Promise<void> {
    this.checkSignal(name);
    const service = await this.service();
    await service
      .signalWorkflowExecution({
        namespace: ref.namespace,
        workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
        signalName: name,
        input: encodeJsonPayloads(args),
        identity,
        requestId: randomUUID(),
      })
      .catch(mapControlError);
  }

  async update(
    ref: Required<WorkflowRef>,
    name: string,
    args: JsonValue[] | undefined,
    identity: string,
  ): Promise<JsonValue | undefined> {
    this.checkUpdate(name);
    const service = await this.service();
    const workflowExecution = {
      workflowId: ref.workflowId,
      runId: ref.runId,
    };
    const updateId = randomUUID();
    const waitPolicy = { lifecycleStage: UPDATE_STAGE_COMPLETED };
    let response: any = await service
      .updateWorkflowExecution({
        namespace: ref.namespace,
        workflowExecution,
        waitPolicy,
        request: {
          meta: { updateId, identity },
          input: { name, args: encodeJsonPayloads(args) },
        },
      })
      .catch(mapControlError);
    // The server answers before the update is done when its wait ends;
    // ask again for the outcome.
    for (let i = 0; !response?.outcome && i < MAX_UPDATE_POLLS; i++) {
      response = await service
        .pollWorkflowExecutionUpdate({
          namespace: ref.namespace,
          updateRef: { workflowExecution, updateId },
          identity,
          waitPolicy,
        })
        .catch(mapControlError);
    }
    const outcome = response?.outcome;
    if (!outcome) {
      throw new ServiceUnavailableError('The update did not finish in time');
    }
    if (outcome.failure) {
      throw new InputError(failureMessage(outcome.failure));
    }
    return decodeJsonPayloads(outcome.success);
  }

  async cancel(ref: Required<WorkflowRef>, identity: string): Promise<void> {
    const service = await this.service();
    await service
      .requestCancelWorkflowExecution({
        namespace: ref.namespace,
        workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
        identity,
        requestId: randomUUID(),
      })
      .catch(mapControlError);
  }

  async terminate(
    ref: Required<WorkflowRef>,
    reason: string,
    identity: string,
  ): Promise<void> {
    const service = await this.service();
    await service
      .terminateWorkflowExecution({
        namespace: ref.namespace,
        workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
        reason,
        identity,
      })
      .catch(mapControlError);
  }

  async start(options: StartOptions): Promise<WorkflowStartResponse> {
    const service = await this.service();
    const workflowId =
      options.workflowId || newWorkflowId(options.workflowType);
    const response = await service
      .startWorkflowExecution({
        namespace: options.namespace,
        workflowId,
        workflowType: { name: options.workflowType },
        taskQueue: { name: options.taskQueue },
        input: encodeJsonPayloads(options.args),
        identity: options.identity,
        requestId: randomUUID(),
        searchAttributes: {
          indexedFields: keywordAttributes(options.searchAttributes),
        },
      })
      .catch(mapControlError);
    return {
      namespace: options.namespace,
      workflowId,
      runId: response.runId ?? '',
    };
  }

  /**
   * Starts a closed run again under a new workflow ID: the input,
   * timeouts, retry policy, memo, header and search attributes of its start
   * event, with `searchAttributes` set on top. The input is copied as it
   * is, so payloads the backend cannot decode are kept.
   */
  async rerun(
    workflow: WorkflowDetail,
    options: {
      workflowId?: string;
      searchAttributes: Record<string, string>;
      identity: string;
    },
  ): Promise<WorkflowStartResponse> {
    const service = await this.service();
    const history = await service
      .getWorkflowExecutionHistory({
        namespace: workflow.namespace,
        execution: { workflowId: workflow.workflowId, runId: workflow.runId },
        maximumPageSize: 1,
      })
      .catch(mapControlError);
    const started =
      history.history?.events?.[0]?.workflowExecutionStartedEventAttributes;
    if (!started) {
      throw new NotFoundError('The start event of the run was not found');
    }
    const workflowId =
      options.workflowId ||
      newWorkflowId(`${workflow.workflowId.replace(RERUN_SUFFIX, '')}-rerun`);
    const response = await service
      .startWorkflowExecution({
        namespace: workflow.namespace,
        workflowId,
        workflowType: {
          name: started.workflowType?.name ?? workflow.workflowType,
        },
        taskQueue: {
          name: started.taskQueue?.name ?? workflow.taskQueue ?? '',
        },
        input: started.input,
        header: started.header,
        memo: started.memo,
        workflowExecutionTimeout: started.workflowExecutionTimeout,
        workflowRunTimeout: started.workflowRunTimeout,
        workflowTaskTimeout: started.workflowTaskTimeout,
        retryPolicy: started.retryPolicy,
        identity: options.identity,
        requestId: randomUUID(),
        searchAttributes: {
          indexedFields: {
            ...(started.searchAttributes?.indexedFields ?? {}),
            ...keywordAttributes(options.searchAttributes),
          },
        },
      })
      .catch(mapControlError);
    return {
      namespace: workflow.namespace,
      workflowId,
      runId: response.runId ?? '',
    };
  }
}
