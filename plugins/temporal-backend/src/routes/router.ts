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
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import {
  getTemporalWorkflowMessages,
  isTemporalWorkflowEntity,
  mergeWorkflowHandlers,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  WorkflowDetail,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import {
  TemporalAccessService,
  TemporalEntityContext,
  TemporalWorkflowAccessLevel,
} from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import {
  HISTORY_PAGE_SIZE,
  LIST_PAGE_SIZE,
  STATS_LIMIT,
  WorkflowQueries,
} from '../services/WorkflowQueries';
import { parseStatus } from '../services/query';
import { normalizeEntityRef } from '../access/DefaultTemporalAccessService';
import { sendStoredPayload } from './download';
import {
  entityRefFromParams,
  optionalString,
  parseEntityRefParam,
  parseFlag,
  parseMessageBody,
  parsePageSize,
  workflowRefFromParams,
} from './params';

export interface RouterOptions {
  httpAuth: HttpAuthService;
  auditor: AuditorService;
  access: TemporalAccessService;
  queries: WorkflowQueries;
}

/** A workflow loaded with the read checks of the access service. */
interface LoadedWorkflow {
  credentials: BackstageCredentials;
  ref: WorkflowRef;
  context?: TemporalEntityContext;
  workflow: WorkflowDetail;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, auditor, access, queries } = options;
  const router = Router();
  router.use(express.json());

  /** The workflow of the request's path, with the access checks of `level`. */
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

  router.get('/entities/:kind/:namespace/:name/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const context = await access.loadEntity(
      entityRefFromParams(req),
      temporalWorkflowReadPermission,
      credentials,
    );
    const result = await queries.listEntityWorkflows(context, {
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
    const namespace =
      optionalString(req.query.namespace, 'namespace') ||
      queries.defaultNamespace();
    // Undefined, or the visibility query of a conditional decision.
    const permissionQuery = await access.authorizeWorkflowList(
      namespace,
      credentials,
    );
    const result = await queries.listNamespaceWorkflows(
      namespace,
      {
        status: parseStatus(req.query.status),
        allRuns: parseFlag(req.query.allRuns, 'allRuns'),
        workflowType:
          optionalString(req.query.workflowType, 'workflowType') || undefined,
        workflowIdPrefix:
          optionalString(req.query.workflowId, 'workflowId')?.trim() ||
          undefined,
        permissionQuery,
      },
      {
        pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
        pageToken: optionalString(req.query.pageToken, 'pageToken'),
      },
    );
    res.json({
      ...result,
      items: await access.linkWorkflowEntities(
        result.items,
        namespace,
        credentials,
      ),
    });
  });

  router.get(
    '/entities/:kind/:namespace/:name/workflow-stats',
    async (req, res) => {
      const credentials = await httpAuth.credentials(req);
      const context = await access.loadEntity(
        entityRefFromParams(req),
        temporalWorkflowReadPermission,
        credentials,
      );
      const limit = parsePageSize(req.query.limit, STATS_LIMIT, 'limit');
      res.json(await queries.stats(context, { limit }));
    },
  );

  const workflowPaths = [
    '/namespaces/:namespace/workflows/:workflowId',
    '/namespaces/:namespace/workflows/:workflowId/runs/:runId',
  ];

  router.get(workflowPaths, async (req, res) => {
    const { credentials, context, ref, workflow } = await loadWorkflow(
      req,
      'read',
    );
    // Described again by the plugin's queries, which resolve a memo stored
    // in External Storage; the access service's copy does not.
    const detail = await queries.describe({ ...ref, runId: workflow.runId });
    res.json(
      context
        ? await queries.enrichDetail(detail, context, credentials)
        : detail,
    );
  });

  router.get(
    workflowPaths.map(p => `${p}/history`),
    async (req, res) => {
      const { ref, workflow } = await loadWorkflow(req, 'history');
      res.json(
        await queries.history(
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
      res.json(await queries.steps({ ...ref, runId: workflow.runId }));
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/graph`),
    async (req, res) => {
      const loaded = await loadWorkflow(req, 'read');
      const { workflow } = loaded;
      // Inputs and results need the history permission; without it the
      // graph is shown without them.
      const includePayloads = await access.canReadPayloads(
        loaded,
        loaded.credentials,
      );
      const graph = await queries.graph(workflow, { includePayloads });
      if (graph.runChain) {
        graph.runChain = await queries.runPosition(workflow, graph.runChain);
      }
      res.json(graph);
    },
  );

  // Loops across the continue-as-new runs. Like the graph, the read
  // permission is enough: rounds, steps and the recorded decisions and
  // scores (memo), no inputs or results.
  router.get(
    workflowPaths.map(p => `${p}/loops`),
    async (req, res) => {
      const { workflow } = await loadWorkflow(req, 'read');
      res.json(await queries.loops(workflow));
    },
  );

  // The full record of one model call: messages, reasoning, tool calls.
  // Like inputs and results, it needs the history permission.
  router.get(
    workflowPaths.map(p => `${p}/llm-calls/:eventId`),
    async (req, res) => {
      const eventId = req.params.eventId;
      if (!/^\d{1,19}$/.test(eventId)) throw new InputError('Invalid eventId');
      const { workflow } = await loadWorkflow(req, 'history');
      res.json(await queries.llmCall(workflow, eventId));
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/progress`),
    async (req, res) => {
      const { workflow } = await loadWorkflow(req, 'read');
      res.json(await queries.progress(workflow));
    },
  );

  router.get(
    workflowPaths.map(p => `${p}/payloads/download`),
    async (req, res) => {
      const key = optionalString(req.query.key, 'key');
      if (!key || key.length > 1024) throw new InputError('Invalid key');
      const { ref, workflow } = await loadWorkflow(req, 'history');
      if (!queries.payloads.configured) {
        throw new NotFoundError('External Storage (S3) is not configured');
      }
      const reference = await queries.findStorageReference(
        { ...ref, runId: workflow.runId },
        key,
      );
      if (!reference) {
        throw new NotFoundError(`No stored payload ${key} in this run`);
      }
      await sendStoredPayload(res, reference, queries.payloads);
    },
  );

  // The signals, updates and queries a workflow defines (for the operation
  // dialogs), with what its TemporalWorkflow entity describes in
  // spec.messages. The backend runs the metadata query itself, so the read
  // permission is enough.
  router.get(
    workflowPaths.map(p => `${p}/handlers`),
    async (req, res) => {
      const { workflow, context, credentials } = await loadWorkflow(
        req,
        'read',
      );
      const [reported, entity] = await Promise.all([
        queries.handlers(workflow),
        workflowEntityOf(workflow, context, credentials),
      ]);
      res.json(
        mergeWorkflowHandlers(reported, getTemporalWorkflowMessages(entity)),
      );
    },
  );

  /**
   * The TemporalWorkflow entity of a run that the caller can read: the
   * entity it was opened with, one it depends on, or the one that matches
   * its workflow type and task queue.
   */
  async function workflowEntityOf(
    workflow: WorkflowDetail,
    context: TemporalEntityContext | undefined,
    credentials: BackstageCredentials,
  ): Promise<Entity | undefined> {
    if (context && isTemporalWorkflowEntity(context.entity)) {
      return context.entity;
    }
    const [linked] = await access.linkWorkflowEntities(
      [workflow],
      workflow.namespace,
      credentials,
    );
    const ref = linked?.workflowEntityRef;
    if (!ref) return undefined;
    const related = context?.relatedWorkflowEntities.find(
      e => stringifyEntityRef(e) === ref,
    );
    if (related) return related;
    try {
      const loaded = await access.loadEntity(
        ref,
        temporalWorkflowReadPermission,
        credentials,
      );
      return loaded.entity;
    } catch (error) {
      if (error instanceof NotAllowedError || error instanceof NotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  // A query chosen by the user. Queries only read the workflow, but run
  // the worker's code: they need temporal.workflow.query on the entity, and
  // are recorded with the auditor.
  router.post(
    workflowPaths.map(p => `${p}/query`),
    async (req, res) => {
      const loaded = await loadWorkflow(req, 'read');
      const { name, args } = parseMessageBody(req);
      const entityRef =
        loaded.context?.entityRef ??
        (loaded.workflow.entityRef
          ? normalizeEntityRef(loaded.workflow.entityRef)
          : undefined);
      await access.authorizeOn(
        temporalWorkflowQueryPermission,
        entityRef,
        loaded.credentials,
      );
      const event = await auditor.createEvent({
        eventId: 'workflow-query',
        severityLevel: 'low',
        request: req,
        meta: {
          namespace: loaded.workflow.namespace,
          workflowId: loaded.workflow.workflowId,
          runId: loaded.workflow.runId,
          workflowType: loaded.workflow.workflowType,
          name,
          ...(entityRef ? { entityRef } : {}),
        },
      });
      try {
        const result = await queries.query(loaded.workflow, name, args);
        await event.success();
        res.json({ result });
      } catch (error) {
        await event.fail({ error: error as Error });
        throw error;
      }
    },
  );

  return router;
}
