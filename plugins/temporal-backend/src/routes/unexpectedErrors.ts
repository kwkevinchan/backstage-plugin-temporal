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

import type { LoggerService } from '@backstage/backend-plugin-api';
import express from 'express';
import { BACKSTAGE_ERRORS } from '../repositories/errors';

/** The message of an error that no route expected. */
export const UNEXPECTED_ERROR_MESSAGE = 'Internal server error';

/**
 * The HTTP status that an error carries, read in the order of Backstage's
 * error handler (`statusCode`, then `status`): `ResponseError` of the catalog
 * and permission clients sets `statusCode`, the body parser sets `status`.
 */
function statusOf(error: unknown): number | undefined {
  for (const field of ['statusCode', 'status']) {
    const value = (error as Record<string, unknown> | undefined)?.[field];
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ) {
      return value;
    }
  }
  return undefined;
}

/**
 * Error middleware for the end of the plugin's own routes. An error of
 * `@backstage/errors` and an error with a status below `500` (a body that is
 * not JSON, a refusal of the permission service) pass on to Backstage's error
 * handler. Any other error is a server error whose message may come from
 * Temporal, the SDK or the runtime: the browser gets a fixed message and the
 * log gets the error with the request's method and path. The status stays
 * the one the error carries (`500` when it carries none).
 *
 * Express tells an error handler from a request handler by its four
 * parameters, so it is mounted as it is.
 */
export function unexpectedErrorHandler(
  logger: LoggerService,
): express.ErrorRequestHandler {
  return (error, req, _res, next) => {
    const status = statusOf(error);
    if (
      error instanceof Error &&
      (BACKSTAGE_ERRORS.has(error.name) ||
        (status !== undefined && status < 500))
    ) {
      next(error);
      return;
    }
    logger
      .child({ method: req.method, path: req.path })
      .error('Unexpected error in a route', error as Error);
    next(
      Object.assign(new Error(UNEXPECTED_ERROR_MESSAGE), {
        ...(status !== undefined ? { statusCode: status } : {}),
      }),
    );
  };
}
