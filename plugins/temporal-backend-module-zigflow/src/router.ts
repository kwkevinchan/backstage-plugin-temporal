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
  HttpAuthService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import {
  getTemporalWorkflowDefinitionSpec,
  isTemporalWorkflowEntity,
  temporalWorkflowReadPermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import express, { Request } from 'express';
import Router from 'express-promise-router';
import { DefinitionReader } from './service/definition';

/** @internal */
export interface RouterOptions {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  catalog: CatalogService;
  definitions: DefinitionReader;
}

function entityRefFromParams(req: Request): string {
  try {
    return stringifyEntityRef({
      kind: req.params.kind,
      namespace: req.params.namespace,
      name: req.params.name,
    });
  } catch {
    throw new InputError('Invalid entity reference');
  }
}

/**
 * The definition route, mounted under `/api/temporal` next to the routes
 * of the Temporal backend plugin.
 *
 * @internal
 */
export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, permissions, catalog, definitions } = options;
  const router = Router();

  async function authorize(
    entityRef: string,
    credentials: BackstageCredentials,
  ) {
    const [decision] = await permissions.authorize(
      [{ permission: temporalWorkflowReadPermission, resourceRef: entityRef }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError();
    }
  }

  // The definition file of a TemporalWorkflow entity. It describes the
  // workflow, without inputs or results, so the read permission is enough.
  router.get(
    '/entities/:kind/:namespace/:name/definition',
    async (req, res) => {
      const credentials = await httpAuth.credentials(req);
      const entityRef = entityRefFromParams(req);
      await authorize(entityRef, credentials);
      const entity = await catalog.getEntityByRef(entityRef, { credentials });
      if (!entity || !isTemporalWorkflowEntity(entity)) {
        throw new NotFoundError(`No TemporalWorkflow entity ${entityRef}`);
      }
      let spec;
      try {
        spec = getTemporalWorkflowDefinitionSpec(entity);
      } catch (error) {
        throw new InputError(
          error instanceof Error ? error.message : 'Invalid spec.definition',
        );
      }
      if (!spec) {
        throw new NotFoundError(`${entityRef} has no spec.definition`);
      }
      res.json(await definitions.read(entity, spec));
    },
  );

  return router;
}
