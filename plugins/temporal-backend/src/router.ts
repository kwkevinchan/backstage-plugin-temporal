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
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import {
  CompoundEntityRef,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { CatalogService } from '@backstage/plugin-catalog-node';
import {
  AuthorizeResult,
  ResourcePermission,
} from '@backstage/plugin-permission-common';
import {
  temporalWorkflowHistoryReadPermission,
  temporalWorkflowReadPermission,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { parseStatus } from './service/query';
import {
  EntityContext,
  HISTORY_PAGE_SIZE,
  LIST_PAGE_SIZE,
  WorkflowReader,
} from './service/WorkflowReader';

export interface RouterOptions {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  catalog: CatalogService;
  reader: WorkflowReader;
}

function parsePageSize(
  value: unknown,
  limits: { default: number; max: number },
): number {
  if (value === undefined || value === '') return limits.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > limits.max) {
    throw new InputError(`pageSize must be between 1 and ${limits.max}`);
  }
  return n;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputError(`Invalid ${name}`);
  return value;
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
    return reader.entityContext(entity);
  }

  /** Loads a workflow and the entity it is shown for, with all checks. */
  async function loadWorkflow(
    req: Request,
    permission: ResourcePermission<'catalog-entity'>,
  ) {
    const credentials = await httpAuth.credentials(req);
    const ref = workflowRefFromParams(req);
    reader.checkNamespace(ref.namespace);
    let entityRef = parseEntityRefParam(req.query.entityRef);
    let workflow;
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
    const compound: CompoundEntityRef = {
      kind: req.params.kind,
      namespace: req.params.namespace,
      name: req.params.name,
    };
    let entityRef: string;
    try {
      entityRef = stringifyEntityRef(compound);
    } catch {
      throw new InputError('Invalid entity reference');
    }
    const context = await loadEntity(
      entityRef,
      temporalWorkflowReadPermission,
      credentials,
    );
    const result = await reader.listEntityWorkflows(context, {
      status: parseStatus(req.query.status),
      pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
      pageToken: optionalString(req.query.pageToken, 'pageToken'),
      credentials,
    });
    res.json(result);
  });

  const workflowPaths = [
    '/namespaces/:namespace/workflows/:workflowId',
    '/namespaces/:namespace/workflows/:workflowId/runs/:runId',
  ];

  router.get(workflowPaths, async (req, res) => {
    const { credentials, context, workflow } = await loadWorkflow(
      req,
      temporalWorkflowReadPermission,
    );
    res.json(await reader.enrichDetail(workflow, context, credentials));
  });

  router.get(
    workflowPaths.map(p => `${p}/history`),
    async (req, res) => {
      const { ref, workflow } = await loadWorkflow(
        req,
        temporalWorkflowHistoryReadPermission,
      );
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
      const { ref, workflow } = await loadWorkflow(
        req,
        temporalWorkflowHistoryReadPermission,
      );
      res.json(await reader.steps({ ...ref, runId: workflow.runId }));
    },
  );

  return router;
}
