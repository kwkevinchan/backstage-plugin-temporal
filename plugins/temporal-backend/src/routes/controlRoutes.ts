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
import type { JsonObject, JsonValue } from '@backstage/types';
import {
  TemporalScheduleOperation,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowStartPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
  WorkflowDetail,
  WorkflowIdReusePolicy,
  WorkflowRunRef,
} from '../common';
import { TemporalService } from '../node';
import { TemporalAccessService, TemporalControlAction } from '../node/alpha';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { WORKFLOW_ID_REUSE_POLICY } from '../repositories/TemporalWriteRepository';
import {
  MAX_WORKFLOW_ID_LENGTH,
  WorkflowChainRef,
  WorkflowCommands,
} from '../services/WorkflowCommands';
import {
  EntityWorkflowSources,
  readEntityWorkflowFilter,
} from '../services/EntityWorkflowSources';
import { ScheduleOwnership } from '../services/ScheduleOwnership';
import { matchesSource } from '../services/visibilityQuery';
import {
  entityRefFromParams,
  isValidControlActionId,
  isValidPathId,
  parseArgs,
  parseEntityRefParam,
  parseMessageBody,
  parseUpdateBody,
  requestBody,
} from './params';
import {
  auditEntityRef,
  audited,
  auditNamespace,
  auditPathId,
  authorizeOnWorkflow,
  INVALID_AUDIT_VALUE,
  LoadedWorkflow,
  loadRequestWorkflow,
  optionalBodyString,
  requestWorkflowMeta,
  workflowMeta,
  workflowRunSubpath,
} from './shared';

interface ControlRouterOptions {
  httpAuth: HttpAuthService;
  access: TemporalAccessService;
  auditor: AuditorService;
  temporal: TemporalService;
  sources: EntityWorkflowSources;
  commands: WorkflowCommands;
  schedules: ScheduleOwnership;
  actions: TemporalControlAction[];
}

/** Longest terminate reason. */
const MAX_REASON_LENGTH = 1000;
/** Longest note of a schedule pause or unpause. */
const MAX_NOTE_LENGTH = 1000;
/** Longest workflow type, task queue and namespace of a start. */
const MAX_START_NAME_LENGTH = 1000;

/**
 * A short text of a request: trimmed, or undefined when it is empty. Throws
 * an InputError (`Invalid <name>`, or `message`) for anything else.
 */
function optionalText(
  value: unknown,
  name: string,
  max: number,
  message = `Invalid ${name}`,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new InputError(message);
  }
  return value.trim() || undefined;
}

function parseWorkflowId(value: unknown): string | undefined {
  return optionalText(value, 'workflowId', MAX_WORKFLOW_ID_LENGTH);
}

function parseWorkflowIdReusePolicy(
  value: unknown,
): WorkflowIdReusePolicy | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !Object.hasOwn(WORKFLOW_ID_REUSE_POLICY, value)
  ) {
    throw new InputError('Invalid workflowIdReusePolicy');
  }
  return value as WorkflowIdReusePolicy;
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
  return optionalText(
    value,
    'note',
    MAX_NOTE_LENGTH,
    `note must be a string of at most ${MAX_NOTE_LENGTH} characters`,
  );
}

function identityOf(credentials: BackstageCredentials): string {
  const ref = principalRef(credentials);
  return ref ? `backstage:${ref}` : 'backstage';
}

function runRef(workflow: WorkflowDetail): WorkflowRunRef {
  return {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
}

function chainMeta(chain: WorkflowChainRef) {
  return chain.firstExecutionRunId
    ? { firstRunId: chain.firstExecutionRunId, scope: 'chain' }
    : { scope: 'run' };
}

function chainRef(workflow: WorkflowDetail): WorkflowChainRef {
  const base = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
  };
  // Without the chain ID the request stays locked to the opened run.
  return workflow.firstRunId
    ? { ...base, firstExecutionRunId: workflow.firstRunId }
    : { ...base, runId: workflow.runId };
}

/**
 * Throws a ConflictError for a run that is not running. For a run that
 * continued as new, the error has the run it continued as in
 * `continuedAsNewRunId` (sent in the error body).
 */
function assertRunning(workflow: WorkflowDetail) {
  if (workflow.status !== 'Running') {
    const error = new ConflictError(
      `Workflow ${workflow.workflowId} is not running (${workflow.status})`,
    );
    throw workflow.continuedAsNewRunId
      ? Object.assign(error, {
          continuedAsNewRunId: workflow.continuedAsNewRunId,
        })
      : error;
  }
}

/** Throws a ConflictError for a run that is still running. */
function assertClosed(workflow: WorkflowDetail) {
  if (workflow.status === 'Running') {
    throw new ConflictError(
      `Workflow ${workflow.workflowId} is still running; only a closed run can be rerun`,
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
  const { httpAuth, access, auditor, sources, commands, schedules } = options;
  const router = Router();
  router.use(express.json());

  /** The workflow of the request's path, with the access checks. */
  const loadWorkflow = (req: Request): Promise<LoadedWorkflow> =>
    loadRequestWorkflow({ httpAuth, access }, req);

  /**
   * Checks a control permission on the workflow's entity. An entity
   * reference in the workflow's search attribute that is bad, or that the
   * workflow does not open with, counts as no entity: the permission must
   * then be allowed for every entity.
   */
  const authorizeControl = (
    permission: ResourcePermission<'catalog-entity'>,
    loaded: LoadedWorkflow,
  ): Promise<string | undefined> =>
    authorizeOnWorkflow(access, permission, loaded);

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

  router.post(workflowRunSubpath('signal'), async (req, res) => {
    const initialName = optionalBodyString(req, 'name');
    await audited(
      auditor,
      req,
      'workflow-signal',
      requestWorkflowMeta(req, initialName ? { name: initialName } : {}),
      'medium',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(
          temporalWorkflowSignalPermission,
          loaded,
        );
        const { name, args } = parseMessageBody(req);
        setMeta(workflowMeta(loaded.workflow, entityRef, { name }));
        commands.checkSignal(name);
        assertRunning(loaded.workflow);
        await commands.signal(
          runRef(loaded.workflow),
          name,
          args,
          identityOf(loaded.credentials),
        );
      },
    );
    res.status(202).json({});
  });

  router.post(workflowRunSubpath('update'), async (req, res) => {
    const initialName = optionalBodyString(req, 'name');
    const result = await audited(
      auditor,
      req,
      'workflow-update',
      requestWorkflowMeta(req, initialName ? { name: initialName } : {}),
      'medium',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(
          temporalWorkflowUpdatePermission,
          loaded,
        );
        const { name, args, updateId } = parseUpdateBody(req);
        const chain = chainRef(loaded.workflow);
        setMeta(
          workflowMeta(loaded.workflow, entityRef, {
            ...chainMeta(chain),
            name,
          }),
        );
        commands.checkUpdate(name);
        return commands.update(
          chain,
          name,
          args,
          identityOf(loaded.credentials),
          updateId,
        );
      },
    );
    res.json({ result });
  });

  router.post(workflowRunSubpath('cancel'), async (req, res) => {
    await audited(
      auditor,
      req,
      'workflow-cancel',
      requestWorkflowMeta(req),
      'medium',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(
          temporalWorkflowCancelPermission,
          loaded,
        );
        const chain = chainRef(loaded.workflow);
        setMeta(workflowMeta(loaded.workflow, entityRef, chainMeta(chain)));
        await commands.cancel(chain, identityOf(loaded.credentials));
      },
    );
    res.status(202).json({});
  });

  router.post(workflowRunSubpath('terminate'), async (req, res) => {
    const initialReason = optionalBodyString(req, 'reason', MAX_REASON_LENGTH);
    await audited(
      auditor,
      req,
      'workflow-terminate',
      requestWorkflowMeta(req, initialReason ? { reason: initialReason } : {}),
      'high',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(
          temporalWorkflowTerminatePermission,
          loaded,
        );
        const reason =
          optionalText(requestBody(req).reason, 'reason', MAX_REASON_LENGTH) ??
          'Terminated from Backstage';
        const chain = chainRef(loaded.workflow);
        setMeta(
          workflowMeta(loaded.workflow, entityRef, {
            ...chainMeta(chain),
            reason,
          }),
        );
        await commands.terminate(chain, reason, identityOf(loaded.credentials));
      },
    );
    res.json({});
  });

  router.post(workflowRunSubpath('rerun'), async (req, res) => {
    const initialWorkflowId = optionalBodyString(
      req,
      'workflowId',
      MAX_WORKFLOW_ID_LENGTH,
    );
    const started = await audited(
      auditor,
      req,
      'workflow-rerun',
      requestWorkflowMeta(
        req,
        initialWorkflowId ? { newWorkflowId: initialWorkflowId } : {},
      ),
      'medium',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(
          temporalWorkflowRerunPermission,
          loaded,
        );
        setMeta(workflowMeta(loaded.workflow, entityRef));
        const workflowId = parseWorkflowId(requestBody(req).workflowId);
        assertClosed(loaded.workflow);
        return commands.rerun(loaded.workflow, {
          workflowId,
          identity: identityOf(loaded.credentials),
          // Keeps the entity of the run; the initiator is the caller.
          searchAttributes: startAttributes(undefined, loaded.credentials),
        });
      },
    );
    res.status(201).json(started);
  });

  router.post(workflowRunSubpath('actions/:actionId'), async (req, res) => {
    const actionId = req.params.actionId;
    const validActionId = isValidControlActionId(actionId);
    const result = await audited(
      auditor,
      req,
      'workflow-action',
      requestWorkflowMeta(req, {
        actionId: validActionId ? actionId : INVALID_AUDIT_VALUE,
      }),
      'medium',
      async setMeta => {
        const action = validActionId
          ? options.actions.find(a => a.id === actionId)
          : undefined;
        if (!action) {
          throw new NotFoundError(`No workflow action ${actionId}`);
        }
        const loaded = await loadWorkflow(req);
        const entityRef = await authorizeControl(action.permission, loaded);
        setMeta(workflowMeta(loaded.workflow, entityRef, { actionId }));
        if (action.filter && !action.filter(loaded.workflow)) {
          throw new ConflictError(
            `Action ${actionId} does not apply to workflow ${loaded.workflow.workflowId}`,
          );
        }
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
        return commands.runAction(loaded.workflow.namespace, client =>
          action.handle(runRef(loaded.workflow), req.body as JsonValue, {
            entity,
            workflow: loaded.workflow,
            firstRunId: loaded.workflow.firstRunId,
            credentials: loaded.credentials,
            client,
          }),
        );
      },
    );
    res.json(result === undefined ? {} : { result });
  });

  function parseStart(req: Request) {
    const b = requestBody(req);
    const workflowType = optionalText(
      b.workflowType,
      'workflowType',
      MAX_START_NAME_LENGTH,
    );
    const taskQueue = optionalText(
      b.taskQueue,
      'taskQueue',
      MAX_START_NAME_LENGTH,
    );
    if (workflowType && !isValidWorkflowTypeName(workflowType)) {
      throw new InputError('Invalid workflowType');
    }
    if (taskQueue && !isValidTaskQueueName(taskQueue)) {
      throw new InputError('Invalid taskQueue');
    }
    return {
      workflowType,
      taskQueue,
      namespace: optionalText(b.namespace, 'namespace', MAX_START_NAME_LENGTH),
      args: parseArgs(b.args),
      workflowId: parseWorkflowId(b.workflowId),
      workflowIdReusePolicy: parseWorkflowIdReusePolicy(
        b.workflowIdReusePolicy,
      ),
    };
  }

  function initialBodyFields(
    req: Request,
    fields: readonly string[],
    base: JsonObject = {},
  ): JsonObject {
    const meta: JsonObject = { ...base };
    for (const field of fields) {
      const value = optionalBodyString(req, field, MAX_WORKFLOW_ID_LENGTH);
      if (value) meta[field] = value;
    }
    return meta;
  }

  router.post(
    '/entities/:kind/:namespace/:name/workflows',
    async (req, res) => {
      const rawEntityRef = `${req.params.kind}:${req.params.namespace}/${req.params.name}`;
      const initialMeta = initialBodyFields(
        req,
        ['workflowType', 'taskQueue', 'workflowId'],
        { entityRef: auditEntityRef(rawEntityRef) ?? INVALID_AUDIT_VALUE },
      );
      const started = await audited(
        auditor,
        req,
        'workflow-start',
        initialMeta,
        'medium',
        async setMeta => {
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
          setMeta({
            namespace: context.namespace,
            workflowType,
            taskQueue,
            entityRef: context.entityRef,
            ...(start.workflowId ? { workflowId: start.workflowId } : {}),
          });
          return commands.start({
            namespace: context.namespace,
            workflowType,
            taskQueue,
            args: start.args,
            workflowId: start.workflowId,
            workflowIdReusePolicy: start.workflowIdReusePolicy,
            identity: identityOf(credentials),
            searchAttributes: startAttributes(context.entityRef, credentials),
          });
        },
      );
      res.status(201).json(started);
    },
  );

  // Pause, unpause or trigger a schedule. Which schedules a caller may
  // operate is decided by `ScheduleOwnership`.
  router.post(
    '/namespaces/:namespace/schedules/:scheduleId/:operation(pause|unpause|trigger)',
    async (req, res) => {
      const { namespace, scheduleId } = req.params;
      const operation = req.params.operation as TemporalScheduleOperation;
      const initialEntityRef = auditEntityRef(req.query.entityRef);
      const initialNote = optionalBodyString(req, 'note', MAX_NOTE_LENGTH);
      const initialMeta: JsonObject = {
        namespace: auditNamespace(namespace),
        scheduleId: auditPathId(scheduleId),
        operation,
        ...(initialEntityRef ? { entityRef: initialEntityRef } : {}),
        ...(initialNote ? { note: initialNote } : {}),
      };
      await audited(
        auditor,
        req,
        `schedule-${operation}`,
        initialMeta,
        'medium',
        async setMeta => {
          const credentials = await httpAuth.credentials(req);
          if (!isValidPathId(scheduleId)) {
            throw new InputError('Invalid schedule ID');
          }
          const note = optionalNote(req.body?.note);
          if (note !== undefined && operation === 'trigger') {
            throw new InputError('A note is only kept by pause and unpause');
          }
          const entityRef = parseEntityRefParam(req.query.entityRef);
          const schedule = await schedules.operable({
            namespace,
            scheduleId,
            entityRef,
            credentials,
          });
          setMeta({
            namespace,
            scheduleId,
            operation,
            workflowType: schedule.workflowType,
            entityRef,
            ...(note ? { note } : {}),
          });
          await commands.operateSchedule(schedule, operation, {
            note,
            requestedBy: principalRef(credentials) ?? 'Backstage',
          });
        },
      );
      res.status(202).json({});
    },
  );

  router.post('/workflows', async (req, res) => {
    const initialMeta = initialBodyFields(req, [
      'namespace',
      'workflowType',
      'taskQueue',
      'workflowId',
    ]);
    const started = await audited(
      auditor,
      req,
      'workflow-start',
      initialMeta,
      'medium',
      async setMeta => {
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
        sources.checkRequestedNamespace(namespace);
        if (!start.workflowType) {
          throw new InputError('workflowType is required');
        }
        if (!start.taskQueue) throw new InputError('taskQueue is required');
        const { workflowType, taskQueue } = start;
        setMeta({
          namespace,
          workflowType,
          taskQueue,
          ...(start.workflowId ? { workflowId: start.workflowId } : {}),
        });
        return commands.start({
          namespace,
          workflowType,
          taskQueue,
          args: start.args,
          workflowId: start.workflowId,
          workflowIdReusePolicy: start.workflowIdReusePolicy,
          identity: identityOf(credentials),
          searchAttributes: startAttributes(undefined, credentials),
        });
      },
    );
    res.status(201).json(started);
  });

  return router;
}
