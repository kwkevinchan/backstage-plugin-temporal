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

import { AuditorService, HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import {
  SCHEDULES_PATH,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  WORKFLOW_TYPE_OVERVIEW_PATH,
} from '../common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { LIST_PAGE_SIZE } from '../common/listLimits';
import { TemporalAccessService } from '../node/alpha';
import { AiWorkflowQueries } from '../services/AiWorkflowQueries';
import { CatalogWorkflowQueries } from '../services/CatalogWorkflowQueries';
import { EntityWorkflowSources } from '../services/EntityWorkflowSources';
import { WorkflowListQueries } from '../services/WorkflowListQueries';
import { HISTORY_PAGE_SIZE } from '../services/WorkflowHistoryReader';
import { WorkflowQueries } from '../services/WorkflowQueries';
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
  auditor: AuditorService;
  access: TemporalAccessService;
  sources: EntityWorkflowSources;
  queries: WorkflowQueries;
  lists: WorkflowListQueries;
  catalogQueries: CatalogWorkflowQueries;
  ai: AiWorkflowQueries;
}

/**
 * The routes that read workflows. A handler parses the request, checks the
 * caller with the access service and answers with what a query class
 * returns; the rules are in `services/`.
 */
export function createRouter(options: RouterOptions): express.Router {
  const { httpAuth, auditor, access, queries, lists, catalogQueries, ai } =
    options;
  const entitySources = options.sources;
  const router = Router();
  router.use(express.json());

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
    res.json(await lists.listEntitySchedules(context));
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
    const result = await catalogQueries.namespaceWorkflows(
      namespace,
      {
        status: parseStatus(req.query.status),
        allRuns: parseFlag(req.query.allRuns, 'allRuns'),
        workflowType:
          optionalString(req.query.workflowType, 'workflowType') || undefined,
        workflowIdPrefix:
          optionalString(
            req.query.workflowIdPrefix,
            'workflowIdPrefix',
          )?.trim() || undefined,
        searchAttribute:
          optionalString(req.query.searchAttribute, 'searchAttribute') ||
          undefined,
        permissionFilter,
      },
      {
        pageSize: parsePageSize(req.query.pageSize, LIST_PAGE_SIZE),
        pageToken: optionalString(req.query.pageToken, 'pageToken'),
      },
      credentials,
    );
    res.json(result);
  });

  // The numbers of the TemporalWorkflow entities of one page of the
  // Temporal page. The entities the caller may not read are left out.
  router.post(WORKFLOW_TYPE_OVERVIEW_PATH, async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    const entityRefs = parseOverviewEntityRefs(req);
    const refresh = parseOverviewRefresh(req);
    res.json(
      await catalogQueries.overview(entityRefs, credentials, { refresh }),
    );
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
    res.json(
      await catalogQueries.workflowRuns(
        { namespace, workflowId, entityRef },
        page,
        credentials,
      ),
    );
  });

  router.get(workflowRunPath, async (req, res) => {
    res.json(await catalogQueries.detail(await loadWorkflow(req)));
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
    res.json(await queries.graph(workflow));
  });

  // The full record of one model call: messages, reasoning, tool calls.
  router.get(workflowRunSubpath('llm-calls/:eventId'), async (req, res) => {
    const eventId = req.params.eventId;
    if (!/^\d{1,19}$/.test(eventId)) throw new InputError('Invalid eventId');
    const { workflow } = await loadWorkflow(req);
    res.json(await ai.llmCall(workflow, eventId));
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
    res.json(await catalogQueries.messageDefinitions(await loadWorkflow(req)));
  });

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
