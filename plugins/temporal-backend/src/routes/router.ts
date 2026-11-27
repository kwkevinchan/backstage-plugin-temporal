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
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import {
  getTemporalWorkflowMessages,
  SCHEDULES_PATH,
  isTemporalWorkflowEntity,
  parseTemporalWorkflowSpec,
  mergeWorkflowMessageDefinitions,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  WORKFLOW_TYPE_OVERVIEW_PATH,
  WorkflowDetail,
  WorkflowTypeOverviewResponse,
} from '../common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { TemporalAccessService, TemporalEntityContext } from '../node/alpha';
import { AiWorkflowQueries } from '../services/AiWorkflowQueries';
import { EntityWorkflowSources } from '../services/EntityWorkflowSources';
import {
  LIST_PAGE_SIZE,
  failedOverview,
  OverviewRequestStats,
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
  parseOverviewEntityRefs,
  parseOverviewRefresh,
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
  logger: LoggerService;
  auditor: AuditorService;
  access: TemporalAccessService;
  sources: EntityWorkflowSources;
  queries: WorkflowQueries;
  lists: WorkflowListQueries;
  ai: AiWorkflowQueries;
  /** False when `temporal.control.enabled` is false. Defaults to true. */
  controlEnabled?: boolean;
}

/** Whether a TemporalWorkflow entity lists the workflow type of the run. */
function describesWorkflowType(
  entity: Entity,
  workflow: WorkflowDetail,
): boolean {
  if (!isTemporalWorkflowEntity(entity)) return false;
  try {
    return parseTemporalWorkflowSpec(entity).workflowTypes.includes(
      workflow.workflowType,
    );
  } catch {
    return false;
  }
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, logger, auditor, access, queries, lists, ai } = options;
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

  // Schedules of a namespace, for the Temporal page: like the workflow
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

  // The numbers of the TemporalWorkflow entities of one page of the
  // Temporal page. The entities the caller may not read are left out.
  router.post(WORKFLOW_TYPE_OVERVIEW_PATH, async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const entityRefs = parseOverviewEntityRefs(req);
    const refresh = parseOverviewRefresh(req);
    const loaded = await access.loadWorkflowEntities(
      entityRefs,
      temporalWorkflowReadPermission,
      credentials,
    );
    const request: OverviewRequestStats = { queueTimeouts: 0 };
    const items = await Promise.all(
      loaded.map(({ entityRef, context, error }) => {
        if (context) return lists.overview(context, request, { refresh });
        logger
          .child({ entityRef })
          .warn('Could not read the workflows of an entity', error as Error);
        return Promise.resolve(failedOverview(entityRef, error));
      }),
    );
    if (request.queueTimeouts > 0) {
      // These rows show "did not answer in time" though no call to Temporal
      // was made for them: the calls waited for the rate limit of the
      // overview (`temporal.overview.maxVisibilityCallsPerSecond`).
      logger.warn(
        'The overview of some entities was not read in time: its visibility calls waited in the queue until their deadline',
        { entities: loaded.length, queueTimeouts: request.queueTimeouts },
      );
    }
    const response: WorkflowTypeOverviewResponse = { items };
    res.json(response);
  });

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
    // The same rule as the list: the related entity a run matches directly,
    // else the entity an ancestor matched (a child workflow).
    const workflowEntityRef =
      (context && queries.relatedWorkflowEntity(workflow, context)) ??
      (matchedEntityRef && matchedEntityRef !== context?.entityRef
        ? matchedEntityRef
        : undefined);
    const workflowWithEntity = workflowEntityRef
      ? { ...workflow, workflowEntityRef }
      : workflow;
    // The entity that describes the workflow type is only shown as a link.
    // An opened TemporalWorkflow entity already is that entity, unless the
    // run is a child workflow of another type.
    const needsTypeEntity =
      !workflowWithEntity.workflowEntityRef &&
      !(context && describesWorkflowType(context.entity, workflow));
    const [linked] = needsTypeEntity
      ? await access.linkWorkflowEntities(
          [workflowWithEntity],
          workflowWithEntity.namespace,
          credentials,
        )
      : [];
    const typeEntityRef = linked?.workflowTypeEntityRef;
    const withTypeEntity = typeEntityRef
      ? { ...workflowWithEntity, workflowTypeEntityRef: typeEntityRef }
      : workflowWithEntity;
    const detail = context
      ? await queries.enrichDetail(withTypeEntity, context, credentials)
      : withTypeEntity;
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
    const { workflow, context, credentials, matchedEntityRef } =
      await loadWorkflow(req);
    const [reported, entity] = await Promise.all([
      queries.messageDefinitions(workflow),
      workflowEntityOf(workflow, context, matchedEntityRef, credentials),
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
   * its workflow type and task queue. The entity matched through `dependsOn`
   * comes first: several entities can match the type and task queue.
   */
  async function workflowEntityOf(
    workflow: WorkflowDetail,
    context: TemporalEntityContext | undefined,
    matchedEntityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<Entity | undefined> {
    if (context && isTemporalWorkflowEntity(context.entity)) {
      return context.entity;
    }
    const matched = matchedEntityRef
      ? context?.relatedWorkflowEntities.find(
          e => stringifyEntityRef(e) === matchedEntityRef,
        )
      : undefined;
    if (matched) return matched;
    const [linked] = await access.linkWorkflowEntities(
      [workflow],
      workflow.namespace,
      credentials,
    );
    const ref = linked?.workflowTypeEntityRef;
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
