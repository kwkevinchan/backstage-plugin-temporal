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
  AuditorService,
  BackstageCredentials,
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import {
  CompoundEntityRef,
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
  WorkflowSummary,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalControlAction,
  TemporalService,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { sendStoredPayload } from './service/download';
import { addControlRoutes } from './controlRoutes';
import { WorkflowController } from './service/WorkflowController';
import { parseStatus } from './service/query';
import {
  EntityContext,
  HISTORY_PAGE_SIZE,
  LIST_PAGE_SIZE,
  STATS_LIMIT,
  WorkflowReader,
} from './service/WorkflowReader';

/** Most `TemporalWorkflow` entities of one entity that are queried. */
export const MAX_RELATED_WORKFLOW_ENTITIES = 20;

export interface RouterOptions {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  catalog: CatalogService;
  reader: WorkflowReader;
  /** When set, the routes that change workflows are served too. */
  controls?: {
    auditor: AuditorService;
    temporal: TemporalService;
    controller: WorkflowController;
    actions: TemporalControlAction[];
  };
}

function parsePageSize(
  value: unknown,
  limits: { default: number; max: number },
  name = 'pageSize',
): number {
  if (value === undefined || value === '') return limits.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > limits.max) {
    throw new InputError(`${name} must be between 1 and ${limits.max}`);
  }
  return n;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputError(`Invalid ${name}`);
  return value;
}

/** `true` or `false`; absent is false. */
function parseFlag(value: unknown, name: string): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new InputError(`${name} must be true or false`);
}

function parseEntityRefParam(value: unknown): string | undefined {
  const raw = optionalString(value, 'entityRef');
  if (!raw) return undefined;
  try {
    return stringifyEntityRef(parseEntityRef(raw));
  } catch {
    throw new InputError('Invalid entityRef');
  }
}

function entityRefFromParams(req: Request): string {
  const compound: CompoundEntityRef = {
    kind: req.params.kind,
    namespace: req.params.namespace,
    name: req.params.name,
  };
  try {
    return stringifyEntityRef(compound);
  } catch {
    throw new InputError('Invalid entity reference');
  }
}

function workflowRefFromParams(req: Request): WorkflowRef {
  const { namespace, workflowId, runId } = req.params;
  if (!workflowId || workflowId.length > 1000) {
    throw new InputError('Invalid workflowId');
  }
  return { namespace, workflowId, runId: runId || undefined };
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, permissions, catalog, reader } = options;
  const router = Router();
  router.use(express.json());

  async function authorize(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string,
    credentials: BackstageCredentials,
  ) {
    const [decision] = await permissions.authorize(
      [{ permission, resourceRef: entityRef }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError();
    }
  }

  async function isAllowed(
    permission: BasicPermission,
    credentials: BackstageCredentials,
  ) {
    const [decision] = await permissions.authorize([{ permission }], {
      credentials,
    });
    return decision.result === AuthorizeResult.ALLOW;
  }

  /** True when the caller may list and open every workflow. */
  async function canListAll(credentials: BackstageCredentials) {
    return isAllowed(temporalWorkflowListPermission, credentials);
  }

  /** True when the caller may read the entity's resource permission. */
  async function isAllowedOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string,
    credentials: BackstageCredentials,
  ) {
    const [decision] = await permissions.authorize(
      [{ permission, resourceRef: entityRef }],
      { credentials },
    );
    return decision.result === AuthorizeResult.ALLOW;
  }

  /**
   * Adds `workflowEntityRef` to runs that match a `TemporalWorkflow` entity
   * the caller can see (same namespace, workflow type and task queue).
   */
  async function linkWorkflowEntities(
    items: WorkflowSummary[],
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<WorkflowSummary[]> {
    const types = [...new Set(items.map(i => i.workflowType))].filter(Boolean);
    if (types.length === 0) return items;
    const { items: entities } = await catalog.getEntities(
      {
        filter: { kind: TEMPORAL_WORKFLOW_KIND, 'spec.workflowType': types },
        fields: ['kind', 'metadata.namespace', 'metadata.name', 'spec'],
      },
      { credentials },
    );
    const sources = entities.flatMap(entity => {
      try {
        const spec = parseTemporalWorkflowSpec(entity);
        if ((spec.namespace ?? reader.defaultNamespace()) !== namespace) {
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
  async function loadRelatedWorkflowEntities(
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
    const decisions = await permissions.authorize(
      refs.map(resourceRef => ({ permission, resourceRef })),
      { credentials },
    );
    const allowed = refs.filter(
      (_, i) => decisions[i]?.result === AuthorizeResult.ALLOW,
    );
    if (allowed.length === 0) return [];
    const { items } = await catalog.getEntitiesByRefs(
      { entityRefs: allowed },
      { credentials },
    );
    return items.filter((e): e is Entity => Boolean(e));
  }

  /** Permission first, then the entity, read with the caller's credentials. */
  async function loadEntity(
    entityRef: string,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<EntityContext> {
    await authorize(permission, entityRef, credentials);
    const entity = await catalog.getEntityByRef(entityRef, { credentials });
    if (!entity) {
      throw new NotFoundError(`No entity ${entityRef}`);
    }
    const related = await loadRelatedWorkflowEntities(
      entity,
      permission,
      credentials,
    );
    return reader.entityContext(entity, related);
  }

  /**
   * Loads a workflow and the entity it is shown for, with all checks.
   * `level` is `read` for details and the step graph, `history` for the
   * event history, inputs and results.
   */
  async function loadWorkflow(req: Request, level: 'read' | 'history') {
    const credentials = await httpAuth.credentials(req);
    const ref = workflowRefFromParams(req);
    reader.checkNamespace(ref.namespace);
    const permission =
      level === 'history'
        ? temporalWorkflowHistoryReadPermission
        : temporalWorkflowReadPermission;
    let entityRef = parseEntityRefParam(req.query.entityRef);
    let workflow;
    if (
      !entityRef &&
      (await canListAll(credentials)) &&
      (level === 'read' ||
        (await isAllowed(temporalWorkflowHistoryListPermission, credentials)))
    ) {
      // Opened from the Workflows page: the list permission covers every
      // workflow of the allowed namespaces, the history list permission
      // their history.
      workflow = await reader.describe(ref);
      return { credentials, ref, context: undefined, workflow };
    }
    if (!entityRef) {
      // Without an entity in the request, the workflow's entity reference
      // search attribute decides which entity the permission is checked on.
      workflow = await reader.describe(ref);
      if (!workflow.entityRef) {
        throw new NotAllowedError(
          'The workflow is not linked to a catalog entity; pass entityRef',
        );
      }
      entityRef = parseEntityRefParam(workflow.entityRef);
    }
    const context = await loadEntity(entityRef!, permission, credentials);
    workflow ??= await reader.describe(ref);
    reader.assertBelongs(workflow, context);
    return { credentials, ref, context, workflow };
  }

  router.get('/entities/:kind/:namespace/:name/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const context = await loadEntity(
      entityRefFromParams(req),
      temporalWorkflowReadPermission,
      credentials,
    );
    const result = await reader.listEntityWorkflows(context, {
      status: parseStatus(req.query.status),
      allRuns: parseFlag(req.query.allRuns, 'allRuns'),
      pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
      pageToken: optionalString(req.query.pageToken, 'pageToken'),
      credentials,
    });
    res.json(result);
  });

  router.get('/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    if (!(await canListAll(credentials))) {
      throw new NotAllowedError();
    }
    const namespace =
      optionalString(req.query.namespace, 'namespace') ||
      reader.defaultNamespace();
    const result = await reader.listNamespaceWorkflows(
      namespace,
      {
        status: parseStatus(req.query.status),
        allRuns: parseFlag(req.query.allRuns, 'allRuns'),
        workflowType:
          optionalString(req.query.workflowType, 'workflowType') || undefined,
        workflowIdPrefix:
          optionalString(req.query.workflowId, 'workflowId')?.trim() ||
          undefined,
      },
      {
        pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
        pageToken: optionalString(req.query.pageToken, 'pageToken'),
      },
    );
    res.json({
      ...result,
      items: await linkWorkflowEntities(result.items, namespace, credentials),
    });
  });

  router.get(
    '/entities/:kind/:namespace/:name/workflow-stats',
    async (req, res) => {
      const credentials = await httpAuth.credentials(req);
      const context = await loadEntity(
        entityRefFromParams(req),
        temporalWorkflowReadPermission,
        credentials,
      );
      const limit = parsePageSize(req.query.limit, STATS_LIMIT, 'limit');
      res.json(await reader.stats(context, { limit }));
    },
  );

  const workflowPaths = [
    '/namespaces/:namespace/workflows/:workflowId',
    '/namespaces/:namespace/workflows/:workflowId/runs/:runId',
  ];

  router.get(workflowPaths, async (req, res) => {
    const { credentials, context, workflow } = await loadWorkflow(req, 'read');
    res.json(
      context
        ? await reader.enrichDetail(workflow, context, credentials)
        : workflow,
    );
  });

  router.get(
    workflowPaths.map(p => `${p}/history`),
    async (req, res) => {
      const { ref, workflow } = await loadWorkflow(req, 'history');
      res.json(
        await reader.history(
          { ...ref, runId: workflow.runId },
          {
            pageSize: parsePageSize(req.query.pageSize, HISTORY_PAGE_SIZE),
            pageToken: optionalString(req.query.pageToken, 'pageToken'),
          },
        ),
      );
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/steps`),
    async (req, res) => {
      const { ref, workflow } = await loadWorkflow(req, 'history');
      res.json(await reader.steps({ ...ref, runId: workflow.runId }));
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/graph`),
    async (req, res) => {
      const { credentials, context, workflow } = await loadWorkflow(
        req,
        'read',
      );
      // Inputs and results need the history permission; without it the
      // graph is shown without them.
      const includePayloads = context
        ? await isAllowedOn(
            temporalWorkflowHistoryReadPermission,
            context.entityRef,
            credentials,
          )
        : await isAllowed(temporalWorkflowHistoryListPermission, credentials);
      const graph = await reader.graph(workflow, { includePayloads });
      if (graph.runChain) {
        graph.runChain = await reader.runPosition(workflow, graph.runChain);
      }
      res.json(graph);
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/progress`),
    async (req, res) => {
      const { workflow } = await loadWorkflow(req, 'read');
      res.json(await reader.progress(workflow));
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/payloads/download`),
    async (req, res) => {
      const key = optionalString(req.query.key, 'key');
      if (!key || key.length > 1024) throw new InputError('Invalid key');
      const { ref, workflow } = await loadWorkflow(req, 'history');
      if (!reader.payloads.configured) {
        throw new NotFoundError('S3 payload storage is not configured');
      }
      const check = await reader.findClaimCheck(
        { ...ref, runId: workflow.runId },
        key,
      );
      if (!check) {
        throw new NotFoundError(`No stored payload ${key} in this run`);
      }
      await sendStoredPayload(res, check, reader.payloads);
    },
  );

  if (options.controls) {
    addControlRoutes(router, {
      ...options.controls,
      httpAuth,
      permissions,
      workflowPaths,
      loadWorkflow,
      loadEntity,
      canListAll,
      entityRefFromParams,
    });
  }

  return router;
}
