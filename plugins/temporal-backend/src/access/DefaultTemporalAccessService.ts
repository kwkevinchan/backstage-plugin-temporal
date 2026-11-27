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
  RelatedWorkflows,
  temporalWorkflowListPermission,
  temporalWorkflowReadPermission,
  TEMPORAL_WORKFLOW_KIND,
  WorkflowRunRef,
  WorkflowSummary,
} from '../common';
import {
  TemporalAccessibleWorkflow,
  TemporalAccessService,
  TemporalEntityContext,
  TemporalWorkflowEntityLoadResult,
  TemporalWorkflowFilter,
} from '../node/alpha';
import {
  inCondition,
  isValidEntityRefValue,
  validatePermissionVisibilityQuery,
} from '../services/visibilityQuery';
import {
  EntityWorkflowSources,
  logSkippedWorkflowEntity,
} from '../services/EntityWorkflowSources';
import { WorkflowQueries } from '../services/WorkflowQueries';

/** Most `TemporalWorkflow` entities of one entity that are queried. */
export const MAX_RELATED_WORKFLOW_ENTITIES = 20;

/** The rules of the `temporal-workflow` resource type. */
export type TemporalWorkflowRuleset = PermissionRuleset<
  WorkflowSummary,
  TemporalWorkflowFilter,
  'temporal-workflow'
>;

/** What the conditions of a list are decided against. */
export interface WorkflowListScope {
  /** The namespace being listed. */
  namespace: string;
  /** The search attribute of `temporal.searchAttributes.initiator`. */
  initiatorAttribute?: string;
}

/**
 * Turns the conditions of a decision into a visibility query for the
 * namespace being listed: `allOf` with AND, `anyOf` with OR. Conditions on
 * the namespace, and on the initiator without its search attribute, are
 * decided here and become `true` or `false`. Temporal's visibility query
 * language has no general NOT, so a `not` condition is refused unless it is
 * decided here.
 */
export function criteriaToVisibilityQuery(
  criteria: PermissionCriteria<TemporalWorkflowFilter>,
  scope: WorkflowListScope,
): string | boolean {
  if (isAndCriteria(criteria) || isOrCriteria(criteria)) {
    const and = isAndCriteria(criteria);
    const parts = (and ? criteria.allOf : criteria.anyOf).map(c =>
      criteriaToVisibilityQuery(c, scope),
    );
    // false decides AND, true decides OR; the other one drops out.
    if (parts.includes(!and)) return !and;
    const visibilityQueries = parts.filter(
      (p): p is string => typeof p === 'string',
    );
    if (visibilityQueries.length === 0) return and;
    return visibilityQueries.map(q => `(${q})`).join(and ? ' AND ' : ' OR ');
  }
  if (isNotCriteria(criteria)) {
    const inner = criteriaToVisibilityQuery(criteria.not, scope);
    if (typeof inner === 'boolean') return !inner;
    throw new NotAllowedError(
      'A "not" condition cannot be applied to the workflow list',
    );
  }
  if (typeof criteria === 'string') {
    return validatePermissionVisibilityQuery(criteria);
  }
  if ('namespaces' in criteria) {
    return criteria.namespaces.includes(scope.namespace);
  }
  if (!scope.initiatorAttribute) return false;
  return inCondition(
    scope.initiatorAttribute,
    criteria.initiators,
    isValidEntityRefValue,
  );
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
    private readonly sources: EntityWorkflowSources,
    private readonly queries: WorkflowQueries,
    /** The rules of `temporal-workflow`, read when a decision needs them. */
    private readonly workflowRules: () => TemporalWorkflowRuleset,
    private readonly logger: LoggerService,
    private readonly options: { initiatorAttribute?: string } = {},
  ) {}

  private async listDecision(
    credentials: BackstageCredentials,
  ): Promise<PolicyDecision> {
    const [decision] = await this.permissions.authorizeConditional(
      [{ permission: temporalWorkflowListPermission }],
      { credentials },
    );
    return decision;
  }

  /** True when a decision of a `temporal-workflow` permission allows it. */
  private decisionAllows(
    decision: PolicyDecision,
    workflow: WorkflowSummary,
    permissionName: string,
  ): boolean {
    if (decision.result !== AuthorizeResult.CONDITIONAL) {
      return decision.result === AuthorizeResult.ALLOW;
    }
    try {
      return createConditionAuthorizer(this.workflowRules())(
        decision,
        workflow,
      );
    } catch (error) {
      // A condition with an unknown rule allows nothing. The policy is at
      // fault, which the caller cannot tell from a refusal: the log can.
      this.logger
        .child({
          permission: permissionName,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .warn('A permission condition cannot be applied, so it allows nothing');
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
    const decision = await this.listDecision(credentials);
    return decision.result === AuthorizeResult.ALLOW;
  }

  async authorizeWorkflowList(
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<string | undefined> {
    const decision = await this.listDecision(credentials);
    if (decision.result === AuthorizeResult.DENY) throw new NotAllowedError();
    // After the permission, so a denied caller cannot probe which
    // namespaces are allowed.
    this.sources.checkNamespace(namespace);
    if (decision.result !== AuthorizeResult.CONDITIONAL) return undefined;
    // A condition the plugin cannot apply is a policy problem, not a bad
    // request: it allows nothing.
    let visibilityQuery: string | boolean;
    try {
      const criteria: PermissionCriteria<TemporalWorkflowFilter> =
        createConditionTransformer(this.workflowRules())(decision.conditions);
      visibilityQuery = criteriaToVisibilityQuery(criteria, {
        namespace,
        initiatorAttribute: this.options.initiatorAttribute,
      });
    } catch (error) {
      if (error instanceof NotAllowedError) throw error;
      this.logger
        .child({
          permission: temporalWorkflowListPermission.name,
          errorName: error instanceof Error ? error.name : 'Error',
        })
        .warn(
          'A permission condition cannot be applied, so the list shows nothing',
          error instanceof Error ? error : undefined,
        );
      throw new NotAllowedError(
        'The workflow list conditions cannot be applied',
      );
    }
    if (visibilityQuery === false) {
      throw new NotAllowedError(
        `The policy allows no workflows of namespace ${namespace}`,
      );
    }
    return visibilityQuery === true ? undefined : visibilityQuery;
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
    return this.sources.entityContext(
      entity,
      related.entities,
      related.relatedWorkflows,
    );
  }

  async loadWorkflowEntities(
    entityRefs: string[],
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<TemporalWorkflowEntityLoadResult[]> {
    if (entityRefs.length === 0) return [];
    const decisions = await this.permissions.authorize(
      entityRefs.map(resourceRef => ({ permission, resourceRef })),
      { credentials },
    );
    const allowed = entityRefs.filter(
      (_, i) => decisions[i]?.result === AuthorizeResult.ALLOW,
    );
    if (allowed.length === 0) return [];
    const { items } = await this.catalog.getEntitiesByRefs(
      { entityRefs: allowed },
      { credentials },
    );
    return allowed.flatMap(
      (entityRef, i): TemporalWorkflowEntityLoadResult[] => {
        const entity = items[i];
        if (!entity || !isTemporalWorkflowEntity(entity)) return [];
        try {
          return [{ entityRef, context: this.sources.entityContext(entity) }];
        } catch (error) {
          if (error instanceof InputError) return [{ entityRef, error }];
          throw error;
        }
      },
    );
  }

  /**
   * Loads a workflow and the entity it is shown for, with all checks.
   * `entityRef` is the entity the caller opened the workflow from, if any.
   */
  async loadWorkflow(
    ref: WorkflowRunRef,
    options: {
      entityRef?: string;
      credentials: BackstageCredentials;
    },
  ): Promise<TemporalAccessibleWorkflow> {
    const { credentials } = options;
    if (!options.entityRef) {
      return this.loadWorkflowWithoutEntity(ref, credentials);
    }
    const context = await this.loadEntity(
      options.entityRef,
      temporalWorkflowReadPermission,
      credentials,
    );
    // After the permission, so a denied caller cannot probe which
    // namespaces are configured.
    this.sources.checkNamespace(ref.namespace);
    try {
      const workflow = await this.queries.describe(ref);
      const matchedEntityRef = await this.queries.assertBelongs(
        workflow,
        context,
      );
      return { context, matchedEntityRef, workflow };
    } catch (error) {
      // A workflow of another entity gets the answer of one that does not
      // exist.
      if (error instanceof NotFoundError) {
        throw new NotFoundError(`Workflow ${ref.workflowId} was not found`);
      }
      throw error;
    }
  }

  /**
   * A workflow opened without an entity: the list permission covers the
   * workflows it allows, else the entity of its entity reference search
   * attribute decides. A caller that neither permission can allow gets a
   * 403 before the workflow is read. For the others, unless the list
   * permission allows every workflow, a workflow they may not open gets the
   * same 404 as a workflow that does not exist.
   */
  private async loadWorkflowWithoutEntity(
    ref: WorkflowRunRef,
    credentials: BackstageCredentials,
  ): Promise<TemporalAccessibleWorkflow> {
    const [listDecision, entityDecision] =
      await this.permissions.authorizeConditional(
        [
          { permission: temporalWorkflowListPermission },
          { permission: temporalWorkflowReadPermission },
        ],
        { credentials },
      );
    const listMayAllow = listDecision.result !== AuthorizeResult.DENY;
    const entityMayAllow = entityDecision?.result !== AuthorizeResult.DENY;
    if (!listMayAllow && !entityMayAllow) throw new NotAllowedError();
    this.sources.checkNamespace(ref.namespace);
    if (listDecision.result === AuthorizeResult.ALLOW) {
      return { workflow: await this.queries.describe(ref) };
    }
    const notFound = () =>
      new NotFoundError(`Workflow ${ref.workflowId} was not found`);
    try {
      const workflow = await this.queries.describe(ref);
      if (
        listMayAllow &&
        this.decisionAllows(
          listDecision,
          workflow,
          temporalWorkflowListPermission.name,
        )
      ) {
        return { workflow };
      }
      // A search attribute that is not an entity reference counts as none.
      const linked = workflow.entityRef
        ? canonicalEntityRef(workflow.entityRef)
        : undefined;
      if (workflow.entityRef && !linked) {
        this.logger
          .child({ namespace: ref.namespace, workflowId: ref.workflowId })
          .debug('The entity reference of a workflow is not valid');
      }
      if (!entityMayAllow || !linked) throw notFound();
      let context: TemporalEntityContext;
      try {
        context = await this.loadEntity(
          linked,
          temporalWorkflowReadPermission,
          credentials,
        );
      } catch (error) {
        // A linked entity that cannot be used counts as none.
        if (error instanceof InputError) throw notFound();
        throw error;
      }
      const matchedEntityRef = await this.queries.assertBelongs(
        workflow,
        context,
      );
      return { context, matchedEntityRef, workflow };
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof NotAllowedError) {
        throw notFound();
      }
      throw error;
    }
  }

  /**
   * Adds `workflowTypeEntityRef` to runs that match a `TemporalWorkflow`
   * entity the caller can see (same namespace, workflow type and task
   * queue). When several entities match, the ones with the run's task queue
   * win over the ones without a task queue; if more than one is left at that
   * level, the run gets no reference.
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

  /**
   * The `TemporalWorkflow` entities that an entity depends on and that the
   * caller has the same permission on. The others are left out. At most
   * {@link MAX_RELATED_WORKFLOW_ENTITIES} are queried.
   */
  private async loadRelatedWorkflowEntities(
    entity: Entity,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<{
    entities: Entity[];
    relatedWorkflows?: RelatedWorkflows;
  }> {
    if (isTemporalWorkflowEntity(entity)) return { entities: [] };
    const allRefs = getDependsOnTemporalWorkflowRefs(entity);
    const total = allRefs.length;
    const refs = allRefs.slice(0, MAX_RELATED_WORKFLOW_ENTITIES);
    const queried = refs.length;
    const relatedWorkflows = total > 0 ? { total, queried } : undefined;
    if (total > queried) {
      this.logger
        .child({ entityRef: stringifyEntityRef(entity), total, queried })
        .debug(
          'An entity depends on more TemporalWorkflow entities than are queried',
        );
    }
    if (refs.length === 0) return { entities: [], relatedWorkflows };
    const decisions = await this.permissions.authorize(
      refs.map(resourceRef => ({ permission, resourceRef })),
      { credentials },
    );
    const allowed = refs.filter(
      (_, i) => decisions[i]?.result === AuthorizeResult.ALLOW,
    );
    if (allowed.length === 0) return { entities: [], relatedWorkflows };
    const { items } = await this.catalog.getEntitiesByRefs(
      { entityRefs: allowed },
      { credentials },
    );
    return {
      entities: items.filter((e): e is Entity => Boolean(e)),
      relatedWorkflows,
    };
  }
}

/** An entity reference in its canonical form, or undefined for a bad one. */
export function canonicalEntityRef(raw: string): string | undefined {
  try {
    return stringifyEntityRef(parseEntityRef(raw));
  } catch {
    return undefined;
  }
}

/** An entity reference in its canonical form; InputError for a bad one. */
export function normalizeEntityRef(raw: string): string {
  const ref = canonicalEntityRef(raw);
  if (ref === undefined) throw new InputError('Invalid entityRef');
  return ref;
}
