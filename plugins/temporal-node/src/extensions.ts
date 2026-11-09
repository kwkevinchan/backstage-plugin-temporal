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

import {
  BackstageCredentials,
  createExtensionPoint,
} from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { WorkflowSummary } from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * Context passed to a {@link TemporalWorkflowEnricher}.
 *
 * @public
 */
export interface TemporalWorkflowEnricherContext {
  /**
   * The entity whose workflows are shown. Enrichers should handle it being
   * undefined: lists that span entities (the Workflows page) may run
   * enrichers without one in a later version.
   */
  entity?: Entity;
  namespace: string;
  credentials: BackstageCredentials;
}

/**
 * Adds data to workflow summaries before they are returned to the frontend.
 * Enrichers run in the order they were added, on list results and on the
 * workflow details. Put added data under `extensions[id]`.
 *
 * @public
 */
export interface TemporalWorkflowEnricher {
  id: string;
  enrich(
    items: WorkflowSummary[],
    context: TemporalWorkflowEnricherContext,
  ): Promise<WorkflowSummary[]>;
}

/**
 * Extension point of the Temporal backend plugin.
 *
 * @public
 */
export interface TemporalExtensionPoint {
  addWorkflowEnricher(enricher: TemporalWorkflowEnricher): void;
}

/**
 * Extension point of the Temporal backend plugin.
 *
 * @public
 */
export const temporalExtensionPoint =
  createExtensionPoint<TemporalExtensionPoint>({
    id: 'temporal.extensions',
  });
