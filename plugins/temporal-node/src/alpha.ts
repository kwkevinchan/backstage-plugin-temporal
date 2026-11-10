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

/**
 * Alpha API of the Temporal node library: the access service that the
 * Temporal backend plugin and its modules share.
 *
 * @packageDocumentation
 */

import {
  BackstageCredentials,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type {
  WorkflowDetail,
  WorkflowRef,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * `read` for the details and step graph of a workflow, `history` for its
 * history, inputs and results.
 *
 * @alpha
 */
export type TemporalWorkflowAccessLevel = 'read' | 'history';

/**
 * A catalog entity whose workflows are shown, after the access checks.
 *
 * @alpha
 */
export interface TemporalEntityContext {
  entity: Entity;
  entityRef: string;
  /** The Temporal namespace of the entity's workflows. */
  namespace: string;
  /**
   * The `TemporalWorkflow` entities the entity depends on that the caller
   * has the same permission on. Their workflows count as the entity's.
   */
  relatedWorkflowEntities: Entity[];
}

/**
 * A workflow that passed the access checks.
 *
 * @alpha
 */
export interface TemporalAccessibleWorkflow {
  /**
   * The entity the workflow is shown for. Undefined when it was opened
   * without one (the Workflows page) under the list permissions.
   */
  context?: TemporalEntityContext;
  workflow: WorkflowDetail;
}

/**
 * Decides who may see and change which workflows, with the permission
 * framework and the catalog. The Temporal backend plugin and its modules
 * share one instance; replace its factory to change how access is decided.
 *
 * @alpha
 */
export interface TemporalAccessService {
  /** True when the caller may list and open every workflow. */
  canListAll(credentials: BackstageCredentials): Promise<boolean>;

  /** True when the caller may see the inputs and results of a workflow. */
  canReadPayloads(
    workflow: TemporalAccessibleWorkflow,
    credentials: BackstageCredentials,
  ): Promise<boolean>;

  /**
   * Checks a permission on an entity, or, without an entity, that the
   * policy allows it for every entity (an unconditional ALLOW). Throws
   * `NotAllowedError` otherwise.
   */
  authorizeOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<void>;

  /**
   * Checks the permission on the entity, then reads it (and the
   * `TemporalWorkflow` entities it depends on) with the caller's
   * credentials.
   */
  loadEntity(
    entityRef: string,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<TemporalEntityContext>;

  /**
   * Reads a workflow with every check: the namespace is allowed, the
   * caller has the permission of `level` on the entity it belongs to
   * (`entityRef`, else the entity in its search attribute), or the list
   * permissions when opened without an entity.
   */
  loadWorkflow(
    ref: WorkflowRef,
    options: {
      entityRef?: string;
      level: TemporalWorkflowAccessLevel;
      credentials: BackstageCredentials;
    },
  ): Promise<TemporalAccessibleWorkflow>;

  /**
   * Adds `workflowEntityRef` to runs that match a `TemporalWorkflow`
   * entity the caller can see.
   */
  linkWorkflowEntities(
    items: WorkflowSummary[],
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<WorkflowSummary[]>;
}

/**
 * The access service of the Temporal backend plugin (plugin scope). The
 * default factory comes with `@kwkevinchan/backstage-plugin-temporal-backend`.
 *
 * @alpha
 */
export const temporalAccessServiceRef = createServiceRef<TemporalAccessService>(
  {
    id: 'temporal.access',
    scope: 'plugin',
  },
);
