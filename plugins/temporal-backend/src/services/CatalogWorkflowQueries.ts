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
  BackstageCredentials,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { NotAllowedError, NotFoundError } from '@backstage/errors';
import {
  getTemporalWorkflowMessages,
  isTemporalWorkflowEntity,
  mergeWorkflowMessageDefinitions,
  parseTemporalWorkflowSpec,
  temporalWorkflowReadPermission,
  WorkflowDetail,
  WorkflowListResponse,
  WorkflowMessageDefinitionsResponse,
  WorkflowTypeOverviewResponse,
} from '../common';
import type { WorkflowTypeEntities } from '../access/WorkflowTypeEntities';
import type {
  TemporalAccessService,
  TemporalEntityContext,
} from '../node/alpha';
import { NamespaceWorkflowFilter } from './visibilityQuery';
import {
  failedOverview,
  OverviewRequestStats,
  WorkflowListQueries,
} from './WorkflowListQueries';
import { WorkflowQueries } from './WorkflowQueries';

/** A run that the access service loaded for a caller. */
export interface OpenedWorkflow {
  credentials: BackstageCredentials;
  workflow: WorkflowDetail;
  /** The entity the run was opened with. */
  context?: TemporalEntityContext;
  /** The entity the run belongs to: `context`'s, or a related one. */
  matchedEntityRef?: string;
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

/**
 * The reads that join workflows with catalog entities: the entity links of
 * runs, the message definitions an entity describes, the numbers of
 * `TemporalWorkflow` entities and the runs of one workflow ID. Unlike the
 * other query classes, it reads the catalog with the caller's credentials,
 * through the access service; each method says which checks it makes and
 * which it leaves to its caller.
 */
export class CatalogWorkflowQueries {
  constructor(
    private readonly access: TemporalAccessService,
    private readonly typeEntities: Pick<WorkflowTypeEntities, 'link'>,
    private readonly queries: WorkflowQueries,
    private readonly lists: WorkflowListQueries,
    private readonly logger: LoggerService,
  ) {}

  /**
   * An opened run with its entity links. `workflowEntityRef` follows the
   * rule of the list: the related entity the run matches directly, else
   * the entity an ancestor matched (a child workflow).
   * `workflowTypeEntityRef` is the entity that describes the workflow type;
   * it is only a link, and is left out when the run has an entity link or
   * was opened with the entity that describes its type.
   */
  async detail(opened: OpenedWorkflow): Promise<WorkflowDetail> {
    const { credentials, context, matchedEntityRef, workflow } = opened;
    const workflowEntityRef =
      (context && this.queries.relatedWorkflowEntity(workflow, context)) ??
      (matchedEntityRef && matchedEntityRef !== context?.entityRef
        ? matchedEntityRef
        : undefined);
    const workflowWithEntity = workflowEntityRef
      ? { ...workflow, workflowEntityRef }
      : workflow;
    // An opened TemporalWorkflow entity already is the entity of the type,
    // unless the run is a child workflow of another type.
    const needsTypeEntity =
      !workflowWithEntity.workflowEntityRef &&
      !(context && describesWorkflowType(context.entity, workflow));
    const [linked] = needsTypeEntity
      ? await this.typeEntities.link(
          [workflowWithEntity],
          workflowWithEntity.namespace,
          credentials,
        )
      : [];
    const typeEntityRef = linked?.workflowTypeEntityRef;
    return typeEntityRef
      ? { ...workflowWithEntity, workflowTypeEntityRef: typeEntityRef }
      : workflowWithEntity;
  }

  /**
   * The signals, updates and queries an opened run defines, with what its
   * `TemporalWorkflow` entity describes in `spec.messages`.
   */
  async messageDefinitions(
    opened: OpenedWorkflow,
  ): Promise<WorkflowMessageDefinitionsResponse> {
    const [reported, entity] = await Promise.all([
      this.queries.messageDefinitions(opened.workflow),
      this.workflowEntityOf(opened),
    ]);
    return mergeWorkflowMessageDefinitions(
      reported,
      getTemporalWorkflowMessages(entity),
    );
  }

  /**
   * The TemporalWorkflow entity of a run that the caller can read: the
   * entity it was opened with, one it depends on, or the one that matches
   * its workflow type and task queue. The entity matched through `dependsOn`
   * comes first: several entities can match the type and task queue.
   */
  private async workflowEntityOf(
    opened: OpenedWorkflow,
  ): Promise<Entity | undefined> {
    const { workflow, context, matchedEntityRef, credentials } = opened;
    if (context && isTemporalWorkflowEntity(context.entity)) {
      return context.entity;
    }
    const matched = matchedEntityRef
      ? context?.relatedWorkflowEntities.find(
          e => stringifyEntityRef(e) === matchedEntityRef,
        )
      : undefined;
    if (matched) return matched;
    const [linked] = await this.typeEntities.link(
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
      const loaded = await this.access.loadEntity(
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

  /**
   * The numbers of `TemporalWorkflow` entities, in the order of
   * `entityRefs`. The entities the caller may not read are left out; one
   * whose workflows cannot be shown gets an item with `error`.
   */
  async overview(
    entityRefs: string[],
    credentials: BackstageCredentials,
    options: { refresh?: boolean } = {},
  ): Promise<WorkflowTypeOverviewResponse> {
    const loaded = await this.access.loadWorkflowEntities(
      entityRefs,
      temporalWorkflowReadPermission,
      credentials,
    );
    const request: OverviewRequestStats = { queueTimeouts: 0 };
    const items = await Promise.all(
      loaded.map(({ entityRef, context, error }) => {
        if (context) {
          return this.lists.overview(context, request, {
            refresh: options.refresh,
          });
        }
        this.logger
          .child({ entityRef })
          .warn('Could not read the workflows of an entity', error as Error);
        return Promise.resolve(failedOverview(entityRef, error));
      }),
    );
    if (request.queueTimeouts > 0) {
      // These rows show "did not answer in time" though no call to Temporal
      // was made for them: the calls waited for the rate limit of the
      // overview (`temporal.overview.maxVisibilityCallsPerSecond`).
      this.logger.warn(
        'The overview of some entities was not read in time: its visibility calls waited in the queue until their deadline',
        { entities: loaded.length, queueTimeouts: request.queueTimeouts },
      );
    }
    return { items };
  }

  /**
   * The workflows of a namespace, with the link to the entity of their
   * workflow type. The caller checks the list permission first
   * (`authorizeWorkflowList`) and passes its conditions in
   * `filter.permissionFilter`.
   */
  async namespaceWorkflows(
    namespace: string,
    filter: NamespaceWorkflowFilter,
    page: { pageSize: number; pageToken?: string },
    credentials: BackstageCredentials,
  ): Promise<WorkflowListResponse> {
    const result = await this.lists.listNamespaceWorkflows(
      namespace,
      filter,
      page,
    );
    return {
      ...result,
      items: await this.typeEntities.link(result.items, namespace, credentials),
    };
  }

  /**
   * The runs of one workflow ID, in the order of Temporal's visibility
   * store, with the full permission check of the list they come from: the
   * entity's list with `entityRef` (the read permission on the entity,
   * whose namespace must be the workflow's), else the namespace list with
   * the list permission and its conditions.
   */
  async workflowRuns(
    ref: { namespace: string; workflowId: string; entityRef?: string },
    page: { pageSize: number; pageToken?: string },
    credentials: BackstageCredentials,
  ): Promise<WorkflowListResponse> {
    const { namespace, workflowId, entityRef } = ref;
    if (entityRef) {
      const context = await this.access.loadEntity(
        entityRef,
        temporalWorkflowReadPermission,
        credentials,
      );
      if (context.namespace !== namespace) {
        throw new NotFoundError(
          `Workflow ${workflowId} was not found for ${entityRef}`,
        );
      }
      return this.lists.listEntityWorkflows(context, { workflowId, ...page });
    }
    // Undefined, or the visibility query of a conditional decision.
    const permissionFilter = await this.access.authorizeWorkflowList(
      namespace,
      credentials,
    );
    return this.namespaceWorkflows(
      namespace,
      { workflowId, permissionFilter },
      page,
      credentials,
    );
  }
}
