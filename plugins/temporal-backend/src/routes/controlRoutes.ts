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
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
} from '@backstage/errors';
import { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import {
  isValidControlActionId,
  TemporalScheduleOperation,
  isValidNamespaceName,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowStartPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
  TemporalAnnotations,
  WorkflowDetail,
  WorkflowRef,
} from '../common';
import { TemporalService } from '../node';
import {
  TemporalAccessService,
  TemporalControlAction,
  TemporalWorkflowAccessLevel,
} from '../node/alpha';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { canonicalEntityRef } from '../access/DefaultTemporalAccessService';
import { WorkflowCommands } from '../services/WorkflowCommands';
import {
  EntityWorkflowSources,
  readEntityWorkflowFilter,
} from '../services/EntityWorkflowSources';
import { matchesSource } from '../services/query';
import {
  entityRefFromParams,
  parseArgs,
  parseEntityRefParam,
  parseMessageBody,
  requestBody,
} from './params';
import {
  audited,
  authorizeOnWorkflow,
  LoadedWorkflow,
  loadRequestWorkflow,
  workflowMeta,
  workflowSubpaths,
} from './shared';

export interface ControlRouterOptions {
  httpAuth: HttpAuthService;
  access: TemporalAccessService;
  auditor: AuditorService;
  temporal: TemporalService;
  sources: EntityWorkflowSources;
  commands: WorkflowCommands;
  actions: TemporalControlAction[];
}

/** Longest terminate reason. */
const MAX_REASON_LENGTH = 1000;
/** Longest workflow ID. */
const MAX_WORKFLOW_ID_LENGTH = 1000;

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

/**
 * Routes that change workflows (start, signal, update, cancel, terminate,
 * rerun, custom actions), served under `/api/temporal` next to the plugin's
 * read routes. Every operation is checked with the access service of the
 * plugin and the permission framework, and recorded with the auditor.
 */
export function createControlRouter(
  options: ControlRouterOptions,
): express.Router {
  const { httpAuth, access, auditor, sources, commands } = options;
  const router = Router();
  router.use(express.json());

  /** The workflow of the request's path, with the access checks of `level`. */
  const loadWorkflow = (
    req: Request,
    level: TemporalWorkflowAccessLevel,
  ): Promise<LoadedWorkflow> =>
    loadRequestWorkflow({ httpAuth, access }, req, level);

  /**
   * Checks a control permission on the workflow's entity. A bad entity
   * reference in the workflow's search attribute counts as no entity: the
   * permission must then be allowed for every entity. (The query route
   * answers 400 for it instead.)
   */
  const authorizeControl = (
    permission: ResourcePermission<'catalog-entity'>,
    loaded: LoadedWorkflow,
  ): Promise<string | undefined> =>
    authorizeOnWorkflow(access, permission, loaded, canonicalEntityRef);

  /** A namespace of the path or the body: a valid name that is allowed. */
  function checkNamespace(namespace: string) {
    if (!isValidNamespaceName(namespace)) {
      throw new InputError(`Temporal namespace is not allowed: ${namespace}`);
    }
    sources.checkNamespace(namespace);
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

  router.post(workflowSubpaths('signal'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowSignalPermission,
      loaded,
    );
    const { name, args } = parseMessageBody(req);
    commands.checkSignal(name);
    assertRunning(loaded.workflow);
    await audited(
      auditor,
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

  router.post(workflowSubpaths('update'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowUpdatePermission,
      loaded,
    );
    const { name, args } = parseMessageBody(req);
    commands.checkUpdate(name);
    assertRunning(loaded.workflow);
    const result = await audited(
      auditor,
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

  router.post(workflowSubpaths('cancel'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowCancelPermission,
      loaded,
    );
    assertRunning(loaded.workflow);
    await audited(
      auditor,
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

  router.post(workflowSubpaths('terminate'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowTerminatePermission,
      loaded,
    );
    const reason =
      optionalText(requestBody(req).reason, 'reason', MAX_REASON_LENGTH) ??
      'Terminated from Backstage';
    assertRunning(loaded.workflow);
    await audited(
      auditor,
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

  router.post(workflowSubpaths('rerun'), async (req, res) => {
    const loaded = await loadWorkflow(req, 'read');
    const entityRef = await authorizeControl(
      temporalWorkflowRerunPermission,
      loaded,
    );
    const workflowId = parseWorkflowId(requestBody(req).workflowId);
    const started = await audited(
      auditor,
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

  router.post(workflowSubpaths('actions/:actionId'), async (req, res) => {
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
      auditor,
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
    const b = requestBody(req);
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
      const annotations = readEntityWorkflowFilter(context.entity);
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
        auditor,
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
      checkNamespace(namespace);
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
      let entitySources: TemporalAnnotations[] | undefined;
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
        // The entity and the related entities of the same namespace. The
        // schedule must match one of them (matchesSource): an entity with
        // only a task queue covers every schedule on that queue. This is
        // not the rule of the entity's schedule list, which only shows the
        // schedules of its workflow types.
        const defaultNamespace = sources.defaultNamespace();
        entitySources = [context.entity, ...context.relatedWorkflowEntities]
          .map(readEntityWorkflowFilter)
          .filter(
            source => (source.namespace ?? defaultNamespace) === namespace,
          );
      } else {
        await access.authorizeOn(
          temporalWorkflowStartPermission,
          undefined,
          credentials,
        );
      }
      const schedule = await commands.describeSchedule(namespace, scheduleId);
      if (
        entitySources &&
        !entitySources.some(source => matchesSource(schedule, source))
      ) {
        throw new NotFoundError(
          `Schedule ${scheduleId} does not start a workflow of ${entityRef}`,
        );
      }
      await audited(
        auditor,
        req,
        `schedule-${operation}`,
        {
          namespace,
          scheduleId,
          operation,
          workflowType: schedule.workflowType,
          entityRef,
          ...(note ? { note } : {}),
        },
        'medium',
        () =>
          commands.operateSchedule(schedule, operation, {
            note,
            requestedBy: principalRef(credentials) ?? 'Backstage',
          }),
      );
      res.status(202).json({});
    },
  );

  router.post('/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    if (!(await access.canListAll(credentials))) {
      throw new NotAllowedError();
    }
    await access.authorizeOn(
      temporalWorkflowStartPermission,
      undefined,
      credentials,
    );
    const start = parseStart(req);
    const namespace = start.namespace || sources.defaultNamespace();
    checkNamespace(namespace);
    if (!start.workflowType) throw new InputError('workflowType is required');
    if (!start.taskQueue) throw new InputError('taskQueue is required');
    const { workflowType, taskQueue } = start;
    const started = await audited(
      auditor,
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
