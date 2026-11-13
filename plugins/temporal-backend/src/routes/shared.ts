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
} from '@backstage/backend-plugin-api';
import { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonObject } from '@backstage/types';
import { WorkflowDetail, WorkflowRef } from '../common';
import {
  TemporalAccessService,
  TemporalEntityContext,
  TemporalWorkflowAccessLevel,
} from '../node/alpha';
import { Request } from 'express';
import { canonicalEntityRef } from '../access/DefaultTemporalAccessService';
import { parseEntityRefParam, workflowRefFromParams } from './params';

// What the read routes and the routes that change workflows share: the
// paths of one workflow, loading it with the access checks, the permission
// check on its entity and the audit record of an operation.

/** The paths of one workflow, with or without its run. */
export const workflowPaths = [
  '/namespaces/:namespace/workflows/:workflowId',
  '/namespaces/:namespace/workflows/:workflowId/runs/:runId',
];

/** The paths of `suffix` under one workflow, with or without its run. */
export function workflowSubpaths(suffix: string): string[] {
  return workflowPaths.map(p => `${p}/${suffix}`);
}

/** A workflow loaded with the read checks of the access service. */
export interface LoadedWorkflow {
  credentials: BackstageCredentials;
  ref: WorkflowRef;
  context?: TemporalEntityContext;
  workflow: WorkflowDetail;
}

/** The workflow of the request's path, with the access checks of `level`. */
export async function loadRequestWorkflow(
  deps: { httpAuth: HttpAuthService; access: TemporalAccessService },
  req: Request,
  level: TemporalWorkflowAccessLevel,
): Promise<LoadedWorkflow> {
  const credentials = await deps.httpAuth.credentials(req);
  const ref = workflowRefFromParams(req);
  const loaded = await deps.access.loadWorkflow(ref, {
    entityRef: parseEntityRefParam(req.query.entityRef),
    level,
    credentials,
  });
  return { credentials, ref, ...loaded };
}

/**
 * Checks a permission on the workflow's entity: the entity it was loaded
 * with, else the entity in its search attribute. A workflow without an
 * entity, or whose search attribute is not an entity reference, is only
 * allowed when the policy allows the permission for every entity (an
 * unconditional ALLOW). Returns the entity reference the permission was
 * checked on.
 */
export async function authorizeOnWorkflow(
  access: TemporalAccessService,
  permission: ResourcePermission<'catalog-entity'>,
  loaded: Pick<LoadedWorkflow, 'credentials' | 'context' | 'workflow'>,
): Promise<string | undefined> {
  const entityRef =
    loaded.context?.entityRef ??
    (loaded.workflow.entityRef
      ? canonicalEntityRef(loaded.workflow.entityRef)
      : undefined);
  await access.authorizeOn(permission, entityRef, loaded.credentials);
  return entityRef;
}

/** Records an operation with the auditor and runs it. */
export async function audited<T>(
  auditor: AuditorService,
  req: Request,
  eventId: string,
  meta: JsonObject,
  severityLevel: 'low' | 'medium' | 'high',
  run: () => Promise<T>,
): Promise<T> {
  const event = await auditor.createEvent({
    eventId,
    severityLevel,
    request: req,
    meta,
  });
  try {
    const result = await run();
    await event.success();
    return result;
  } catch (error) {
    await event.fail({ error: error as Error });
    throw error;
  }
}

/** The audit meta of an operation on one workflow. */
export function workflowMeta(
  workflow: WorkflowDetail,
  entityRef: string | undefined,
  extra: JsonObject = {},
): JsonObject {
  const meta: JsonObject = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
    workflowType: workflow.workflowType,
    ...extra,
  };
  if (entityRef) meta.entityRef = entityRef;
  return meta;
}
