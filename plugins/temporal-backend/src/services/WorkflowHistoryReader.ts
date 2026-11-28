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
import { WorkflowDetail, WorkflowRunRef } from '../common';
import { CLOSED_WITH_FAILURE } from '../common/stepRules';
import type { TemporalReadRepository } from '../repositories/TemporalReadRepository';
import { EntityWorkflowSources } from './EntityWorkflowSources';

export const HISTORY_PAGE_SIZE = { default: 100, max: 500 };
/** Most history pages read for one run, whatever the pages hold. */
export const MAX_HISTORY_PAGES = 100;
/** Most history events read to build the steps of one run. */
export const MAX_STEP_EVENTS = 5000;

/**
 * Close events read when a run was described, keyed by its `WorkflowDetail`.
 * Module-scoped so that a detail described by the `WorkflowQueries` of
 * `temporalAccessServiceRef` is reused by the plugin's own classes when
 * they read a cut history, without adding internal fields to
 * `WorkflowDetail`.
 */
const describedCloseEvents = new WeakMap<WorkflowDetail, unknown>();

/** Keeps the close event that was read with `workflow`. */
export function keepCloseEvent(workflow: WorkflowDetail, closeEvent: unknown) {
  describedCloseEvents.set(workflow, closeEvent);
}

/** The events the steps of a run are read from. */
export interface StepEvents {
  /** Protobuf JSON, oldest first. */
  events: unknown[];
  /** True when the history has more events than were read. */
  truncated: boolean;
  /** The close event of a failed run whose history was cut before it. */
  closeEvent?: unknown;
}

/**
 * Reads the history of a run for the use cases that build on its events:
 * the graph, the progress of a run in a list and the model calls.
 */
export class WorkflowHistoryReader {
  constructor(
    private readonly sources: EntityWorkflowSources,
    private readonly temporalReads: TemporalReadRepository,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Reads the history of one run, oldest first, up to `max` events.
   */
  async readEvents(
    ref: WorkflowRunRef,
    max: number,
  ): Promise<{ events: unknown[]; truncated: boolean }> {
    this.sources.checkNamespace(ref.namespace);
    const events: unknown[] = [];
    let nextPageToken: Uint8Array | undefined;
    let pages = 0;
    do {
      const response = await this.temporalReads.historyPage(ref, {
        pageSize: Math.min(HISTORY_PAGE_SIZE.max, max - events.length),
        nextPageToken,
      });
      events.push(...response.items);
      nextPageToken = response.nextPageToken;
      pages += 1;
      // A server that keeps returning a token with empty pages ends here.
    } while (nextPageToken && events.length < max && pages < MAX_HISTORY_PAGES);
    return {
      events: events.slice(0, max),
      truncated: Boolean(nextPageToken) || events.length > max,
    };
  }

  /**
   * The first `maxEvents` events of a run, for its steps. A cut history
   * misses the close event, whose failure tells the step the run failed at:
   * it is read too, unless it was kept when the run was described.
   */
  async readStepEvents(
    workflow: WorkflowDetail,
    maxEvents = MAX_STEP_EVENTS,
  ): Promise<StepEvents> {
    const ref = {
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId: workflow.runId,
    };
    const { events, truncated } = await this.readEvents(ref, maxEvents);
    let closeEvent: unknown;
    if (truncated && CLOSED_WITH_FAILURE.includes(workflow.status)) {
      closeEvent = describedCloseEvents.has(workflow)
        ? describedCloseEvents.get(workflow)
        : await this.closeEventOrUndefined(ref);
    }
    return { events, truncated, closeEvent };
  }

  /** The close event of a run; undefined when reading it fails. */
  private async closeEventOrUndefined(ref: WorkflowRunRef): Promise<unknown> {
    try {
      return await this.temporalReads.closeEvent(ref);
    } catch (error) {
      this.logger
        .child({
          namespace: ref.namespace,
          workflowId: ref.workflowId,
          runId: ref.runId,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .debug('The close event of a run could not be read');
      return undefined;
    }
  }
}
