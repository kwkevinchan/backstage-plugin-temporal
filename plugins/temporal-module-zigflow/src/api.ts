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

/** The error when the backend has no definition route. */
export const MODULE_MISSING_MESSAGE =
  'The Temporal backend serves no workflow definitions: add @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow to the backend';

/** True when a response carries a Backstage error body (`{ error }`). */
async function hasErrorBody(response: Response): Promise<boolean> {
  try {
    const body = JSON.parse(await response.text());
    return typeof body?.error?.name === 'string';
  } catch {
    return false;
  }
}

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
  if (response.status === 404 && !(await hasErrorBody(response.clone()))) {
    // No such route: the backend module is not installed.
    throw new Error(MODULE_MISSING_MESSAGE);
  }
  if (!response.ok) throw await ResponseError.fromResponse(response);
  return (await response.json()) as WorkflowDefinitionResponse;
}
