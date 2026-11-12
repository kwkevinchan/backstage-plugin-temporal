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
  Entity,
  entityKindSchemaValidator,
  getCompoundEntityRef,
  parseEntityRef,
  RELATION_DEPENDENCY_OF,
  RELATION_DEPENDS_ON,
  RELATION_HAS_PART,
  RELATION_OWNED_BY,
  RELATION_OWNER_OF,
  RELATION_PART_OF,
} from '@backstage/catalog-model';
import type { LocationSpec } from '@backstage/plugin-catalog-node';
import {
  CatalogProcessor,
  CatalogProcessorEmit,
  processingResult,
} from '@backstage/plugin-catalog-node';
import {
  isTemporalWorkflowEntity,
  TEMPORAL_WORKFLOW_API_VERSION,
  TemporalWorkflowEntityV1alpha1,
  temporalWorkflowEntityV1alpha1Schema,
} from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * Catalog processor for the `TemporalWorkflow` kind
 * (`temporal.io/v1alpha1`). It validates the spec against the JSON schema
 * and emits the `ownedBy`/`ownerOf`, `partOf`/`hasPart` (system) and
 * `dependsOn`/`dependencyOf` relations.
 *
 * @public
 */
export class TemporalWorkflowEntityProcessor implements CatalogProcessor {
  readonly #validate = entityKindSchemaValidator(
    temporalWorkflowEntityV1alpha1Schema,
  );

  getProcessorName(): string {
    return 'TemporalWorkflowEntityProcessor';
  }

  /**
   * True for valid `TemporalWorkflow` entities, false for other kinds.
   * Throws with the schema errors for an invalid `TemporalWorkflow`.
   */
  async validateEntityKind(entity: Entity): Promise<boolean> {
    return this.#validate(entity) !== false;
  }

  async postProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    emit: CatalogProcessorEmit,
  ): Promise<Entity> {
    if (
      !isTemporalWorkflowEntity(entity) ||
      entity.apiVersion !== TEMPORAL_WORKFLOW_API_VERSION
    ) {
      return entity;
    }
    const workflow = entity as TemporalWorkflowEntityV1alpha1;
    const selfRef = getCompoundEntityRef(workflow);

    const emitBoth = (
      targets: string | string[] | undefined,
      defaultKind: string | undefined,
      outgoing: string,
      incoming: string,
    ) => {
      if (!targets) return;
      for (const target of [targets].flat()) {
        const targetRef = parseEntityRef(target, {
          defaultKind,
          defaultNamespace: selfRef.namespace,
        });
        const compound = {
          kind: targetRef.kind,
          namespace: targetRef.namespace,
          name: targetRef.name,
        };
        emit(
          processingResult.relation({
            source: selfRef,
            type: outgoing,
            target: compound,
          }),
        );
        emit(
          processingResult.relation({
            source: compound,
            type: incoming,
            target: selfRef,
          }),
        );
      }
    };

    emitBoth(
      workflow.spec.owner,
      'Group',
      RELATION_OWNED_BY,
      RELATION_OWNER_OF,
    );
    emitBoth(
      workflow.spec.system,
      'System',
      RELATION_PART_OF,
      RELATION_HAS_PART,
    );
    emitBoth(
      workflow.spec.dependsOn,
      undefined,
      RELATION_DEPENDS_ON,
      RELATION_DEPENDENCY_OF,
    );
    return entity;
  }
}
