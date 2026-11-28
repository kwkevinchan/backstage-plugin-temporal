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
import type { Client } from '@temporalio/client';
import type {
  TemporalScheduleOperation,
  WorkflowDetail,
  WorkflowIdReusePolicy,
  WorkflowRef,
  WorkflowStartResponse,
} from '../common';
import { decodeJsonPayloads } from '../lib/payloads';
import type {
  ScheduleTarget,
  TemporalScheduleRepository,
} from '../repositories/TemporalScheduleRepository';
import type {
  TemporalWriteRepository,
  WorkflowChainRef,
} from '../repositories/TemporalWriteRepository';

export type { WorkflowChainRef };

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
export const MAX_WORKFLOW_ID_LENGTH = 1000;

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

/** Most times an update that is not finished yet is polled for its result. */
const MAX_UPDATE_POLLS = 5;

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

/**
 * The operations that change workflows in Temporal: signal, update, cancel,
 * terminate, start and rerun, and pause, unpause and trigger of schedules.
 * Permission checks are done by the routes, through the access service of
 * the plugin; the calls to Temporal are made by the two repositories.
 */
export class WorkflowCommands {
  constructor(
    private readonly writes: TemporalWriteRepository,
    private readonly schedules: TemporalScheduleRepository,
    private readonly options: ControlOptions,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Runs a custom action with the client of `namespace`, under the deadline
   * of an action for every call it makes; its errors are mapped like those
   * of the other operations.
   */
  runAction<T>(namespace: string, run: (client: Client) => Promise<T>) {
    return this.writes.withClient(namespace, run);
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
    await this.writes.signal(ref, name, args, identity);
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
    // Each call has its own deadline: a slow update that finishes within
    // the polls is not cut short.
    const sent = await this.writes.sendUpdate(ref, {
      updateId,
      name,
      args,
      identity,
    });
    let { outcome } = sent;
    // The server answers before the update is done when its wait ends;
    // ask again for the outcome.
    for (let i = 0; !outcome && i < MAX_UPDATE_POLLS; i++) {
      ({ outcome } = await this.writes.pollUpdate(
        ref,
        sent.execution,
        updateId,
        identity,
      ));
    }
    if (!outcome) {
      // The update may still finish; a retry would send it again.
      this.logger
        .child({
          namespace: ref.namespace,
          workflowId: ref.workflowId,
          ...(ref.firstExecutionRunId
            ? { firstRunId: ref.firstExecutionRunId }
            : {}),
          ...(sent.execution.runId ? { runId: sent.execution.runId } : {}),
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
    await this.writes.cancel(ref, identity);
  }

  async terminate(
    ref: WorkflowChainRef,
    reason: string,
    identity: string,
  ): Promise<void> {
    await this.writes.terminate(ref, reason, identity);
  }

  async start(options: StartOptions): Promise<WorkflowStartResponse> {
    const workflowId =
      options.workflowId || newWorkflowId(options.workflowType);
    const runId = await this.writes.start({ ...options, workflowId });
    return { namespace: options.namespace, workflowId, runId };
  }

  /**
   * Starts a closed run again under a new workflow ID, with what its start
   * event has (see `TemporalWriteRepository.startLike`) and
   * `searchAttributes` set on top.
   */
  async rerun(
    workflow: WorkflowDetail,
    options: {
      workflowId?: string;
      searchAttributes: Record<string, string>;
      identity: string;
    },
  ): Promise<WorkflowStartResponse> {
    const started = await this.writes.startEvent({
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    });
    if (!started) {
      throw new NotFoundError('The start event of the run was not found');
    }
    const workflowId =
      options.workflowId ||
      newWorkflowId(workflow.workflowId.replace(RERUN_SUFFIX, ''), '-rerun');
    const runId = await this.writes.startLike(started, {
      namespace: workflow.namespace,
      workflowId,
      workflowType: workflow.workflowType,
      taskQueue: workflow.taskQueue ?? '',
      identity: options.identity,
      searchAttributes: options.searchAttributes,
    });
    return { namespace: workflow.namespace, workflowId, runId };
  }

  /** A schedule, read from Temporal for an operation on it. */
  describeSchedule(
    namespace: string,
    scheduleId: string,
  ): Promise<ScheduleTarget> {
    return this.schedules.target(namespace, scheduleId);
  }

  /**
   * Pauses, unpauses or triggers a schedule. A pause or an unpause keeps
   * `note`, or a note that names `requestedBy`. A trigger uses the
   * schedule's own overlap policy.
   */
  async operateSchedule(
    schedule: ScheduleTarget,
    operation: TemporalScheduleOperation,
    options: { note?: string; requestedBy: string },
  ): Promise<void> {
    const { note, requestedBy } = options;
    if (operation === 'pause') {
      await this.schedules.pause(
        schedule,
        note ?? `Paused from Backstage by ${requestedBy}`,
      );
    } else if (operation === 'unpause') {
      await this.schedules.unpause(
        schedule,
        note ?? `Resumed from Backstage by ${requestedBy}`,
      );
    } else {
      await this.schedules.trigger(schedule);
    }
  }
}
