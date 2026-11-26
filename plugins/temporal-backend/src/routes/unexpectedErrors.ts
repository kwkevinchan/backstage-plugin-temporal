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
 * Error middleware for the end of the plugin's routes. An error of
 * `@backstage/errors` and an error of the request itself (a body that is not
 * JSON, with a `4xx` status) pass on to Backstage's error handler. Any other
 * error is a `500`: its message may come from Temporal, the SDK or the
 * runtime, so the browser gets a fixed message and the log gets the error
 * with the request's method and path.
 *
 * Express tells an error handler from a request handler by its four
 * parameters, so it is mounted as it is, not inside a router.
 */
export function unexpectedErrorHandler(
  logger: LoggerService,
): express.ErrorRequestHandler {
  return (error, req, _res, next) => {
    const status = (error as { status?: unknown })?.status;
    if (
      error instanceof Error &&
      (BACKSTAGE_ERRORS.has(error.name) ||
        (typeof status === 'number' && status >= 400 && status < 500))
    ) {
      next(error);
      return;
    }
    logger
      .child({ method: req.method, path: req.path })
      .error('Unexpected error in a route', error as Error);
    next(new Error(UNEXPECTED_ERROR_MESSAGE));
  };
}
