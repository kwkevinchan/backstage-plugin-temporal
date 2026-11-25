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
  SCHEDULES_PATH,
  isTemporalWorkflowEntity,
  mergeWorkflowMessageDefinitions,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  WorkflowDetail,
} from '../common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { TemporalAccessService, TemporalEntityContext } from '../node/alpha';
import { AiWorkflowQueries } from '../services/AiWorkflowQueries';
import { EntityWorkflowSources } from '../services/EntityWorkflowSources';
import {
  LIST_PAGE_SIZE,
  STATS_LIMIT,
  WorkflowListQueries,
} from '../services/WorkflowListQueries';
import {
  HISTORY_PAGE_SIZE,
  WorkflowQueries,
} from '../services/WorkflowQueries';
import {
  basePathOfSpecRequest,
  loadOpenApiSpec,
  openApiSpecFor,
} from './openApiRoutes';
import { decodePageToken } from '../services/convert';
import { parseStatus, workflowIdCondition } from '../services/visibilityQuery';
import {
  entityRefFromParams,
  optionalString,
  parseEntityRefParam,
  parseFlag,
  parseMessageBody,
  parsePageSize,
  workflowIdFromParams,
} from './params';
import {
  audited,
  authorizeOnWorkflow,
  LoadedWorkflow,
  loadRequestWorkflow,
  optionalBodyString,
  requestWorkflowMeta,
  workflowMeta,
  workflowPath,
  workflowRunPath,
  workflowRunSubpath,
} from './shared';

export interface RouterOptions {
  httpAuth: HttpAuthService;
  auditor: AuditorService;
  access: TemporalAccessService;
  sources: EntityWorkflowSources;
  queries: WorkflowQueries;
  lists: WorkflowListQueries;
  ai: AiWorkflowQueries;
  /** False when `temporal.control.enabled` is false. Defaults to true. */
  controlEnabled?: boolean;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, auditor, access, queries, lists, ai } = options;
  const entitySources = options.sources;
  const router = Router();
  router.use(express.json());

  // The API description, for tools that read the specs of the plugins.
  router.get('/openapi.json', async (req, res) => {
    await httpAuth.credentials(req);
    res.json(
      openApiSpecFor(loadOpenApiSpec(), {
        basePath: basePathOfSpecRequest(req.originalUrl),
        controlEnabled: options.controlEnabled ?? true,
      }),
    );
  });

  /** The workflow of the request's path, with the access checks. */
  const loadWorkflow = (req: Request): Promise<LoadedWorkflow> =>
    loadRequestWorkflow({ httpAuth, access }, req);

  router.get('/entities/:kind/:namespace/:name/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const context = await access.loadEntity(
      entityRefFromParams(req),
      temporalWorkflowReadPermission,
      credentials,
    );
    const result = await lists.listEntityWorkflows(context, {
      status: parseStatus(req.query.status),
      allRuns: parseFlag(req.query.allRuns, 'allRuns'),
      searchAttribute:
        optionalString(req.query.searchAttribute, 'searchAttribute') ||
        undefined,
      pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
      pageToken: optionalString(req.query.pageToken, 'pageToken'),
      credentials,
    });
    res.json(result);
  });

  // Schedules of a namespace, for the Workflows page: like the workflow
  // list without an entity, with the list permission for every workflow.
  router.get(SCHEDULES_PATH, async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    if (!(await access.canListAll(credentials))) {
      throw new NotAllowedError(
        'Listing schedules needs temporal.workflow.list without conditions',
      );
    }
    const namespace =
      optionalString(req.query.namespace, 'namespace') ||
      entitySources.defaultNamespace();
    res.json(await lists.listSchedules(namespace));
  });

  // Schedules that start the workflow types of an entity.
  router.get('/entities/:kind/:namespace/:name/schedules', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const context = await access.loadEntity(
      entityRefFromParams(req),
      temporalWorkflowReadPermission,
      credentials,
    );
    const sources = entitySources.workflowSourcesOf(context);
    res.json(
      sources.length > 0
        ? await lists.listSchedules(context.namespace, { sources })
        : { items: [], truncated: false },
    );
  });

  router.get('/workflows', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const namespace =
      optionalString(req.query.namespace, 'namespace') ||
      entitySources.defaultNamespace();
    // Undefined, or the visibility query of a conditional decision.
    const permissionFilter = await access.authorizeWorkflowList(
      namespace,
      credentials,
    );
    const result = await lists.listNamespaceWorkflows(
      namespace,
      {
        status: parseStatus(req.query.status),
        allRuns: parseFlag(req.query.allRuns, 'allRuns'),
        workflowType:
          optionalString(req.query.workflowType, 'workflowType') || undefined,
        workflowIdPrefix:
          optionalString(req.query.workflowId, 'workflowId')?.trim() ||
          undefined,
        searchAttribute:
          optionalString(req.query.searchAttribute, 'searchAttribute') ||
          undefined,
        permissionFilter,
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
      res.json(await lists.stats(context, { limit }));
    },
  );

  // The runs of one workflow ID, in the order of Temporal's visibility
  // store. Every run is listed with the full permission check of the list
  // it comes from: the entity's list with `entityRef`, else the namespace
  // list with the list permission and its conditions.
  router.get(workflowPath, async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const { namespace, workflowId } = workflowIdFromParams(req);
    // Refuses IDs that a visibility query cannot match.
    workflowIdCondition(workflowId);
    const page = {
      pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
      pageToken: optionalString(req.query.pageToken, 'pageToken'),
    };
    const entityRef = parseEntityRefParam(req.query.entityRef);
    if (entityRef) {
      const context = await access.loadEntity(
        entityRef,
        temporalWorkflowReadPermission,
        credentials,
      );
      if (context.namespace !== namespace) {
        throw new NotFoundError(
          `Workflow ${workflowId} was not found for ${entityRef}`,
        );
      }
      res.json(
        await lists.listEntityWorkflows(context, {
          workflowId,
          ...page,
          credentials,
        }),
      );
      return;
    }
    // Undefined, or the visibility query of a conditional decision.
    const permissionFilter = await access.authorizeWorkflowList(
      namespace,
      credentials,
    );
    const result = await lists.listNamespaceWorkflows(
      namespace,
      { workflowId, permissionFilter },
      page,
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

  router.get(workflowRunPath, async (req, res) => {
    const { credentials, context, matchedEntityRef, workflow } =
      await loadWorkflow(req);
    const workflowWithEntity =
      matchedEntityRef && matchedEntityRef !== context?.entityRef
        ? { ...workflow, workflowEntityRef: matchedEntityRef }
        : workflow;
    const detail = context
      ? await queries.enrichDetail(workflowWithEntity, context, credentials)
      : workflowWithEntity;
    res.json(detail);
  });

  router.get(workflowRunSubpath('history'), async (req, res) => {
    const pageSize = parsePageSize(req.query.pageSize, HISTORY_PAGE_SIZE);
    const pageToken = optionalString(req.query.pageToken, 'pageToken');
    try {
      decodePageToken(pageToken);
    } catch {
      throw new InputError('Invalid page token');
    }
    const { ref, workflow } = await loadWorkflow(req);
    res.json(
      await queries.history(
        { ...ref, runId: workflow.runId },
        { pageSize, pageToken },
      ),
    );
  });

  router.get(workflowRunSubpath('result'), async (req, res) => {
    const { workflow } = await loadWorkflow(req);
    res.json(await queries.result(workflow));
  });

  router.get(workflowRunSubpath('graph'), async (req, res) => {
    const { workflow } = await loadWorkflow(req);
    const graph = await queries.graph(workflow);
    if (graph.runChain) {
      graph.runChain = await queries.runPosition(workflow, graph.runChain);
    }
    res.json(graph);
  });

  // The full record of one model call: messages, reasoning, tool calls.
  // `index` picks a later call of a step that made several.
  router.get(workflowRunSubpath('llm-calls/:eventId'), async (req, res) => {
    const eventId = req.params.eventId;
    if (!/^\d{1,19}$/.test(eventId)) throw new InputError('Invalid eventId');
    const index = optionalString(req.query.index, 'index') ?? '0';
    if (!/^\d{1,4}$/.test(index)) throw new InputError('Invalid index');
    const { workflow } = await loadWorkflow(req);
    res.json(await ai.llmCall(workflow, eventId, Number(index)));
  });

  router.get(workflowRunSubpath('progress'), async (req, res) => {
    const { workflow } = await loadWorkflow(req);
    res.json(await lists.progress(workflow));
  });

  // The signals, updates and queries a workflow defines (for the operation
  // dialogs), with what its TemporalWorkflow entity describes in
  // spec.messages. The backend runs the metadata query itself, so the read
  // permission is enough.
  router.get(workflowRunSubpath('message-definitions'), async (req, res) => {
    const { workflow, context, credentials } = await loadWorkflow(req);
    const [reported, entity] = await Promise.all([
      queries.messageDefinitions(workflow),
      workflowEntityOf(workflow, context, credentials),
    ]);
    res.json(
      mergeWorkflowMessageDefinitions(
        reported,
        getTemporalWorkflowMessages(entity),
      ),
    );
  });

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
  router.post(workflowRunSubpath('query'), async (req, res) => {
    const initialName = optionalBodyString(req, 'name');
    const result = await audited(
      auditor,
      req,
      'workflow-query',
      requestWorkflowMeta(req, initialName ? { name: initialName } : {}),
      'medium',
      async setMeta => {
        const loaded = await loadWorkflow(req);
        const { name, args } = parseMessageBody(req);
        const entityRef = await authorizeOnWorkflow(
          access,
          temporalWorkflowQueryPermission,
          loaded,
        );
        setMeta(workflowMeta(loaded.workflow, entityRef, { name }));
        return queries.query(loaded.workflow, name, args);
      },
    );
    res.json({ result });
  });

  return router;
}
