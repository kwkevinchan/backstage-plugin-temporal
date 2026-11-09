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
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
} from '@backstage/errors';
import {
  AuthorizeResult,
  ResourcePermission,
} from '@backstage/plugin-permission-common';
import type { JsonObject, JsonValue } from '@backstage/types';
import {
  isValidControlActionId,
  isValidNamespaceName,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  MAX_CONTROL_NAME_LENGTH,
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowStartPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
  WorkflowDetail,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { TemporalControlAction } from './extensions';
import { TemporalService } from './service/TemporalService';
import express, { Request } from 'express';
import { WorkflowController } from './service/WorkflowController';
import { matchesSource } from './service/query';
import { EntityContext } from './service/WorkflowReader';

/** A workflow loaded with the read checks of the router. */
export interface LoadedWorkflow {
  credentials: BackstageCredentials;
  ref: WorkflowRef;
  context?: EntityContext;
  workflow: WorkflowDetail;
}

export interface ControlRouteOptions {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  auditor: AuditorService;
  temporal: TemporalService;
  controller: WorkflowController;
  actions: TemporalControlAction[];
  workflowPaths: string[];
  loadWorkflow(
    req: Request,
    level: 'read' | 'history',
  ): Promise<LoadedWorkflow>;
  loadEntity(
    entityRef: string,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<EntityContext>;
  canListAll(credentials: BackstageCredentials): Promise<boolean>;
  entityRefFromParams(req: Request): string;
}

/** Longest terminate reason. */
const MAX_REASON_LENGTH = 1000;
/** Longest workflow ID. */
const MAX_WORKFLOW_ID_LENGTH = 1000;

function body(req: Request): Record<string, unknown> {
  const value = req.body;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('The request body must be a JSON object');
  }
  return value;
}

function parseName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_CONTROL_NAME_LENGTH
  ) {
    throw new InputError('name is required');
  }
  return value.trim();
}

function parseArgs(value: unknown): JsonValue[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new InputError('args must be an array of arguments');
  }
  return value as JsonValue[];
}

function optionalText(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new InputError(`Invalid ${name}`);
  }
  return value.trim() || undefined;
}

function parseWorkflowId(value: unknown): string | undefined {
  return optionalText(value, 'workflowId', MAX_WORKFLOW_ID_LENGTH);
}

/** The user (or service) a request comes from, as Temporal identity. */
function principalRef(credentials: BackstageCredentials): string | undefined {
  const principal = credentials.principal as {
    type: string;
    userEntityRef?: string;
    subject?: string;
  };
  if (principal.type === 'user') return principal.userEntityRef;
  if (principal.type === 'service') return principal.subject;
  return undefined;
}

function identityOf(credentials: BackstageCredentials): string {
  const ref = principalRef(credentials);
  return ref ? `backstage:${ref}` : 'backstage';
}

function runRef(workflow: WorkflowDetail): Required<WorkflowRef> {
  return {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
}

function assertRunning(workflow: WorkflowDetail) {
  if (workflow.status !== 'Running') {
    throw new ConflictError(
      `Workflow ${workflow.workflowId} is not running (${workflow.status})`,
    );
  }
}

function normalizedRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return stringifyEntityRef(parseEntityRef(value));
  } catch {
    return undefined;
  }
}

/**
 * Routes that change workflows (start, signal, update, cancel, terminate,
 * rerun, custom actions) and the query route. Every operation is checked
 * with the permission framework and recorded with the auditor.
 */
export function addControlRoutes(
  router: express.Router,
  options: ControlRouteOptions,
) {
  const { httpAuth, permissions, auditor, controller, workflowPaths } = options;
  const controlEnabled = controller.options.enabled;

  function checkEnabled() {
    if (!controlEnabled) {
      throw new NotFoundError('Workflow controls are disabled');
    }
  }

  /**
   * Checks a control permission on the workflow's entity: the entity of the
   * request, else the entity in the workflow's search attribute. A workflow
   * without an entity is only allowed when the policy allows the permission
   * for every entity (an unconditional ALLOW).
   */
  async function authorizeControl(
    permission: ResourcePermission<'catalog-entity'>,
    loaded: Pick<LoadedWorkflow, 'credentials' | 'context' | 'workflow'>,
  ): Promise<string | undefined> {
    const entityRef =
      loaded.context?.entityRef ?? normalizedRef(loaded.workflow.entityRef);
    return authorizeOn(permission, entityRef, loaded.credentials);
  }

  async function authorizeOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<string | undefined> {
    if (entityRef) {
      const [decision] = await permissions.authorize(
        [{ permission, resourceRef: entityRef }],
        { credentials },
      );
      if (decision.result !== AuthorizeResult.ALLOW) {
        throw new NotAllowedError();
      }
      return entityRef;
    }
    const [decision] = await permissions.authorizeConditional(
      [{ permission }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError();
    }
    return undefined;
  }

  /** Records an operation with the auditor and runs it. */
  async function audited<T>(
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

  function workflowMeta(
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

  /** Values of the configured search attributes of a new workflow. */
  function startAttributes(
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Record<string, string> {
    const names = options.temporal.getSearchAttributeNames();
    const values: Record<string, string> = {};
    if (names.entityRef && entityRef) values[names.entityRef] = entityRef;
    const initiator = principalRef(credentials);
    if (names.initiator && initiator) values[names.initiator] = initiator;
    return values;
  }

  const paths = (suffix: string) => workflowPaths.map(p => `${p}/${suffix}`);

  router.post(paths('signal'), async (req, res) => {
    checkEnabled();
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowSignalPermission,
      loaded,
    );
    const name = parseName(body(req).name);
    const args = parseArgs(body(req).args);
    controller.checkSignal(name);
    assertRunning(loaded.workflow);
    await audited(
      req,
      'workflow-signal',
      workflowMeta(loaded.workflow, entityRef, { name }),
      'medium',
      () =>
        controller.signal(
          runRef(loaded.workflow),
          name,
          args,
          identityOf(loaded.credentials),
        ),
    );
    res.status(202).json({});
  });

  router.post(paths('update'), async (req, res) => {
    checkEnabled();
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowUpdatePermission,
      loaded,
    );
    const name = parseName(body(req).name);
    const args = parseArgs(body(req).args);
    controller.checkUpdate(name);
    assertRunning(loaded.workflow);
    const result = await audited(
      req,
      'workflow-update',
      workflowMeta(loaded.workflow, entityRef, { name }),
      'medium',
      () =>
        controller.update(
          runRef(loaded.workflow),
          name,
          args,
          identityOf(loaded.credentials),
        ),
    );
    res.json({ result });
  });

  // Queries only read the workflow: the read permission is enough, and they
  // are served when the controls are disabled.
  router.post(paths('query'), async (req, res) => {
    const loaded = await options.loadWorkflow(req, 'read');
    const name = parseName(body(req).name);
    const args = parseArgs(body(req).args);
    const result = await audited(
      req,
      'workflow-query',
      workflowMeta(
        loaded.workflow,
        loaded.context?.entityRef ?? normalizedRef(loaded.workflow.entityRef),
        { name },
      ),
      'low',
      () => controller.query(runRef(loaded.workflow), name, args),
    );
    res.json({ result });
  });

  router.post(paths('cancel'), async (req, res) => {
    checkEnabled();
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowCancelPermission,
      loaded,
    );
    assertRunning(loaded.workflow);
    await audited(
      req,
      'workflow-cancel',
      workflowMeta(loaded.workflow, entityRef),
      'medium',
      () =>
        controller.cancel(
          runRef(loaded.workflow),
          identityOf(loaded.credentials),
        ),
    );
    res.status(202).json({});
  });

  router.post(paths('terminate'), async (req, res) => {
    checkEnabled();
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowTerminatePermission,
      loaded,
    );
    const reason =
      optionalText(body(req).reason, 'reason', MAX_REASON_LENGTH) ??
      'Terminated from Backstage';
    assertRunning(loaded.workflow);
    await audited(
      req,
      'workflow-terminate',
      workflowMeta(loaded.workflow, entityRef, { reason }),
      'high',
      () =>
        controller.terminate(
          runRef(loaded.workflow),
          reason,
          identityOf(loaded.credentials),
        ),
    );
    res.json({});
  });

  router.post(paths('rerun'), async (req, res) => {
    checkEnabled();
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowRerunPermission,
      loaded,
    );
    const workflowId = parseWorkflowId(body(req).workflowId);
    const started = await audited(
      req,
      'workflow-rerun',
      workflowMeta(loaded.workflow, entityRef),
      'medium',
      () =>
        controller.rerun(loaded.workflow, {
          workflowId,
          identity: identityOf(loaded.credentials),
          // Keeps the entity of the run; the initiator is the caller.
          searchAttributes: startAttributes(undefined, loaded.credentials),
        }),
    );
    res.status(201).json(started);
  });

  router.post(paths('actions/:actionId'), async (req, res) => {
    checkEnabled();
    const actionId = req.params.actionId;
    const action = isValidControlActionId(actionId)
      ? options.actions.find(a => a.id === actionId)
      : undefined;
    if (!action) {
      throw new NotFoundError(`No workflow action ${actionId}`);
    }
    const loaded = await options.loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(action.permission, loaded);
    if (action.filter && !action.filter(loaded.workflow)) {
      throw new ConflictError(
        `Action ${actionId} does not apply to workflow ${loaded.workflow.workflowId}`,
      );
    }
    const client = await options.temporal.getClient({
      namespace: loaded.workflow.namespace,
    });
    const entity =
      loaded.context?.entity ??
      (entityRef
        ? (
            await options
              .loadEntity(entityRef, action.permission, loaded.credentials)
              .catch(() => undefined)
          )?.entity
        : undefined);
    const result = await audited(
      req,
      'workflow-action',
      workflowMeta(loaded.workflow, entityRef, { actionId }),
      'medium',
      () =>
        action.handle(runRef(loaded.workflow), req.body as JsonValue, {
          entity,
          workflow: loaded.workflow,
          credentials: loaded.credentials,
          client,
        }),
    );
    res.json(result === undefined ? {} : { result });
  });

  function parseStart(req: Request) {
    const b = body(req);
    const workflowType = optionalText(b.workflowType, 'workflowType', 1000);
    const taskQueue = optionalText(b.taskQueue, 'taskQueue', 1000);
    if (workflowType && !isValidWorkflowTypeName(workflowType)) {
      throw new InputError('Invalid workflowType');
    }
    if (taskQueue && !isValidTaskQueueName(taskQueue)) {
      throw new InputError('Invalid taskQueue');
    }
    return {
      workflowType,
      taskQueue,
      namespace: optionalText(b.namespace, 'namespace', 1000),
      args: parseArgs(b.args),
      workflowId: parseWorkflowId(b.workflowId),
    };
  }

  router.post(
    '/entities/:kind/:namespace/:name/workflows',
    async (req, res) => {
      checkEnabled();
      const credentials = await httpAuth.credentials(req);
      const context = await options.loadEntity(
        options.entityRefFromParams(req),
        temporalWorkflowStartPermission,
        credentials,
      );
      const start = parseStart(req);
      const { annotations } = context.filter;
      const workflowType =
        start.workflowType ??
        (annotations.workflowTypes.length === 1
          ? annotations.workflowTypes[0]
          : undefined);
      const taskQueue = start.taskQueue ?? annotations.taskQueue;
      if (!workflowType) throw new InputError('workflowType is required');
      if (!taskQueue) throw new InputError('taskQueue is required');
      // Only the entity's own workflows: its workflow types and task queue.
      if (!matchesSource({ workflowType, taskQueue }, annotations)) {
        throw new InputError(
          `${workflowType} on ${taskQueue} is not a workflow of ${context.entityRef}`,
        );
      }
      const started = await audited(
        req,
        'workflow-start',
        {
          namespace: context.namespace,
          workflowType,
          taskQueue,
          entityRef: context.entityRef,
          ...(start.workflowId ? { workflowId: start.workflowId } : {}),
        },
        'medium',
        () =>
          controller.start({
            namespace: context.namespace,
            workflowType,
            taskQueue,
            args: start.args,
            workflowId: start.workflowId,
            identity: identityOf(credentials),
            searchAttributes: startAttributes(context.entityRef, credentials),
          }),
      );
      res.status(201).json(started);
    },
  );

  router.post('/workflows', async (req, res) => {
    checkEnabled();
    const credentials = await httpAuth.credentials(req);
    if (!(await options.canListAll(credentials))) {
      throw new NotAllowedError();
    }
    await authorizeOn(temporalWorkflowStartPermission, undefined, credentials);
    const start = parseStart(req);
    const namespace = start.namespace || options.temporal.getDefaultNamespace();
    if (
      !isValidNamespaceName(namespace) ||
      !options.temporal.isNamespaceAllowed(namespace)
    ) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    if (!start.workflowType) throw new InputError('workflowType is required');
    if (!start.taskQueue) throw new InputError('taskQueue is required');
    const { workflowType, taskQueue } = start;
    const started = await audited(
      req,
      'workflow-start',
      {
        namespace,
        workflowType,
        taskQueue,
        ...(start.workflowId ? { workflowId: start.workflowId } : {}),
      },
      'medium',
      () =>
        controller.start({
          namespace,
          workflowType,
          taskQueue,
          args: start.args,
          workflowId: start.workflowId,
          identity: identityOf(credentials),
          searchAttributes: startAttributes(undefined, credentials),
        }),
    );
    res.status(201).json(started);
  });
}
