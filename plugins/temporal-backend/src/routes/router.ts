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

import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { temporalWorkflowReadPermission } from '@kwkevinchan/backstage-plugin-temporal-common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import {
  DefaultTemporalAccessService,
  WorkflowAccessLevel,
} from '../access/DefaultTemporalAccessService';
import {
  HISTORY_PAGE_SIZE,
  LIST_PAGE_SIZE,
  STATS_LIMIT,
  WorkflowQueries,
} from '../services/WorkflowQueries';
import { parseStatus } from '../services/query';
import {
  addControlRoutes,
  ControlRouteOptions,
  LoadedWorkflow,
} from './controlRoutes';
import { sendStoredPayload } from './download';
import {
  entityRefFromParams,
  optionalString,
  parseEntityRefParam,
  parseFlag,
  parsePageSize,
  workflowRefFromParams,
} from './params';

export interface RouterOptions {
  httpAuth: HttpAuthService;
  access: DefaultTemporalAccessService;
  queries: WorkflowQueries;
  /** When set, the routes that change workflows are served too. */
  controls?: Omit<
    ControlRouteOptions,
    'httpAuth' | 'access' | 'workflowPaths' | 'loadWorkflow'
  >;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, access, queries } = options;
  const router = Router();
  router.use(express.json());

  /** The workflow of the request's path, with the access checks of `level`. */
  async function loadWorkflow(
    req: Request,
    level: WorkflowAccessLevel,
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
    if (!(await access.canListAll(credentials))) {
      throw new NotAllowedError();
    }
    const namespace =
      optionalString(req.query.namespace, 'namespace') ||
      queries.defaultNamespace();
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
    const { credentials, context, workflow } = await loadWorkflow(req, 'read');
    res.json(
      context
        ? await queries.enrichDetail(workflow, context, credentials)
        : workflow,
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

  if (options.controls) {
    addControlRoutes(router, {
      ...options.controls,
      httpAuth,
      access,
      workflowPaths,
      loadWorkflow,
    });
  }

  return router;
}
