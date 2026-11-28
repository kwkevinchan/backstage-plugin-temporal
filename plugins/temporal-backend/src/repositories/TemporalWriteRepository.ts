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
import { InputError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import type { Client, Connection } from '@temporalio/client';
import type { WorkflowIdReusePolicy, WorkflowRef } from '../common';
import { TEMPORAL_DEADLINES } from '../lib/deadlines';
import { encodeJsonPayloads, TemporalJsonPayload } from '../lib/payloads';
import type { TemporalService } from '../node';
import {
  mapActionError,
  mapChainCommandError,
  mapCommandError,
  mapConnectionError,
} from './errors';
import { callTemporal } from './temporalCall';

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

/** The workflow ID reuse policies a start takes, with their protobuf values. */
export const WORKFLOW_ID_REUSE_POLICY: Record<WorkflowIdReusePolicy, number> = {
  ALLOW_DUPLICATE: 1,
  ALLOW_DUPLICATE_FAILED_ONLY: 2,
  REJECT_DUPLICATE: 3,
};

const UPDATE_STAGE_COMPLETED = 3;

type WorkflowService = Connection['workflowService'];

/** The attributes of the start event of a run, as Temporal sent them. */
export type StartEventAttributes = NonNullable<
  NonNullable<
    NonNullable<
      Awaited<
        ReturnType<WorkflowService['getWorkflowExecutionHistory']>
      >['history']
    >['events']
  >[number]['workflowExecutionStartedEventAttributes']
>;

/** The run an update is on, as Temporal addresses it. */
export interface UpdateExecution {
  workflowId: string;
  runId?: string;
}

/** What Temporal answers about an update: its outcome, once it has one. */
export interface UpdateAnswer {
  /** The encoded result (`success`) or the failure of a finished update. */
  outcome?: { success?: unknown; failure?: unknown };
}

/** What a new workflow is started with. */
export interface StartRequest {
  namespace: string;
  workflowId: string;
  workflowType: string;
  taskQueue: string;
  args?: JsonValue[];
  workflowIdReusePolicy?: WorkflowIdReusePolicy;
  /** Keyword search attributes to set, by name. */
  searchAttributes: Record<string, string>;
  identity: string;
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
 * Search attribute names Temporal keeps for itself (for example
 * `TemporalScheduledById`): a new workflow does not take them from another.
 */
function isSystemSearchAttribute(name: string): boolean {
  return name.startsWith('Temporal');
}

/**
 * The part of a request that addresses the target: the chain (workflow ID
 * plus `firstExecutionRunId`, never a workflow ID alone) or, without a chain
 * ID, the one run.
 */
function chainTarget(ref: WorkflowChainRef): {
  workflowExecution: UpdateExecution;
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
 * The calls to Temporal's workflow service that change workflows: signal,
 * update, cancel, terminate and start, and the client a custom action runs
 * with. They build the protobuf requests; errors are mapped to Backstage
 * errors. Nothing here checks permissions, namespaces or allowed names: the
 * routes and `WorkflowCommands` do.
 */
export class TemporalWriteRepository {
  constructor(
    private readonly temporal: TemporalService,
    private readonly logger: LoggerService,
  ) {}

  /** A call to the workflow service, with the errors of operations. */
  private call<T>(
    temporalCall: string,
    namespace: string,
    timeoutMs: number,
    fn: (service: WorkflowService) => Promise<T>,
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
      c => fn(c.workflowService),
    );
  }

  /**
   * A call addressed to an execution chain (`workflowId` plus
   * `firstExecutionRunId`), mapping ended / mismatched-chain errors to 409.
   */
  private async callChain<T>(
    temporalCall: string,
    ref: WorkflowChainRef,
    timeoutMs: number,
    fn: (service: WorkflowService) => Promise<T>,
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
      c => fn(c.workflowService),
    );
  }

  /**
   * Runs `run` with the client of `namespace`, under the deadline of a
   * custom action (`TEMPORAL_DEADLINES.action`) for every call it makes, and
   * rethrows its errors with `mapActionError`.
   */
  withClient<T>(namespace: string, run: (client: Client) => Promise<T>) {
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

  async signal(
    ref: Required<WorkflowRef>,
    name: string,
    args: JsonValue[] | undefined,
    identity: string,
  ): Promise<void> {
    await this.call(
      'signalWorkflowExecution',
      ref.namespace,
      TEMPORAL_DEADLINES.operation,
      service =>
        service.signalWorkflowExecution({
          namespace: ref.namespace,
          workflowExecution: { workflowId: ref.workflowId, runId: ref.runId },
          signalName: name,
          input: encodeJsonPayloads(args),
          identity,
          requestId: randomUUID(),
        }),
    );
  }

  /**
   * Sends an update and waits for it to finish, as long as the server
   * waits. Returns its outcome when it finished, and the run to poll for
   * the outcome otherwise: the run that accepted the update when the
   * server tells it, else the target of the update.
   */
  async sendUpdate(
    ref: WorkflowChainRef,
    update: {
      updateId: string;
      name: string;
      args: JsonValue[] | undefined;
      identity: string;
    },
  ): Promise<UpdateAnswer & { execution: UpdateExecution }> {
    const target = chainTarget(ref);
    const response = await this.callChain(
      'updateWorkflowExecution',
      ref,
      TEMPORAL_DEADLINES.update,
      service =>
        service.updateWorkflowExecution({
          namespace: ref.namespace,
          ...target,
          waitPolicy: { lifecycleStage: UPDATE_STAGE_COMPLETED },
          request: {
            meta: { updateId: update.updateId, identity: update.identity },
            input: { name: update.name, args: encodeJsonPayloads(update.args) },
          },
        }),
    );
    const accepted = response?.updateRef?.workflowExecution;
    return {
      outcome: response?.outcome ?? undefined,
      execution: accepted?.runId
        ? {
            workflowId: accepted.workflowId || ref.workflowId,
            runId: accepted.runId,
          }
        : target.workflowExecution,
    };
  }

  /** Asks again for the outcome of an update sent to `ref`, on `execution`. */
  async pollUpdate(
    ref: WorkflowChainRef,
    execution: UpdateExecution,
    updateId: string,
    identity: string,
  ): Promise<UpdateAnswer> {
    const response = await this.callChain(
      'pollWorkflowExecutionUpdate',
      ref,
      TEMPORAL_DEADLINES.update,
      service =>
        service.pollWorkflowExecutionUpdate({
          namespace: ref.namespace,
          updateRef: { workflowExecution: execution, updateId },
          identity,
          waitPolicy: { lifecycleStage: UPDATE_STAGE_COMPLETED },
        }),
    );
    return { outcome: response?.outcome ?? undefined };
  }

  async cancel(ref: WorkflowChainRef, identity: string): Promise<void> {
    await this.callChain(
      'requestCancelWorkflowExecution',
      ref,
      TEMPORAL_DEADLINES.operation,
      service =>
        service.requestCancelWorkflowExecution({
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
      service =>
        service.terminateWorkflowExecution({
          namespace: ref.namespace,
          ...chainTarget(ref),
          reason,
          identity,
        }),
    );
  }

  /** Starts a workflow. Returns the ID of its run. */
  async start(request: StartRequest): Promise<string> {
    const response = await this.call(
      'startWorkflowExecution',
      request.namespace,
      TEMPORAL_DEADLINES.operation,
      service =>
        service.startWorkflowExecution({
          namespace: request.namespace,
          workflowId: request.workflowId,
          workflowType: { name: request.workflowType },
          taskQueue: { name: request.taskQueue },
          input: encodeJsonPayloads(request.args),
          identity: request.identity,
          requestId: randomUUID(),
          ...(request.workflowIdReusePolicy
            ? {
                workflowIdReusePolicy:
                  WORKFLOW_ID_REUSE_POLICY[request.workflowIdReusePolicy],
              }
            : {}),
          searchAttributes: {
            indexedFields: keywordAttributes(request.searchAttributes),
          },
        }),
    );
    return response.runId ?? '';
  }

  /** The attributes of the start event of a run; undefined without one. */
  async startEvent(
    ref: Required<WorkflowRef>,
  ): Promise<StartEventAttributes | undefined> {
    const history = await this.call(
      'getWorkflowExecutionHistory',
      ref.namespace,
      TEMPORAL_DEADLINES.read,
      service =>
        service.getWorkflowExecutionHistory({
          namespace: ref.namespace,
          execution: { workflowId: ref.workflowId, runId: ref.runId },
          maximumPageSize: 1,
        }),
    );
    return (
      history.history?.events?.[0]?.workflowExecutionStartedEventAttributes ??
      undefined
    );
  }

  /**
   * Starts a workflow with what the start event of another run has: its
   * input, timeouts, retry policy, memo, header and search attributes, with
   * `searchAttributes` set on top. The input is copied as it is, so
   * payloads the backend cannot decode are kept. The search attributes
   * Temporal sets itself (`Temporal...`) are not copied. `workflowType` and
   * `taskQueue` are for a start event without them. Returns the ID of the
   * new run.
   */
  async startLike(
    started: StartEventAttributes,
    request: Omit<StartRequest, 'args' | 'workflowIdReusePolicy'>,
  ): Promise<string> {
    const response = await this.call(
      'startWorkflowExecution',
      request.namespace,
      TEMPORAL_DEADLINES.operation,
      service =>
        service.startWorkflowExecution({
          namespace: request.namespace,
          workflowId: request.workflowId,
          workflowType: {
            name: started.workflowType?.name ?? request.workflowType,
          },
          taskQueue: {
            name: started.taskQueue?.name ?? request.taskQueue,
          },
          input: started.input,
          header: started.header,
          memo: started.memo,
          workflowExecutionTimeout: started.workflowExecutionTimeout,
          workflowRunTimeout: started.workflowRunTimeout,
          workflowTaskTimeout: started.workflowTaskTimeout,
          retryPolicy: started.retryPolicy,
          identity: request.identity,
          requestId: randomUUID(),
          searchAttributes: {
            indexedFields: {
              ...Object.fromEntries(
                Object.entries(
                  started.searchAttributes?.indexedFields ?? {},
                ).filter(([name]) => !isSystemSearchAttribute(name)),
              ),
              ...keywordAttributes(request.searchAttributes),
            },
          },
        }),
    );
    return response.runId ?? '';
  }
}
