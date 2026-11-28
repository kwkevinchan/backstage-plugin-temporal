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

import { NotFoundError } from '@backstage/errors';
import {
  WorkflowDetail,
  ExternalPayload,
  WorkflowLlmCallResponse,
} from '../common';
import { decodePayloads } from './convert';
import { buildWorkflowGraphWithLlm } from './graph';
import { MAX_STEP_EVENTS, WorkflowQueries } from './WorkflowQueries';

/**
 * The payload in External Storage that holds a result or failure, if any,
 * and why a model call would have no record from it.
 */
function readState(roots: unknown[]): {
  external?: ExternalPayload;
  reason: string;
} {
  const candidates: unknown[] = [];
  for (const root of roots as any[]) {
    if (root?.payloads) {
      const decoded = decodePayloads(root);
      candidates.push(...(Array.isArray(decoded) ? decoded : [decoded]));
    }
    for (let f = root, depth = 0; f && depth < 5; f = f.cause, depth++) {
      const details = decodePayloads(f.applicationFailureInfo?.details);
      if (Array.isArray(details)) candidates.push(...details);
      else if (details !== undefined) candidates.push(details);
    }
  }
  const external = candidates
    .map(c => (c as any)?.external as ExternalPayload | undefined)
    .find(e => e !== undefined);
  if (external) {
    return {
      external,
      reason:
        'The record is stored in External Storage; the backend shows where it is and does not read it.',
    };
  }
  if (candidates.some(c => (c as any)?.undecodable)) {
    return {
      external,
      reason:
        'The result is encoded by a payload codec (for example encryption); the backend cannot read it.',
    };
  }
  return { external, reason: 'The result has no record of the model call.' };
}

/**
 * True when `scheduledEventId` is a positive integer after the last event read
 * from history (or when no numeric event IDs were present at all).
 */
function isAfterReadEvents(
  events: unknown[],
  scheduledEventId: string,
): boolean {
  if (!/^\d+$/.test(scheduledEventId)) return false;
  let maxEventId: bigint | undefined;
  for (const event of events as { eventId?: unknown }[]) {
    const raw = event?.eventId;
    if (
      typeof raw !== 'string' &&
      typeof raw !== 'number' &&
      typeof raw !== 'bigint'
    ) {
      continue;
    }
    const text = String(raw);
    if (!/^\d+$/.test(text)) continue;
    const id = BigInt(text);
    if (maxEventId === undefined || id > maxEventId) {
      maxEventId = id;
    }
  }
  return maxEventId === undefined || BigInt(scheduledEventId) > maxEventId;
}

/**
 * The use cases of the model-call views: the records of a run's model
 * calls. Callers check permissions first (see `access/`).
 */
export class AiWorkflowQueries {
  constructor(private readonly queries: WorkflowQueries) {}

  /**
   * The full record of one model call of a run, by the event ID of its
   * `ActivityTaskScheduled` event. Payloads of the step stored in
   * External Storage are not read: the record is unavailable and the
   * response says where the payload is.
   */
  async llmCall(
    workflow: WorkflowDetail,
    scheduledEventId: string,
  ): Promise<WorkflowLlmCallResponse> {
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    // Reads up to MAX_STEP_EVENTS and rebuilds the step graph per request
    // rather than caching or indexing incrementally.
    const { events, truncated } = await this.queries.readEvents(
      ref,
      MAX_STEP_EVENTS,
    );
    let result: unknown;
    const failures: unknown[] = [];
    for (const event of events as any[]) {
      const completed = event.activityTaskCompletedEventAttributes;
      if (
        completed?.result &&
        String(completed.scheduledEventId) === scheduledEventId
      ) {
        result = completed.result;
      }
      const started = event.activityTaskStartedEventAttributes;
      if (
        started?.lastFailure &&
        String(started.scheduledEventId) === scheduledEventId
      ) {
        failures.push(started.lastFailure);
      }
      for (const key of [
        'activityTaskFailedEventAttributes',
        'activityTaskTimedOutEventAttributes',
      ]) {
        const closed = event[key];
        if (
          closed?.failure &&
          String(closed.scheduledEventId) === scheduledEventId
        ) {
          failures.push(closed.failure);
        }
      }
    }
    const { graph, llm } = buildWorkflowGraphWithLlm(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated,
      pendingActivities: workflow.pendingActivities,
    });
    const nodeId = `activity-${scheduledEventId}`;
    const node = graph.nodes.find(n => n.id === nodeId);
    const read = llm.calls.get(nodeId);
    if (!node?.llm || !read) {
      if (truncated && !node && isAfterReadEvents(events, scheduledEventId)) {
        throw new NotFoundError(
          `Model call ${scheduledEventId} was not found within the first ${MAX_STEP_EVENTS} history events of this run; the history was truncated`,
        );
      }
      throw new NotFoundError(`No model call ${scheduledEventId} in this run`);
    }
    const { call } = read;
    const response: WorkflowLlmCallResponse = {
      nodeId,
      activityId: node.stepId ?? '',
      activityType: node.name,
      framework: read.framework,
      status: node.status,
    };
    if (call.record) {
      response.record = call.record;
      if (call.raw !== undefined) response.raw = call.raw;
      return response;
    }
    if (!result && failures.length === 0) {
      response.unavailable =
        node.llm.record === 'pending'
          ? 'The model call has not ended yet.'
          : 'The model call has no result.';
      return response;
    }
    const { external, reason } = readState(result ? [result] : failures);
    if (external) response.external = external;
    response.unavailable = reason;
    return response;
  }
}
