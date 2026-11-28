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
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import {
  isValidNamespaceName,
  WorkflowDetail,
  WorkflowRunRef,
} from '../common';
import { TemporalAccessService, TemporalEntityContext } from '../node/alpha';
import { Request } from 'express';
import { canonicalEntityRef } from '../access/DefaultTemporalAccessService';
import {
  isValidPathId,
  MAX_PATH_ID_LENGTH,
  parseEntityRefParam,
  workflowRunRefFromParams,
} from './params';

// What the read routes and the routes that change workflows share: the
// paths of one run, loading it with the access checks, the permission
// check on its entity and the audit record of an operation.

/** The path of the run list of one workflow ID. */
export const workflowPath = '/namespaces/:namespace/workflows/:workflowId';

/** The path of one run. */
export const workflowRunPath = `${workflowPath}/runs/:runId`;

/** The path of `suffix` under one run. */
export function workflowRunSubpath(suffix: string): string {
  return `${workflowRunPath}/${suffix}`;
}

/** A workflow loaded with the read checks of the access service. */
export interface LoadedWorkflow {
  credentials: BackstageCredentials;
  ref: WorkflowRunRef;
  context?: TemporalEntityContext;
  matchedEntityRef?: string;
  workflow: WorkflowDetail;
}

/** The workflow of the request's path, with the access checks. */
export async function loadRequestWorkflow(
  deps: { httpAuth: HttpAuthService; access: TemporalAccessService },
  req: Request,
): Promise<LoadedWorkflow> {
  const credentials = await deps.httpAuth.credentials(req);
  const ref = workflowRunRefFromParams(req);
  const loaded = await deps.access.loadWorkflow(ref, {
    entityRef: parseEntityRefParam(req.query.entityRef),
    credentials,
  });
  return { credentials, ref, ...loaded };
}

/**
 * Checks a permission on the workflow's entity: the entity it was loaded
 * with (and the related `TemporalWorkflow` entity it matched through, when
 * different). A workflow loaded without one is checked on the entity of its
 * search attribute only when the workflow opens with that entity as
 * `?entityRef=` would (see {@link verifiedLinkedEntity}). A workflow without
 * such an entity is only allowed when the policy allows the permission for
 * every entity (an unconditional ALLOW). Returns the entity reference the
 * permission was checked on.
 */
export async function authorizeOnWorkflow(
  access: TemporalAccessService,
  permission: ResourcePermission<'catalog-entity'>,
  loaded: Pick<
    LoadedWorkflow,
    'credentials' | 'context' | 'matchedEntityRef' | 'workflow'
  >,
): Promise<string | undefined> {
  const { context, matchedEntityRef } = loaded.context
    ? loaded
    : await verifiedLinkedEntity(access, loaded);
  const entityRef = context?.entityRef;
  await access.authorizeOn(permission, entityRef, loaded.credentials);
  if (matchedEntityRef && matchedEntityRef !== entityRef) {
    await access.authorizeOn(permission, matchedEntityRef, loaded.credentials);
  }
  return entityRef;
}

/**
 * The entity of the workflow's entity reference search attribute, loaded as
 * `loadWorkflow` loads it for `?entityRef=`: the caller may read the entity,
 * and the workflow is in its namespace and is one of its workflows. Whoever
 * starts a workflow can set the search attribute, so it is not trusted
 * alone. An entity that cannot be loaded this way counts as none.
 */
async function verifiedLinkedEntity(
  access: TemporalAccessService,
  loaded: Pick<LoadedWorkflow, 'credentials' | 'workflow'>,
): Promise<Pick<LoadedWorkflow, 'context' | 'matchedEntityRef'>> {
  const { workflow, credentials } = loaded;
  const linked = workflow.entityRef
    ? canonicalEntityRef(workflow.entityRef)
    : undefined;
  if (!linked) return {};
  try {
    return await access.loadWorkflow(
      {
        namespace: workflow.namespace,
        workflowId: workflow.workflowId,
        runId: workflow.runId,
      },
      { entityRef: linked, credentials },
    );
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof NotAllowedError ||
      error instanceof InputError
    ) {
      return {};
    }
    throw error;
  }
}

/** Safe string field from a JSON object body for initial audit metadata. */
export function optionalBodyString(
  req: Request,
  field: string,
  max = 200,
): string | undefined {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/** Placeholder recorded in initial audit metadata when a URL parameter is invalid or overlong. */
export const INVALID_AUDIT_VALUE = '<invalid>';

/** Validates a URL namespace for initial audit metadata before route validation. */
export function auditNamespace(value: unknown): string {
  return typeof value === 'string' && isValidNamespaceName(value)
    ? value
    : INVALID_AUDIT_VALUE;
}

/** Validates a URL workflow ID, run ID, or schedule ID for initial audit metadata. */
export function auditPathId(value: unknown): string {
  return isValidPathId(value) ? value : INVALID_AUDIT_VALUE;
}

/**
 * Canonicalizes a catalog entity reference for initial audit metadata, or
 * returns {@link INVALID_AUDIT_VALUE} when present and malformed or overlong.
 */
export function auditEntityRef(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_PATH_ID_LENGTH) {
    return INVALID_AUDIT_VALUE;
  }
  return canonicalEntityRef(value) ?? INVALID_AUDIT_VALUE;
}

/** Safe initial audit metadata of a request targeting one workflow run. */
export function requestWorkflowMeta(
  req: Request,
  extra: JsonObject = {},
): JsonObject {
  const entityRef = auditEntityRef(req.query.entityRef);
  return {
    namespace: auditNamespace(req.params.namespace),
    workflowId: auditPathId(req.params.workflowId),
    runId: auditPathId(req.params.runId),
    ...(entityRef ? { entityRef } : {}),
    ...extra,
  };
}

/** Records an operation with the auditor and runs it. */
export async function audited<T>(
  auditor: AuditorService,
  req: Request,
  eventId: string,
  meta: JsonObject,
  severityLevel: 'low' | 'medium' | 'high',
  run: (setMeta: (extra: JsonObject) => void) => Promise<T>,
): Promise<T> {
  const event = await auditor.createEvent({
    eventId,
    severityLevel,
    request: req,
    meta,
  });
  let resolvedMeta: JsonObject | undefined;
  const setMeta = (extra: JsonObject) => {
    resolvedMeta = resolvedMeta ? { ...resolvedMeta, ...extra } : { ...extra };
  };
  try {
    const result = await run(setMeta);
    await event.success(resolvedMeta ? { meta: resolvedMeta } : undefined);
    return result;
  } catch (error) {
    await event.fail({
      error: error as Error,
      ...(resolvedMeta ? { meta: resolvedMeta } : {}),
    });
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
