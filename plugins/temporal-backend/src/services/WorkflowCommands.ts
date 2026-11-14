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
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import type { ScheduleOverlapPolicy } from '@temporalio/client';
import type {
  TemporalScheduleOperation,
  WorkflowDetail,
  WorkflowRef,
  WorkflowStartResponse,
} from '../common';
import { TemporalService } from '../node';
import {
  decodeJsonPayloads,
  encodeJsonPayloads,
  TemporalJsonPayload,
} from './payloads';
import {
  isScheduleNotFound,
  mapCommandError,
} from '../repositories/TemporalReadRepository';

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

/** A schedule to operate: what it starts, and its overlap policy. */
export interface ScheduleTarget {
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
 * The operations that change workflows in Temporal: signal, update, cancel,
 * terminate, start and rerun, and pause, unpause and trigger of schedules.
 * Permission checks are done by the routes, through the access service of
 * the plugin.
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
      .catch(mapCommandError);
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
      .catch(mapCommandError);
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
        .catch(mapCommandError);
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
      .catch(mapCommandError);
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
      .catch(mapCommandError);
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
      .catch(mapCommandError);
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
      .catch(mapCommandError);
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
      .catch(mapCommandError);
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
    const client = await this.temporal.getClient({ namespace });
    const handle = client.schedule.getHandle(scheduleId);
    const description = await handle.describe().catch(error => {
      if (isScheduleNotFound(error)) {
        throw new NotFoundError(`No schedule ${scheduleId}`);
      }
      return mapCommandError(error);
    });
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
    const client = await this.temporal.getClient({
      namespace: schedule.namespace,
    });
    const handle = client.schedule.getHandle(schedule.scheduleId);
    const { note, requestedBy } = options;
    try {
      if (operation === 'pause') {
        await handle.pause(note ?? `Paused from Backstage by ${requestedBy}`);
      } else if (operation === 'unpause') {
        await handle.unpause(
          note ?? `Resumed from Backstage by ${requestedBy}`,
        );
      } else {
        await handle.trigger(schedule.overlap);
      }
    } catch (error) {
      mapCommandError(error);
    }
  }
}
