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
  PermissionCriteria,
  PolicyDecision,
  ResourcePermission,
} from '@backstage/plugin-permission-common';
import {
  createConditionAuthorizer,
  createConditionTransformer,
  isAndCriteria,
  isNotCriteria,
  isOrCriteria,
  PermissionRuleset,
} from '@backstage/plugin-permission-node';
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
import {
  TemporalAccessibleWorkflow,
  TemporalAccessService,
  TemporalEntityContext,
  TemporalWorkflowAccessLevel,
  TemporalWorkflowQuery,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import { WorkflowQueries } from '../services/WorkflowQueries';

/** Most `TemporalWorkflow` entities of one entity that are queried. */
export const MAX_RELATED_WORKFLOW_ENTITIES = 20;

/** The rules of the `temporal-workflow` resource type. */
export type TemporalWorkflowRuleset = PermissionRuleset<
  WorkflowSummary,
  TemporalWorkflowQuery,
  'temporal-workflow'
>;

/**
 * Turns the conditions of a decision into a visibility query: `allOf` with
 * AND, `anyOf` with OR. Temporal's query language has no general NOT, so a
 * `not` condition is refused.
 */
export function criteriaToVisibilityQuery(
  criteria: PermissionCriteria<TemporalWorkflowQuery>,
): TemporalWorkflowQuery {
  if (isAndCriteria(criteria)) {
    return criteria.allOf
      .map(c => `(${criteriaToVisibilityQuery(c)})`)
      .join(' AND ');
  }
  if (isOrCriteria(criteria)) {
    return criteria.anyOf
      .map(c => `(${criteriaToVisibilityQuery(c)})`)
      .join(' OR ');
  }
  if (isNotCriteria(criteria)) {
    throw new NotAllowedError(
      'A "not" condition cannot be applied to the workflow list',
    );
  }
  return criteria;
}

/**
 * Who may see and change which workflows. Every route goes through here
 * before it reads or changes a workflow: the permission framework decides,
 * and entities are read from the catalog with the caller's credentials.
 */
export class DefaultTemporalAccessService implements TemporalAccessService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly catalog: CatalogService,
    private readonly queries: WorkflowQueries,
    /** The rules of `temporal-workflow`, read when a decision needs them. */
    private readonly workflowRules: () => TemporalWorkflowRuleset,
  ) {}

  private async listDecision(
    permission:
      | typeof temporalWorkflowListPermission
      | typeof temporalWorkflowHistoryListPermission,
    credentials: BackstageCredentials,
  ): Promise<PolicyDecision> {
    const [decision] = await this.permissions.authorizeConditional(
      [{ permission }],
      { credentials },
    );
    return decision;
  }

  /** True when a `temporal-workflow` permission allows this workflow. */
  private async allowsWorkflow(
    permission:
      | typeof temporalWorkflowListPermission
      | typeof temporalWorkflowHistoryListPermission,
    workflow: WorkflowSummary,
    credentials: BackstageCredentials,
  ): Promise<boolean> {
    const decision = await this.listDecision(permission, credentials);
    if (decision.result !== AuthorizeResult.CONDITIONAL) {
      return decision.result === AuthorizeResult.ALLOW;
    }
    try {
      return createConditionAuthorizer(this.workflowRules())(
        decision,
        workflow,
      );
    } catch {
      // A condition with an unknown rule allows nothing.
      return false;
    }
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

  async canListAll(credentials: BackstageCredentials): Promise<boolean> {
    const decision = await this.listDecision(
      temporalWorkflowListPermission,
      credentials,
    );
    return decision.result === AuthorizeResult.ALLOW;
  }

  async authorizeWorkflowList(
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<TemporalWorkflowQuery | undefined> {
    const decision = await this.listDecision(
      temporalWorkflowListPermission,
      credentials,
    );
    if (decision.result === AuthorizeResult.DENY) throw new NotAllowedError();
    // After the permission, so a denied caller cannot probe which
    // namespaces are allowed.
    this.queries.checkNamespace(namespace);
    if (decision.result !== AuthorizeResult.CONDITIONAL) return undefined;
    let criteria: PermissionCriteria<TemporalWorkflowQuery>;
    try {
      criteria = createConditionTransformer(this.workflowRules())(
        decision.conditions,
      );
    } catch (error) {
      throw new NotAllowedError(
        `The workflow list conditions cannot be applied: ${error}`,
      );
    }
    return criteriaToVisibilityQuery(criteria);
  }

  /**
   * True when the caller may see the inputs and results of a workflow: the
   * history permission on its entity, or the history list permission for a
   * workflow opened without one.
   */
  async canReadPayloads(
    access: TemporalAccessibleWorkflow,
    credentials: BackstageCredentials,
  ): Promise<boolean> {
    return access.context
      ? this.isAllowedOn(
          temporalWorkflowHistoryReadPermission,
          access.context.entityRef,
          credentials,
        )
      : this.allowsWorkflow(
          temporalWorkflowHistoryListPermission,
          access.workflow,
          credentials,
        );
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
  ): Promise<TemporalEntityContext> {
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
      level: TemporalWorkflowAccessLevel;
      credentials: BackstageCredentials;
    },
  ): Promise<TemporalAccessibleWorkflow> {
    const { level, credentials } = options;
    this.queries.checkNamespace(ref.namespace);
    const permission =
      level === 'history'
        ? temporalWorkflowHistoryReadPermission
        : temporalWorkflowReadPermission;
    let entityRef = options.entityRef;
    let workflow: WorkflowDetail | undefined;
    if (!entityRef) {
      workflow = await this.queries.describe(ref);
      if (
        (await this.allowsWorkflow(
          temporalWorkflowListPermission,
          workflow,
          credentials,
        )) &&
        (level === 'read' ||
          (await this.allowsWorkflow(
            temporalWorkflowHistoryListPermission,
            workflow,
            credentials,
          )))
      ) {
        // Opened from the Workflows page: the list permission covers the
        // workflows it allows, the history list permission their history.
        return { workflow };
      }
      // Otherwise the workflow's entity reference search attribute decides
      // which entity the permission is checked on.
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
