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

import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import { LoggerService } from '@backstage/backend-plugin-api';
import {
  InvalidTemporalAnnotationError,
  InvalidTemporalWorkflowSpecError,
  isTemporalWorkflowEntity,
  getTemporalWorkflowSource,
  parseTemporalWorkflowSpec,
  TemporalAnnotations,
} from '../common';
import { TemporalService } from '../node';
import type { TemporalEntityContext } from '../node/alpha';
import { EntityWorkflowFilter, RelatedWorkflowSource } from './query';

/**
 * Reads the workflow filter of an entity: the spec of a `TemporalWorkflow`
 * entity, the annotations of any other entity.
 */
export function readEntityWorkflowFilter(entity: Entity): TemporalAnnotations {
  try {
    return getTemporalWorkflowSource(entity);
  } catch (error) {
    if (
      error instanceof InvalidTemporalAnnotationError ||
      error instanceof InvalidTemporalWorkflowSpecError
    ) {
      throw new InputError(error.message);
    }
    throw error;
  }
}

/**
 * The workflow sources of entities: validates their annotations (or
 * `TemporalWorkflow` spec), resolves their namespace and builds the search
 * filter of their workflows. The other query classes build on it.
 */
export class EntityWorkflowSources {
  constructor(
    private readonly temporal: TemporalService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Validates the entity's annotations (or `TemporalWorkflow` spec) and
   * resolves its namespace. `relatedEntities` are the `TemporalWorkflow`
   * entities it depends on that the caller may see.
   */
  entityContext(
    entity: Entity,
    relatedEntities: Entity[] = [],
  ): TemporalEntityContext {
    const annotations = readEntityWorkflowFilter(entity);
    const namespace =
      annotations.namespace ?? this.temporal.getDefaultNamespace();
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    return {
      entity,
      entityRef: stringifyEntityRef(entity),
      namespace,
      relatedWorkflowEntities: relatedEntities,
    };
  }

  private readonly filters = new WeakMap<
    TemporalEntityContext,
    EntityWorkflowFilter
  >();

  /**
   * The search filter of an entity's workflows: its annotations (or spec),
   * and the related `TemporalWorkflow` entities in the same namespace. The
   * ones in another namespace or with an invalid spec are left out.
   */
  filterOf(context: TemporalEntityContext): EntityWorkflowFilter {
    const cached = this.filters.get(context);
    if (cached) return cached;
    const { entity, entityRef, namespace } = context;
    const related: RelatedWorkflowSource[] = [];
    for (const relatedEntity of context.relatedWorkflowEntities) {
      const relatedRef = stringifyEntityRef(relatedEntity);
      if (
        !isTemporalWorkflowEntity(relatedEntity) ||
        relatedRef === entityRef
      ) {
        continue;
      }
      let spec;
      try {
        spec = parseTemporalWorkflowSpec(relatedEntity);
      } catch (error) {
        this.logger.warn(`Skipping ${relatedRef}: ${error}`);
        continue;
      }
      const relatedNamespace =
        spec.namespace ?? this.temporal.getDefaultNamespace();
      if (relatedNamespace !== namespace) {
        this.logger.debug(
          `Skipping ${relatedRef}: namespace ${relatedNamespace} differs from ${namespace}`,
        );
        continue;
      }
      related.push({
        entityRef: relatedRef,
        taskQueue: spec.taskQueue,
        workflowTypes: spec.workflowTypes,
      });
    }
    const filter: EntityWorkflowFilter = {
      annotations: readEntityWorkflowFilter(entity),
      entityRef,
      entityRefAttribute: this.temporal.getSearchAttributeNames().entityRef,
      related,
    };
    this.filters.set(context, filter);
    return filter;
  }

  /**
   * The workflow types and task queues of an entity: its own and those of
   * the related entities in its namespace.
   */
  workflowSourcesOf(
    context: TemporalEntityContext,
  ): { taskQueue?: string; workflowTypes: string[] }[] {
    const filter = this.filterOf(context);
    return [filter.annotations, ...(filter.related ?? [])]
      .map(s => ({ taskQueue: s.taskQueue, workflowTypes: s.workflowTypes }))
      .filter(s => s.workflowTypes.length > 0);
  }

  defaultNamespace(): string {
    return this.temporal.getDefaultNamespace();
  }

  checkNamespace(namespace: string) {
    if (!this.temporal.isNamespaceAllowed(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
  }
}
