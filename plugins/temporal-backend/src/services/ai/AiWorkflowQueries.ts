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

import { LoggerService } from '@backstage/backend-plugin-api';
import { NotFoundError } from '@backstage/errors';
import {
  LOOP_STATE_QUERY,
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowLoopGroup,
  WorkflowLoopRun,
  WorkflowLoopsResponse,
  ExternalPayload,
  WorkflowLlmCallResponse,
} from '../../common';
import type { JsonObject } from '@backstage/types';
import { decodePayloads } from '../convert';
import { buildWorkflowGraph } from '../graph';
import { llmRecordOf, normalizeLlmRecord } from './llm';
import { readLoopState } from './loops';
import { TemporalReadRepository } from '../../repositories/TemporalReadRepository';
import { MAX_STEP_EVENTS, WorkflowQueries } from '../WorkflowQueries';

/** Most continue-as-new runs read for the loops of a workflow. */
export const MAX_LOOP_RUNS = 20;
/** Time the loop state query may take; a workflow without a worker never answers. */
export const LOOP_QUERY_TIMEOUT_MS = 3000;

/** Largest record of a model call read from S3 (8 MiB). */
export const MAX_LLM_RECORD_BYTES = 8 * 1024 * 1024;

/** Why a record stored in S3 is not shown. */
function externalReason(external: ExternalPayload): string {
  if (external.state === 'unconfigured') {
    return 'The record is stored in S3, and the backend has no S3 configuration.';
  }
  if (external.state === 'error') {
    return `The record stored in S3 could not be read: ${
      external.error ?? ''
    }`.trim();
  }
  return 'The record stored in S3 is larger than the backend reads.';
}

/** The LLM record in a result or failure (protobuf JSON, resolved). */
function findLlmRecord(root: any): {
  record?: JsonObject;
  external?: ExternalPayload;
  reason?: string;
} {
  const candidates: unknown[] = [];
  if (root?.payloads) candidates.push(decodePayloads(root));
  for (let f = root, depth = 0; f && depth < 5; f = f.cause, depth++) {
    const details = decodePayloads(f.applicationFailureInfo?.details);
    if (Array.isArray(details)) candidates.push(...details);
    else if (details !== undefined) candidates.push(details);
  }
  let external: ExternalPayload | undefined;
  for (const c of candidates) {
    const decoded = c as any;
    if (decoded?.external) external = decoded.external;
    const record = llmRecordOf(decoded?.value);
    if (record) return { record, external };
  }
  if (external && external.state !== 'inline') {
    return { external, reason: externalReason(external) };
  }
  if (candidates.some(c => (c as any)?.undecodable)) {
    return {
      reason:
        'The result is encoded by a payload codec (for example encryption); the backend cannot read it.',
    };
  }
  return { reason: 'The result has no LLM record (`temporal.llm`).' };
}

/**
 * The use cases of the experimental AI views: loops of a workflow and the
 * records of its model calls. Callers check permissions first (see
 * `access/`); every method fails with NotFoundError unless
 * `temporal.experimental.aiWorkflows` is on.
 */
export class AiWorkflowQueries {
  constructor(
    private readonly temporalReads: TemporalReadRepository,
    private readonly logger: LoggerService,
    private readonly queries: WorkflowQueries,
  ) {}

  private assertAiWorkflows() {
    if (!this.queries.aiWorkflows) {
      throw new NotFoundError(
        'AI loops and LLM steps are not enabled (temporal.experimental.aiWorkflows)',
      );
    }
  }

  /**
   * Loops of a workflow across the runs it continued as new: the rounds of
   * each run from its history, and for a running workflow the state from
   * the `__loop_state` query when its worker answers.
   */
  async loops(workflow: WorkflowDetail): Promise<WorkflowLoopsResponse> {
    this.assertAiWorkflows();
    type Read = { detail: WorkflowDetail; graph: WorkflowGraphResponse };
    const read = async (detail: WorkflowDetail): Promise<Read> => ({
      detail,
      graph: await this.queries.graph(detail, { includePayloads: false }),
    });
    const describeRun = (runId: string) =>
      this.queries.describe({
        namespace: workflow.namespace,
        workflowId: workflow.workflowId,
        runId,
      });
    const current = await read(workflow);
    const runs: Read[] = [current];
    let truncated = current.graph.truncated;
    // Earlier runs, then later ones.
    let previous = current.graph.runChain?.previousRunId;
    while (previous && runs.length < MAX_LOOP_RUNS) {
      const run = await read(await describeRun(previous));
      runs.unshift(run);
      truncated ||= run.graph.truncated;
      previous = run.graph.runChain?.previousRunId;
    }
    let next = current.graph.runChain?.nextRunId;
    while (next && runs.length < MAX_LOOP_RUNS) {
      const run = await read(await describeRun(next));
      runs.push(run);
      truncated ||= run.graph.truncated;
      next = run.graph.runChain?.nextRunId;
    }
    if (previous || next) truncated = true;

    const loops: WorkflowLoopGroup[] = [];
    runs.forEach(({ detail, graph }, i) => {
      for (const group of graph.loops ?? []) {
        let loop = loops.find(l => l.name === group.name);
        if (!loop) {
          loop = { ...group, rounds: [] };
          loops.push(loop);
        }
        const { rounds, ...summary } = group;
        Object.assign(loop, summary);
        for (const round of rounds) {
          loop.rounds = loop.rounds.filter(
            r => r.iteration !== round.iteration,
          );
          loop.rounds.push({ ...round, runId: detail.runId, segment: i + 1 });
        }
        loop.rounds.sort((a, b) => a.iteration - b.iteration);
      }
    });

    let source: WorkflowLoopsResponse['source'] = 'history';
    const last = runs[runs.length - 1];
    if (last.detail.status === 'Running') {
      const state = readLoopState(await this.queryLoopState(last.detail));
      if (state) {
        source = 'query';
        const segment = runs.length;
        for (const entry of state.loops) {
          let loop = loops.find(l => l.name === entry.name);
          if (!loop) {
            loop = {
              name: entry.name,
              status: 'running',
              iteration: 0,
              rounds: [],
            };
            loops.push(loop);
          }
          if (entry.status) loop.status = entry.status;
          if (entry.iteration !== undefined) loop.iteration = entry.iteration;
          if (entry.maxIterations) loop.maxIterations = entry.maxIterations;
          if (entry.decision !== undefined) loop.decision = entry.decision;
          if (entry.score !== undefined) loop.score = entry.score;
          for (const r of entry.rounds ?? []) {
            let round = loop.rounds.find(x => x.iteration === r.iteration);
            if (!round) {
              // Started, but no step scheduled yet.
              round = {
                iteration: r.iteration,
                status: 'Running',
                steps: [],
                startTime: r.startTime,
                runId: last.detail.runId,
                segment,
              };
              loop.rounds.push(round);
            }
            if (r.decision !== undefined) round.decision = r.decision;
            if (r.score !== undefined) round.score = r.score;
            if (r.status === 'running' && round.status === 'Completed') {
              round.status = 'Running';
              delete round.endTime;
            }
            if (r.status === 'failed') round.status = 'Failed';
          }
          loop.rounds.sort((a, b) => a.iteration - b.iteration);
        }
      }
    }

    const runList: WorkflowLoopRun[] = runs.map(({ detail }, i) => {
      const run: WorkflowLoopRun = {
        runId: detail.runId,
        segment: i + 1,
        status: detail.status,
      };
      if (detail.startTime) run.startTime = detail.startTime;
      return run;
    });
    return { loops, runs: runList, source, truncated };
  }

  /**
   * The answer of the `__loop_state` query, or undefined when the workflow
   * has no such query, no worker answers in time or the answer cannot be
   * decoded.
   */
  private async queryLoopState(workflow: WorkflowDetail): Promise<unknown> {
    try {
      const response = await this.temporalReads.query(
        workflow,
        LOOP_STATE_QUERY,
        { timeoutMs: LOOP_QUERY_TIMEOUT_MS },
      );
      if (response.rejected) return undefined;
      const decoded = decodePayloads(response.result);
      const value =
        decoded && typeof decoded === 'object' && 'value' in decoded
          ? (decoded as { value: unknown }).value
          : undefined;
      return value;
    } catch (error) {
      this.logger.debug(`Loop state query failed: ${error}`);
      return undefined;
    }
  }

  /**
   * The full record of one model call (activity ID `llm/...`) of a run,
   * by the event ID of its `ActivityTaskScheduled` event. A record stored
   * in S3 is downloaded and verified, up to {@link MAX_LLM_RECORD_BYTES}.
   */
  async llmCall(
    workflow: WorkflowDetail,
    scheduledEventId: string,
  ): Promise<WorkflowLlmCallResponse> {
    this.assertAiWorkflows();
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    const { events } = await this.queries.readEvents(ref, MAX_STEP_EVENTS);
    const graph = buildWorkflowGraph(events, {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      status: workflow.status,
      truncated: false,
      pendingActivities: workflow.pendingActivities,
      includePayloads: false,
    });
    const nodeId = `activity-${scheduledEventId}`;
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node?.llm) {
      throw new NotFoundError(`No model call ${scheduledEventId} in this run`);
    }
    // The result, else the failure details of the last failed attempt.
    let root: unknown;
    let fromFailure = false;
    for (const event of events as any[]) {
      const completed = event.activityTaskCompletedEventAttributes;
      if (
        completed &&
        String(completed.scheduledEventId) === scheduledEventId
      ) {
        root = completed.result;
        fromFailure = false;
      }
      for (const key of [
        'activityTaskFailedEventAttributes',
        'activityTaskTimedOutEventAttributes',
      ]) {
        const closed = event[key];
        if (closed && String(closed.scheduledEventId) === scheduledEventId) {
          root = closed.failure;
          fromFailure = true;
        }
      }
      const started = event.activityTaskStartedEventAttributes;
      if (
        started &&
        String(started.scheduledEventId) === scheduledEventId &&
        started.lastFailure &&
        root === undefined
      ) {
        root = started.lastFailure;
        fromFailure = true;
      }
    }
    const response: WorkflowLlmCallResponse = {
      nodeId,
      activityId: node.stepId ?? '',
      activityType: node.name,
      call: node.llm.call,
      status: node.status,
    };
    if (root === undefined) {
      response.unavailable =
        node.llm.record === 'pending'
          ? 'The model call has not ended yet.'
          : 'The model call has no result.';
      return response;
    }
    await this.queries.payloads.resolve(root, {
      maxInlineBytes: MAX_LLM_RECORD_BYTES,
    });
    const found = findLlmRecord(root);
    if (found.external) response.external = found.external;
    if (!found.record) {
      response.unavailable = found.reason;
      return response;
    }
    response.raw = found.record;
    response.record = normalizeLlmRecord(found.record);
    if (fromFailure) response.fromFailure = true;
    return response;
  }
}
