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
import type { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import {
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import type {
  Client,
  Connection,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import type {
  TemporalScheduleOperation,
  WorkflowDetail,
  WorkflowIdReusePolicy,
  WorkflowRef,
  WorkflowStartResponse,
} from '../common';
import { TemporalService } from '../node';
import { scheduleClientOf } from '../repositories/scheduleClient';
import {
  decodeJsonPayloads,
  encodeJsonPayloads,
  TemporalJsonPayload,
} from './payloads';
import {
  isScheduleNotFound,
  mapActionError,
  mapChainCommandError,
  mapCommandError,
  mapConnectionError,
} from '../repositories/errors';
import { callTemporal, TEMPORAL_DEADLINES } from '../repositories/temporalCall';

/**
 * Identifies an execution chain (Continue-As-New, workflow retry, cron or
 * reset) without locking to one run ID. Without `firstExecutionRunId` (the
 * Temporal server did not report it) the request is locked to `runId`.
 */
export type WorkflowChainRef = {
  namespace: string;
  workflowId: string;
} & (
  | { firstExecutionRunId: string; runId?: undefined }
  | { firstExecutionRunId?: undefined; runId: string }
);

/** `temporal.control` settings. */
interface ControlOptions {
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

/** Longest workflow ID Temporal accepts by default. */
const MAX_WORKFLOW_ID_LENGTH = 1000;

/**
 * A new workflow ID from a prefix: `<prefix><infix>-<time>`. The prefix is
 * cut so that the ID stays within Temporal's limit; the infix is kept.
 */
function newWorkflowId(prefix: string, infix = ''): string {
  const suffix = `${infix}-${Date.now().toString(36)}${randomUUID().slice(
    0,
    4,
  )}`;
  return `${prefix.slice(0, MAX_WORKFLOW_ID_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Search attribute names Temporal keeps for itself (for example
 * `TemporalScheduledById`): a new workflow does not take them from another.
 */
function isSystemSearchAttribute(name: string): boolean {
  return name.startsWith('Temporal');
}

/** Most times an update that is not finished yet is polled for its result. */
const MAX_UPDATE_POLLS = 5;
const UPDATE_STAGE_COMPLETED = 3;

const WORKFLOW_ID_REUSE_POLICY: Record<WorkflowIdReusePolicy, number> = {
  ALLOW_DUPLICATE: 1,
  ALLOW_DUPLICATE_FAILED_ONLY: 2,
  REJECT_DUPLICATE: 3,
};

interface StartOptions {
  namespace: string;
  workflowType: string;
  taskQueue: string;
  args?: JsonValue[];
  workflowId?: string;
  workflowIdReusePolicy?: WorkflowIdReusePolicy;
  /** Keyword search attributes to set, by name. */
  searchAttributes: Record<string, string>;
  identity: string;
}

/** A schedule to operate: what it starts, and its overlap policy. */
interface ScheduleTarget {
  namespace: string;
  scheduleId: string;
  workflowType: string;
  taskQueue: string;
  overlap?: ScheduleOverlapPolicy;
}

/** Keyword search attributes: JSON payloads with the `Keyword` type. */
function keywordAttributes(
  values: Record<string, string>,
): Record<string, TemporalJsonPayload> {
  const indexedFields: Record<string, TemporalJsonPayload> = {};
  for (const [name, value] of Object.entries(values)) {
    const [payload] = encodeJsonPayloads([value]).payloads;
    indexedFields[name] = {
      metadata: { ...payload.metadata, type: Buffer.from('Keyword') },
      data: payload.data,
    };
  }
  return indexedFields;
}

/**
 * The part of a request that addresses the target: the chain (workflow ID
 * plus `firstExecutionRunId`, never a workflow ID alone) or, without a chain
 * ID, the one run.
 */
function chainTarget(ref: WorkflowChainRef): {
  workflowExecution: { workflowId: string; runId?: string };
  firstExecutionRunId?: string;
} {
  return ref.firstExecutionRunId
    ? {
        workflowExecution: { workflowId: ref.workflowId },
        firstExecutionRunId: ref.firstExecutionRunId,
      }
    : {
        workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
      };
}

/**
 * The operations that change workflows in Temporal: signal, update, cancel,
 * terminate, start and rerun, and pause, unpause and trigger of schedules.
 * Permission checks are done by the routes, through the access service of
 * the plugin.
 */
export class WorkflowCommands {
  constructor(
    private readonly temporal: TemporalService,
    private readonly options: ControlOptions,
    private readonly logger: LoggerService,
  ) {}

  /** A call to Temporal, with the errors of operations. */
  private call<T>(
    temporalCall: string,
    namespace: string,
    timeoutMs: number,
    fn: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    return callTemporal(
      this.temporal,
      {
        timeoutMs,
        mapError: mapCommandError,
        temporalCall,
        namespace,
        logger: this.logger,
      },
      fn,
    );
  }

  /**
   * A call to Temporal addressed to an execution chain (`workflowId` plus
   * `firstExecutionRunId`), mapping ended / mismatched-chain errors to 409.
   */
  private callChain<T>(
    temporalCall: string,
    ref: WorkflowChainRef,
    timeoutMs: number,
    fn: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    if (!ref.firstExecutionRunId) {
      if (!ref.runId) {
        throw new InputError('firstExecutionRunId or runId is required');
      }
      // No chain ID: the request is locked to one run.
      return this.call(temporalCall, ref.namespace, timeoutMs, fn);
    }
    return callTemporal(
      this.temporal,
      {
        timeoutMs,
        mapError: error => mapChainCommandError(ref.workflowId, error),
        temporalCall,
        namespace: ref.namespace,
        logger: this.logger,
      },
      fn,
    );
  }

  /**
   * Runs a custom action with the client of `namespace`, under the deadline
   * of an action (`TEMPORAL_DEADLINES.action`) for every call it makes, and
   * rethrows its errors with `mapActionError`.
   */
  runAction<T>(namespace: string, run: (client: Client) => Promise<T>) {
    return callTemporal(
      this.temporal,
      {
        timeoutMs: TEMPORAL_DEADLINES.action,
        mapError: mapActionError,
        temporalCall: 'customAction',
        namespace,
        logger: this.logger,
      },
      async () =>
        run(
          await this.temporal
            .getClient({ namespace })
            .catch(mapConnectionError),
        ),
    );
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
    await this.call(
      'signalWorkflowExecution',
      ref.namespace,
      TEMPORAL_DEADLINES.operation,
      c =>
        c.workflowService.signalWorkflowExecution({
          namespace: ref.namespace,
          workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
          signalName: name,
          input: encodeJsonPayloads(args),
          identity,
          requestId: randomUUID(),
        }),
    );
  }

  async update(
    ref: WorkflowChainRef,
    name: string,
    args: JsonValue[] | undefined,
    identity: string,
    /**
     * The ID of the update. Sending the same ID again does not run the
     * update a second time: Temporal answers with the outcome of the first.
     */
    requestedUpdateId?: string,
  ): Promise<JsonValue | undefined> {
    this.checkUpdate(name);
    const updateId = requestedUpdateId ?? randomUUID();
    const { workflowExecution } = chainTarget(ref);
    const waitPolicy = { lifecycleStage: UPDATE_STAGE_COMPLETED };
    // Each call has its own deadline: a slow update that finishes within
    // the polls is not cut short.
    let response: any = await this.callChain(
      'updateWorkflowExecution',
      ref,
      TEMPORAL_DEADLINES.update,
      c =>
        c.workflowService.updateWorkflowExecution({
          namespace: ref.namespace,
          ...chainTarget(ref),
          waitPolicy,
          request: {
            meta: { updateId, identity },
            input: { name, args: encodeJsonPayloads(args) },
          },
        }),
    );
    // Poll the run that actually accepted the update when the server
    // returned it, else keep addressing the same target as the update.
    const acceptedExecution: { workflowId: string; runId?: string } = response
      ?.updateRef?.workflowExecution?.runId
      ? {
          workflowId:
            response.updateRef.workflowExecution.workflowId || ref.workflowId,
          runId: response.updateRef.workflowExecution.runId,
        }
      : workflowExecution;
    // The server answers before the update is done when its wait ends;
    // ask again for the outcome.
    for (let i = 0; !response?.outcome && i < MAX_UPDATE_POLLS; i++) {
      response = await this.callChain(
        'pollWorkflowExecutionUpdate',
        ref,
        TEMPORAL_DEADLINES.update,
        c =>
          c.workflowService.pollWorkflowExecutionUpdate({
            namespace: ref.namespace,
            updateRef: { workflowExecution: acceptedExecution, updateId },
            identity,
            waitPolicy,
          }),
      );
    }
    const outcome = response?.outcome;
    if (!outcome) {
      // The update may still finish; a retry would send it again.
      this.logger
        .child({
          namespace: ref.namespace,
          workflowId: ref.workflowId,
          ...(ref.firstExecutionRunId
            ? { firstRunId: ref.firstExecutionRunId }
            : {}),
          ...(acceptedExecution.runId
            ? { runId: acceptedExecution.runId }
            : {}),
          messageName: name,
          updateId,
        })
        .warn('The update did not finish within the polls');
      throw new ServiceUnavailableError('The update did not finish in time');
    }
    if (outcome.failure) {
      throw new InputError(failureMessage(outcome.failure));
    }
    return decodeJsonPayloads(outcome.success);
  }

  async cancel(ref: WorkflowChainRef, identity: string): Promise<void> {
    await this.callChain(
      'requestCancelWorkflowExecution',
      ref,
      TEMPORAL_DEADLINES.operation,
      c =>
        c.workflowService.requestCancelWorkflowExecution({
          namespace: ref.namespace,
          ...chainTarget(ref),
          identity,
          requestId: randomUUID(),
        }),
    );
  }

  async terminate(
    ref: WorkflowChainRef,
    reason: string,
    identity: string,
  ): Promise<void> {
    await this.callChain(
      'terminateWorkflowExecution',
      ref,
      TEMPORAL_DEADLINES.operation,
      c =>
        c.workflowService.terminateWorkflowExecution({
          namespace: ref.namespace,
          ...chainTarget(ref),
          reason,
          identity,
        }),
    );
  }

  async start(options: StartOptions): Promise<WorkflowStartResponse> {
    const workflowId =
      options.workflowId || newWorkflowId(options.workflowType);
    const response = await this.call(
      'startWorkflowExecution',
      options.namespace,
      TEMPORAL_DEADLINES.operation,
      c =>
        c.workflowService.startWorkflowExecution({
          namespace: options.namespace,
          workflowId,
          workflowType: { name: options.workflowType },
          taskQueue: { name: options.taskQueue },
          input: encodeJsonPayloads(options.args),
          identity: options.identity,
          requestId: randomUUID(),
          ...(options.workflowIdReusePolicy
            ? {
                workflowIdReusePolicy:
                  WORKFLOW_ID_REUSE_POLICY[options.workflowIdReusePolicy],
              }
            : {}),
          searchAttributes: {
            indexedFields: keywordAttributes(options.searchAttributes),
          },
        }),
    );
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
   * is, so payloads the backend cannot decode are kept. The search
   * attributes Temporal sets itself (`Temporal...`) are not copied.
   */
  async rerun(
    workflow: WorkflowDetail,
    options: {
      workflowId?: string;
      searchAttributes: Record<string, string>;
      identity: string;
    },
  ): Promise<WorkflowStartResponse> {
    const history = await this.call(
      'getWorkflowExecutionHistory',
      workflow.namespace,
      TEMPORAL_DEADLINES.read,
      c =>
        c.workflowService.getWorkflowExecutionHistory({
          namespace: workflow.namespace,
          execution: { workflowId: workflow.workflowId, runId: workflow.runId },
          maximumPageSize: 1,
        }),
    );
    const started =
      history.history?.events?.[0]?.workflowExecutionStartedEventAttributes;
    if (!started) {
      throw new NotFoundError('The start event of the run was not found');
    }
    const workflowId =
      options.workflowId ||
      newWorkflowId(workflow.workflowId.replace(RERUN_SUFFIX, ''), '-rerun');
    const response = await this.call(
      'startWorkflowExecution',
      workflow.namespace,
      TEMPORAL_DEADLINES.operation,
      c =>
        c.workflowService.startWorkflowExecution({
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
              ...Object.fromEntries(
                Object.entries(
                  started.searchAttributes?.indexedFields ?? {},
                ).filter(([name]) => !isSystemSearchAttribute(name)),
              ),
              ...keywordAttributes(options.searchAttributes),
            },
          },
        }),
    );
    return {
      namespace: workflow.namespace,
      workflowId,
      runId: response.runId ?? '',
    };
  }

  /** A schedule, read from Temporal for an operation on it. */
  async describeSchedule(
    namespace: string,
    scheduleId: string,
  ): Promise<ScheduleTarget> {
    const description = await this.call(
      'schedule.describe',
      namespace,
      TEMPORAL_DEADLINES.read,
      c =>
        scheduleClientOf(c, namespace)
          .getHandle(scheduleId)
          .describe()
          .catch(error => {
            if (isScheduleNotFound(error)) {
              throw new NotFoundError(`No schedule ${scheduleId}`);
            }
            throw error;
          }),
    );
    return {
      namespace,
      scheduleId,
      workflowType: description.action.workflowType,
      taskQueue: description.action.taskQueue,
      overlap: description.policies?.overlap,
    };
  }

  /**
   * Pauses, unpauses or triggers a schedule. A pause or an unpause keeps
   * `note`, or a note that names `requestedBy`. A trigger uses the
   * schedule's own overlap policy (the SDK's default is to allow every
   * overlap).
   */
  async operateSchedule(
    schedule: ScheduleTarget,
    operation: TemporalScheduleOperation,
    options: { note?: string; requestedBy: string },
  ): Promise<void> {
    const { note, requestedBy } = options;
    await this.call(
      `schedule.${operation}`,
      schedule.namespace,
      TEMPORAL_DEADLINES.operation,
      async c => {
        const handle = scheduleClientOf(c, schedule.namespace).getHandle(
          schedule.scheduleId,
        );
        if (operation === 'pause') {
          await handle.pause(note ?? `Paused from Backstage by ${requestedBy}`);
        } else if (operation === 'unpause') {
          await handle.unpause(
            note ?? `Resumed from Backstage by ${requestedBy}`,
          );
        } else {
          await handle.trigger(schedule.overlap);
        }
      },
    );
  }
}
