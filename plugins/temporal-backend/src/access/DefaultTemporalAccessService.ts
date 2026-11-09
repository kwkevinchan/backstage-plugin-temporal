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
  PermissionsService,
} from '@backstage/backend-plugin-api';
import {
  Entity,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { CatalogService } from '@backstage/plugin-catalog-node';
import {
  AuthorizeResult,
  BasicPermission,
  ResourcePermission,
} from '@backstage/plugin-permission-common';
import {
  getDependsOnTemporalWorkflowRefs,
  isTemporalWorkflowEntity,
  parseTemporalWorkflowSpec,
  temporalWorkflowHistoryListPermission,
  temporalWorkflowHistoryReadPermission,
  temporalWorkflowListPermission,
  temporalWorkflowReadPermission,
  TEMPORAL_WORKFLOW_KIND,
  WorkflowDetail,
  WorkflowRef,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { EntityContext, WorkflowQueries } from '../services/WorkflowQueries';

/** Most `TemporalWorkflow` entities of one entity that are queried. */
export const MAX_RELATED_WORKFLOW_ENTITIES = 20;

/** `read` for details and the step graph, `history` for history, inputs and results. */
export type WorkflowAccessLevel = 'read' | 'history';

/** A workflow that passed the access checks, with the entity it is shown for. */
export interface AccessibleWorkflow {
  /** Undefined when opened from the Workflows page with the list permissions. */
  context?: EntityContext;
  workflow: WorkflowDetail;
}

/**
 * Who may see and change which workflows. Every route goes through here
 * before it reads or changes a workflow: the permission framework decides,
 * and entities are read from the catalog with the caller's credentials.
 */
export class DefaultTemporalAccessService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly catalog: CatalogService,
    private readonly queries: WorkflowQueries,
  ) {}

  private async isAllowed(
    permission: BasicPermission,
    credentials: BackstageCredentials,
  ): Promise<boolean> {
    const [decision] = await this.permissions.authorize([{ permission }], {
      credentials,
    });
    return decision.result === AuthorizeResult.ALLOW;
  }

  /** True when the caller has the permission on the entity. */
  async isAllowedOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string,
    credentials: BackstageCredentials,
  ): Promise<boolean> {
    const [decision] = await this.permissions.authorize(
      [{ permission, resourceRef: entityRef }],
      { credentials },
    );
    return decision.result === AuthorizeResult.ALLOW;
  }

  /** True when the caller may list and open every workflow. */
  async canListAll(credentials: BackstageCredentials): Promise<boolean> {
    return this.isAllowed(temporalWorkflowListPermission, credentials);
  }

  /**
   * True when the caller may see the inputs and results of a workflow: the
   * history permission on its entity, or the history list permission for a
   * workflow opened without one.
   */
  async canReadPayloads(
    access: AccessibleWorkflow,
    credentials: BackstageCredentials,
  ): Promise<boolean> {
    return access.context
      ? this.isAllowedOn(
          temporalWorkflowHistoryReadPermission,
          access.context.entityRef,
          credentials,
        )
      : this.isAllowed(temporalWorkflowHistoryListPermission, credentials);
  }

  /**
   * Checks a permission on an entity, or, for a workflow without an entity,
   * that the policy allows it for every entity (an unconditional ALLOW).
   * Throws NotAllowedError otherwise.
   */
  async authorizeOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<void> {
    const [decision] = entityRef
      ? await this.permissions.authorize(
          [{ permission, resourceRef: entityRef }],
          { credentials },
        )
      : await this.permissions.authorizeConditional([{ permission }], {
          credentials,
        });
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError();
    }
  }

  /** Permission first, then the entity, read with the caller's credentials. */
  async loadEntity(
    entityRef: string,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<EntityContext> {
    await this.authorizeOn(permission, entityRef, credentials);
    const entity = await this.catalog.getEntityByRef(entityRef, {
      credentials,
    });
    if (!entity) {
      throw new NotFoundError(`No entity ${entityRef}`);
    }
    const related = await this.loadRelatedWorkflowEntities(
      entity,
      permission,
      credentials,
    );
    return this.queries.entityContext(entity, related);
  }

  /**
   * Loads a workflow and the entity it is shown for, with all checks.
   * `entityRef` is the entity the caller opened the workflow from, if any.
   */
  async loadWorkflow(
    ref: WorkflowRef,
    options: {
      entityRef?: string;
      level: WorkflowAccessLevel;
      credentials: BackstageCredentials;
    },
  ): Promise<AccessibleWorkflow> {
    const { level, credentials } = options;
    this.queries.checkNamespace(ref.namespace);
    const permission =
      level === 'history'
        ? temporalWorkflowHistoryReadPermission
        : temporalWorkflowReadPermission;
    let entityRef = options.entityRef;
    let workflow: WorkflowDetail | undefined;
    if (
      !entityRef &&
      (await this.canListAll(credentials)) &&
      (level === 'read' ||
        (await this.isAllowed(
          temporalWorkflowHistoryListPermission,
          credentials,
        )))
    ) {
      // Opened from the Workflows page: the list permission covers every
      // workflow of the allowed namespaces, the history list permission
      // their history.
      return { workflow: await this.queries.describe(ref) };
    }
    if (!entityRef) {
      // Without an entity in the request, the workflow's entity reference
      // search attribute decides which entity the permission is checked on.
      workflow = await this.queries.describe(ref);
      if (!workflow.entityRef) {
        throw new NotAllowedError(
          'The workflow is not linked to a catalog entity; pass entityRef',
        );
      }
      entityRef = normalizeEntityRef(workflow.entityRef);
    }
    const context = await this.loadEntity(entityRef, permission, credentials);
    workflow ??= await this.queries.describe(ref);
    this.queries.assertBelongs(workflow, context);
    return { context, workflow };
  }

  /**
   * Adds `workflowEntityRef` to runs that match a `TemporalWorkflow` entity
   * the caller can see (same namespace, workflow type and task queue).
   */
  async linkWorkflowEntities(
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
        if ((spec.namespace ?? this.queries.defaultNamespace()) !== namespace) {
          return [];
        }
        return [{ ref: stringifyEntityRef(entity), spec }];
      } catch {
        return [];
      }
    });
    return items.map(item => {
      const match = sources.find(
        ({ spec }) =>
          spec.workflowTypes.includes(item.workflowType) &&
          (!spec.taskQueue || spec.taskQueue === item.taskQueue),
      );
      return match ? { ...item, workflowEntityRef: match.ref } : item;
    });
  }

  /**
   * The `TemporalWorkflow` entities that an entity depends on and that the
   * caller has the same permission on. The others are left out.
   */
  private async loadRelatedWorkflowEntities(
    entity: Entity,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<Entity[]> {
    if (isTemporalWorkflowEntity(entity)) return [];
    const refs = getDependsOnTemporalWorkflowRefs(entity).slice(
      0,
      MAX_RELATED_WORKFLOW_ENTITIES,
    );
    if (refs.length === 0) return [];
    const decisions = await this.permissions.authorize(
      refs.map(resourceRef => ({ permission, resourceRef })),
      { credentials },
    );
    const allowed = refs.filter(
      (_, i) => decisions[i]?.result === AuthorizeResult.ALLOW,
    );
    if (allowed.length === 0) return [];
    const { items } = await this.catalog.getEntitiesByRefs(
      { entityRefs: allowed },
      { credentials },
    );
    return items.filter((e): e is Entity => Boolean(e));
  }
}

/** An entity reference in its canonical form. */
export function normalizeEntityRef(raw: string): string {
  try {
    return stringifyEntityRef(parseEntityRef(raw));
  } catch {
    throw new InputError('Invalid entityRef');
  }
}
