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
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
} from '@backstage/errors';
import { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonObject, JsonValue } from '@backstage/types';
import {
  isValidControlActionId,
  TemporalScheduleOperation,
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
import { TemporalService } from '@kwkevinchan/backstage-plugin-temporal-node';
import {
  TemporalAccessService,
  TemporalControlAction,
  TemporalEntityContext,
  TemporalWorkflowAccessLevel,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { WorkflowCommands } from '../services/WorkflowCommands';
import {
  entityRefFromParams,
  entityWorkflowSource,
  matchesSource,
  parseEntityRefParam,
  workflowRefFromParams,
} from './params';

/** A workflow loaded with the read checks of the access service. */
interface LoadedWorkflow {
  credentials: BackstageCredentials;
  ref: WorkflowRef;
  context?: TemporalEntityContext;
  workflow: WorkflowDetail;
}

export interface ControlRouterOptions {
  httpAuth: HttpAuthService;
  access: TemporalAccessService;
  auditor: AuditorService;
  temporal: TemporalService;
  commands: WorkflowCommands;
  actions: TemporalControlAction[];
}

const workflowPaths = [
  '/namespaces/:namespace/workflows/:workflowId',
  '/namespaces/:namespace/workflows/:workflowId/runs/:runId',
];

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

/** The note of a pause or an unpause: a short string, or undefined. */
function optionalNote(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1000) {
    throw new InputError('note must be a string of at most 1000 characters');
  }
  return value.trim() || undefined;
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
 * rerun, custom actions), served under `/api/temporal` next to the plugin's
 * read routes. Every operation is checked with the access service of the
 * plugin and the permission framework, and recorded with the auditor.
 */
export function createControlRouter(
  options: ControlRouterOptions,
): express.Router {
  const { httpAuth, access, auditor, commands } = options;
  const router = Router();
  router.use(express.json());

  /** The workflow of the request's path, with the read checks. */
  async function loadWorkflow(
    req: Request,
    level: TemporalWorkflowAccessLevel,
  ): Promise<LoadedWorkflow> {
    const credentials = await httpAuth.credentials(req);
    const ref = workflowRefFromParams(req);
    const loaded = await access.loadWorkflow(ref, {
      entityRef: parseEntityRefParam(req.query.entityRef),
      level,
      credentials,
    });
    return { credentials, ref, ...loaded };
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
    await access.authorizeOn(permission, entityRef, credentials);
    return entityRef;
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
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowSignalPermission,
      loaded,
    );
    const name = parseName(body(req).name);
    const args = parseArgs(body(req).args);
    commands.checkSignal(name);
    assertRunning(loaded.workflow);
    await audited(
      req,
      'workflow-signal',
      workflowMeta(loaded.workflow, entityRef, { name }),
      'medium',
      () =>
        commands.signal(
          runRef(loaded.workflow),
          name,
          args,
          identityOf(loaded.credentials),
        ),
    );
    res.status(202).json({});
  });

  router.post(paths('update'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowUpdatePermission,
      loaded,
    );
    const name = parseName(body(req).name);
    const args = parseArgs(body(req).args);
    commands.checkUpdate(name);
    assertRunning(loaded.workflow);
    const result = await audited(
      req,
      'workflow-update',
      workflowMeta(loaded.workflow, entityRef, { name }),
      'medium',
      () =>
        commands.update(
          runRef(loaded.workflow),
          name,
          args,
          identityOf(loaded.credentials),
        ),
    );
    res.json({ result });
  });

  router.post(paths('cancel'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
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
        commands.cancel(
          runRef(loaded.workflow),
          identityOf(loaded.credentials),
        ),
    );
    res.status(202).json({});
  });

  router.post(paths('terminate'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
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
        commands.terminate(
          runRef(loaded.workflow),
          reason,
          identityOf(loaded.credentials),
        ),
    );
    res.json({});
  });

  router.post(paths('rerun'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
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
        commands.rerun(loaded.workflow, {
          workflowId,
          identity: identityOf(loaded.credentials),
          // Keeps the entity of the run; the initiator is the caller.
          searchAttributes: startAttributes(undefined, loaded.credentials),
        }),
    );
    res.status(201).json(started);
  });

  router.post(paths('actions/:actionId'), async (req, res) => {
    const actionId = req.params.actionId;
    const action = isValidControlActionId(actionId)
      ? options.actions.find(a => a.id === actionId)
      : undefined;
    if (!action) {
      throw new NotFoundError(`No workflow action ${actionId}`);
    }
    const loaded = await loadWorkflow(req, 'read');
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
            await access
              .loadEntity(entityRef, action.permission, loaded.credentials)
              // The entity may be gone from the catalog; the permission on
              // it was checked above.
              .catch(error => {
                if (error instanceof NotFoundError) return undefined;
                throw error;
              })
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
      const credentials = await httpAuth.credentials(req);
      const context = await access.loadEntity(
        entityRefFromParams(req),
        temporalWorkflowStartPermission,
        credentials,
      );
      const start = parseStart(req);
      const annotations = entityWorkflowSource(context.entity);
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
          commands.start({
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

  // Pause, unpause or trigger a schedule. Schedules start workflows, so
  // these need temporal.workflow.start: on the entity (whose workflow types
  // the schedule must start), or without conditions without one.
  router.post(
    '/namespaces/:namespace/schedules/:scheduleId/:operation(pause|unpause|trigger)',
    async (req, res) => {
      const credentials = await httpAuth.credentials(req);
      const { namespace, scheduleId } = req.params;
      const operation = req.params.operation as TemporalScheduleOperation;
      if (
        !isValidNamespaceName(namespace) ||
        !options.temporal.isNamespaceAllowed(namespace)
      ) {
        throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
      }
      if (!scheduleId || scheduleId.length > 1000) {
        throw new InputError('Invalid schedule ID');
      }
      const note = optionalNote(req.body?.note);
      if (note !== undefined && operation === 'trigger') {
        throw new InputError('A note is only kept by pause and unpause');
      }
      const entityRef = parseEntityRefParam(req.query.entityRef);
      // The permission first: the schedule is only read for callers that
      // may start workflows, so its existence is not told to others.
      let sources: ReturnType<typeof entityWorkflowSource>[] | undefined;
      if (entityRef) {
        const context = await access.loadEntity(
          entityRef,
          temporalWorkflowStartPermission,
          credentials,
        );
        if (context.namespace !== namespace) {
          throw new NotFoundError(
            `Schedule ${scheduleId} does not start a workflow of ${entityRef}`,
          );
        }
        // The entity and the related entities of the same namespace, as for
        // its workflow list.
        const defaultNamespace = options.temporal.getDefaultNamespace();
        sources = [context.entity, ...context.relatedWorkflowEntities]
          .map(entityWorkflowSource)
          .filter(
            source => (source.namespace ?? defaultNamespace) === namespace,
          );
      } else {
        await authorizeOn(
          temporalWorkflowStartPermission,
          undefined,
          credentials,
        );
      }
      const client = await options.temporal.getClient({ namespace });
      const handle = client.schedule.getHandle(scheduleId);
      const description = await handle.describe().catch(error => {
        if ((error as Error)?.name === 'ScheduleNotFoundError') {
          throw new NotFoundError(`No schedule ${scheduleId}`);
        }
        throw error;
      });
      const action = {
        workflowType: description.action.workflowType,
        taskQueue: description.action.taskQueue,
      };
      if (sources && !sources.some(source => matchesSource(action, source))) {
        throw new NotFoundError(
          `Schedule ${scheduleId} does not start a workflow of ${entityRef}`,
        );
      }
      const who = principalRef(credentials) ?? 'Backstage';
      await audited(
        req,
        `schedule-${operation}`,
        {
          namespace,
          scheduleId,
          operation,
          workflowType: action.workflowType,
          entityRef,
          ...(note ? { note } : {}),
        },
        'medium',
        async () => {
          if (operation === 'pause') {
            await handle.pause(note ?? `Paused from Backstage by ${who}`);
          } else if (operation === 'unpause') {
            await handle.unpause(note ?? `Resumed from Backstage by ${who}`);
          } else {
            // With the schedule's own overlap policy (the SDK's default is
            // to allow every overlap).
            await handle.trigger(description.policies?.overlap);
          }
        },
      );
      res.status(202).json({});
    },
  );

  router.post('/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    if (!(await access.canListAll(credentials))) {
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
        commands.start({
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

  return router;
}
