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

import { parseEntityRef } from '@backstage/catalog-model';
import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import {
  buildEntityDefinitionPath,
  WorkflowDefinitionResponse,
} from './common/definition';

/**
 * Reads the definition file of a `TemporalWorkflow` entity from the
 * Temporal backend plugin (the route of
 * `@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`).
 */
export async function loadEntityDefinition(
  apis: { discoveryApi: DiscoveryApi; fetchApi: FetchApi },
  entityRef: string,
): Promise<WorkflowDefinitionResponse> {
  const baseUrl = await apis.discoveryApi.getBaseUrl('temporal');
  const response = await apis.fetchApi.fetch(
    `${baseUrl}${buildEntityDefinitionPath(parseEntityRef(entityRef))}`,
  );
  if (!response.ok) throw await ResponseError.fromResponse(response);
  return (await response.json()) as WorkflowDefinitionResponse;
}
