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
  LoggerService,
} from '@backstage/backend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { CatalogService } from '@backstage/plugin-catalog-node';
import {
  parseTemporalWorkflowSpec,
  TEMPORAL_WORKFLOW_KIND,
  WorkflowSummary,
} from '../common';
import {
  EntityWorkflowSources,
  logSkippedWorkflowEntity,
} from '../services/EntityWorkflowSources';

/**
 * Finds the `TemporalWorkflow` entity that describes the workflow type of a
 * run, with the caller's catalog credentials. It is only for showing a link:
 * no permission check uses it.
 */
export class WorkflowTypeEntities {
  constructor(
    private readonly catalog: CatalogService,
    private readonly sources: EntityWorkflowSources,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Adds `workflowTypeEntityRef` to runs that match a `TemporalWorkflow`
   * entity the caller can see (same namespace, workflow type and task
   * queue). When several entities match, the ones with the run's task queue
   * win over the ones without a task queue; if more than one is left at that
   * level, the run gets no reference.
   */
  async link(
    items: WorkflowSummary[],
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<WorkflowSummary[]> {
    const types = [...new Set(items.map(i => i.workflowType))].filter(Boolean);
    if (types.length === 0) return items;
    const { items: entities } = await this.catalog.getEntities(
      {
        filter: { kind: TEMPORAL_WORKFLOW_KIND, 'spec.workflowType': types },
        fields: ['kind', 'metadata.namespace', 'metadata.name', 'spec'],
      },
      { credentials },
    );
    const sources = entities.flatMap(entity => {
      try {
        const spec = parseTemporalWorkflowSpec(entity);
        if ((spec.namespace ?? this.sources.defaultNamespace()) !== namespace) {
          return [];
        }
        return [{ ref: stringifyEntityRef(entity), spec }];
      } catch (error) {
        logSkippedWorkflowEntity(
          this.logger,
          stringifyEntityRef(entity),
          error,
        );
        return [];
      }
    });
    return items.map(item => {
      const matches = sources.filter(
        ({ spec }) =>
          spec.workflowTypes.includes(item.workflowType) &&
          (!spec.taskQueue || spec.taskQueue === item.taskQueue),
      );
      const exact = matches.filter(({ spec }) => spec.taskQueue);
      const level = exact.length > 0 ? exact : matches;
      return level.length === 1
        ? { ...item, workflowTypeEntityRef: level[0].ref }
        : item;
    });
  }
}
