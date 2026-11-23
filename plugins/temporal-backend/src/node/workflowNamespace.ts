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

import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import {
  getTemporalWorkflowSource,
  InvalidTemporalAnnotationError,
  InvalidTemporalWorkflowSpecError,
} from '../common';

/**
 * What {@link resolveWorkflowNamespace} needs.
 *
 * @public
 */
export interface WorkflowNamespaceOptions {
  /** Reads the entity whose namespace is used. */
  catalog: CatalogService;
  /**
   * The namespace that the Temporal backend plugin uses when none is given
   * (`temporal.connection.defaultNamespace`, `default` when unset).
   */
  defaultNamespace: string;
}

/**
 * The namespace of the routes of one workflow: the one given, else the
 * namespace of the entity (read as the user, by the same function the
 * backend uses when it starts the workflow of an entity), else the default
 * one.
 *
 * @public
 */
export async function resolveWorkflowNamespace(
  options: WorkflowNamespaceOptions,
  input: { namespace?: string; entityRef?: string },
  credentials: BackstageCredentials,
): Promise<string> {
  if (input.namespace) return input.namespace;
  if (!input.entityRef) return options.defaultNamespace;
  const entity = await options.catalog.getEntityByRef(input.entityRef, {
    credentials,
  });
  if (!entity) {
    throw new NotFoundError(
      `Cannot read the entity ${input.entityRef} to find its Temporal namespace: it does not exist, or you may not read it. Give namespace to skip this lookup`,
    );
  }
  try {
    return (
      getTemporalWorkflowSource(entity).namespace ?? options.defaultNamespace
    );
  } catch (error) {
    if (
      error instanceof InvalidTemporalAnnotationError ||
      error instanceof InvalidTemporalWorkflowSpecError
    ) {
      throw new InputError(error.message);
    }
    throw error;
  }
}
