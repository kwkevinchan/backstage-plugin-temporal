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

import { createPermission } from '@backstage/plugin-permission-common';

/** Resource type of catalog entities, owned by the catalog plugin. */
const RESOURCE_TYPE_CATALOG_ENTITY = 'catalog-entity';

/**
 * Read the workflow list and workflow details of an entity.
 *
 * @public
 */
export const temporalWorkflowReadPermission = createPermission({
  name: 'temporal.workflow.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/**
 * Read the event history of an entity's workflows. History events contain
 * workflow inputs and results.
 *
 * @public
 */
export const temporalWorkflowHistoryReadPermission = createPermission({
  name: 'temporal.workflow.history.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/**
 * Every permission of the Temporal plugin.
 *
 * @public
 */
export const temporalPermissions = [
  temporalWorkflowReadPermission,
  temporalWorkflowHistoryReadPermission,
];
