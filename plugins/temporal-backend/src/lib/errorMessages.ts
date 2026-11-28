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

import { ServiceUnavailableError } from '@backstage/errors';

/**
 * The messages of the errors that a failed call to Temporal becomes. They are
 * fixed text: what Temporal or the SDK say (addresses, visibility queries,
 * internal details) is written to the log by `callTemporal`, never sent to
 * the browser.
 */
export const TEMPORAL_ERROR_MESSAGES = {
  notFound: 'Not found in Temporal',
  invalid: 'Temporal rejected the request as invalid',
  alreadyExists: 'The resource already exists in Temporal',
  wrongState: 'The resource is not in a state that allows this',
  notReachable: 'Temporal is not reachable',
  deadline: 'Temporal did not answer in time',
  rateLimited: 'Temporal is rate limiting the backend',
  credentials: 'Temporal refused the credentials of the backend',
  noWorker: 'No worker answered in time',
  queryFailed: 'The workflow failed the query',
  queryRejected: 'The workflow rejected the query',
  updateTimeout: 'The update did not finish in time',
} as const;

/**
 * True for the error that `mapTemporalError` makes of a call that
 * Temporal refused for its rate limit (`RESOURCE_EXHAUSTED`).
 */
export function isRateLimitedError(error: unknown): boolean {
  return (
    error instanceof ServiceUnavailableError &&
    error.message === TEMPORAL_ERROR_MESSAGES.rateLimited
  );
}

/**
 * True for the error that `mapTemporalError` makes of a call that
 * Temporal did not answer within its deadline.
 */
export function isDeadlineError(error: unknown): boolean {
  return (
    error instanceof ServiceUnavailableError &&
    error.message === TEMPORAL_ERROR_MESSAGES.deadline
  );
}
