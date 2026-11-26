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
  ConflictError,
  InputError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import {
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
  WorkflowUpdateRPCTimeoutOrCancelledError,
} from '@temporalio/client';

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_ALREADY_EXISTS = 6;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_UNAUTHENTICATED = 16;
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_NOT_FOUND = 5;
const GRPC_RESOURCE_EXHAUSTED = 8;
const GRPC_UNAVAILABLE = 14;

/**
 * The gRPC status code and message of a Temporal error. The raw service
 * calls throw the gRPC error itself; the client's higher-level APIs (the
 * schedule client) wrap it in a `ServiceError` with the gRPC error as
 * `cause`.
 */
export function grpcErrorOf(error: unknown): {
  code: unknown;
  message: string;
} {
  const message = (error as Error)?.message ?? String(error);
  const own = (error as { code?: unknown })?.code;
  if (own !== undefined) return { code: own, message };
  const cause = (error as { cause?: { code?: unknown; details?: unknown } })
    ?.cause;
  if (cause?.code === undefined) return { code: undefined, message };
  const details = typeof cause.details === 'string' ? cause.details : '';
  return {
    code: cause.code,
    message: details ? `${message}: ${details}` : message,
  };
}

/** Names of the errors of `@backstage/errors` that have an HTTP status. */
const BACKSTAGE_ERRORS = new Set([
  'InputError',
  'AuthenticationError',
  'NotAllowedError',
  'NotFoundError',
  'ConflictError',
  'NotModifiedError',
  'NotImplementedError',
  'ServiceUnavailableError',
]);

/** Names of the gRPC status codes, as they appear in log fields. */
const GRPC_STATUS_NAMES: Record<number, string> = {
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
};

/** gRPC statuses that the user causes, not the server or its credentials. */
const USER_CAUSED_STATUSES = new Set([
  GRPC_NOT_FOUND,
  GRPC_INVALID_ARGUMENT,
  GRPC_ALREADY_EXISTS,
  GRPC_FAILED_PRECONDITION,
]);

/** Errors of the Temporal client that the user's request causes. */
const USER_CAUSED_ERRORS = new Set([
  'ScheduleNotFoundError',
  'NamespaceNotFoundError',
  'WorkflowNotFoundError',
  'WorkflowUpdateFailedError',
]);

/**
 * What to log about a failed call to Temporal: the gRPC status (read before
 * the error is mapped, because the mapped error keeps neither), the name of
 * the error and the log level. A failure that the server or the backend's
 * credentials cause is a `warn`; one that the user's request causes is a
 * `debug`. A query that no worker answers in time is the user's workflow.
 */
export function describeTemporalFailure(
  error: unknown,
  options: { query?: boolean } = {},
): {
  level: 'warn' | 'debug';
  errorName: string;
  grpcCode?: number;
  grpcStatus?: string;
} {
  const errorName = error instanceof Error ? error.name : 'Error';
  const { code } = grpcErrorOf(error);
  if (typeof code === 'number') {
    const user =
      USER_CAUSED_STATUSES.has(code) ||
      (code === GRPC_DEADLINE_EXCEEDED && options.query === true);
    return {
      level: user ? 'debug' : 'warn',
      errorName,
      grpcCode: code,
      grpcStatus: GRPC_STATUS_NAMES[code] ?? 'UNKNOWN',
    };
  }
  const user =
    USER_CAUSED_ERRORS.has(errorName) || BACKSTAGE_ERRORS.has(errorName);
  return {
    level: user && errorName !== 'ServiceUnavailableError' ? 'debug' : 'warn',
    errorName,
  };
}

/** The schedule client's error for a schedule that does not exist. */
export function isScheduleNotFound(error: unknown): boolean {
  return (error as Error)?.name === 'ScheduleNotFoundError';
}

/** The client's error for a namespace that the server does not have. */
function isNamespaceNotFound(error: unknown): boolean {
  return (error as Error)?.name === 'NamespaceNotFoundError';
}

/** Start of the message of a call that Temporal refused for its rate limit. */
const RATE_LIMITED_MESSAGE = 'Temporal is rate limiting the backend';

/**
 * True for the error that {@link mapTemporalError} makes of a call that
 * Temporal refused for its rate limit (`RESOURCE_EXHAUSTED`).
 */
export function isRateLimitedError(error: unknown): boolean {
  return (
    error instanceof ServiceUnavailableError &&
    error.message.startsWith(RATE_LIMITED_MESSAGE)
  );
}

/** Rethrows a Temporal (gRPC) error as the Backstage error of its HTTP status. */
export function mapTemporalError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (
    code === GRPC_NOT_FOUND ||
    isScheduleNotFound(error) ||
    isNamespaceNotFound(error)
  ) {
    throw new NotFoundError(message);
  }
  if (code === GRPC_INVALID_ARGUMENT) throw new InputError(message);
  if (code === GRPC_UNAVAILABLE) {
    throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
  }
  if (code === GRPC_DEADLINE_EXCEEDED) {
    throw new ServiceUnavailableError(
      `Temporal did not answer in time: ${message}`,
    );
  }
  if (code === GRPC_RESOURCE_EXHAUSTED) {
    // The backend's own connection is rate limited, not the user.
    throw new ServiceUnavailableError(`${RATE_LIMITED_MESSAGE}: ${message}`);
  }
  if (code === GRPC_PERMISSION_DENIED || code === GRPC_UNAUTHENTICATED) {
    // The backend's own credentials, not the user's: a server-side problem.
    throw new ServiceUnavailableError(
      `Temporal refused the credentials of the backend: ${message}`,
    );
  }
  throw error;
}

/**
 * Rethrows an error of opening the connection to Temporal (the first call,
 * or a call after a failed attempt) as a 503, like an unavailable server.
 */
export function mapConnectionError(error: unknown): never {
  const { message } = grpcErrorOf(error);
  throw new ServiceUnavailableError(`Temporal is not reachable: ${message}`);
}

/** Like {@link mapTemporalError}, with the errors of a query. */
export function mapQueryError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (code === GRPC_FAILED_PRECONDITION) throw new ConflictError(message);
  if (code === GRPC_DEADLINE_EXCEEDED) {
    throw new ServiceUnavailableError(`No worker answered in time: ${message}`);
  }
  return mapTemporalError(error);
}

/**
 * For the operations that change workflows and schedules
 * (`WorkflowCommands`): a workflow ID that is taken and a workflow in the
 * wrong state are conflicts. An operation waits for Temporal, not for a
 * worker, so a missed deadline is Temporal's.
 */
export function mapCommandError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (code === GRPC_ALREADY_EXISTS) throw new ConflictError(message);
  if (code === GRPC_FAILED_PRECONDITION) throw new ConflictError(message);
  return mapTemporalError(error);
}

/**
 * Like {@link mapCommandError}, for operations addressed to a workflow chain
 * via `firstExecutionRunId` without a `runId` (terminate, cancel, update):
 * Temporal answers `NOT_FOUND` when the chain has already closed or when the
 * workflow ID now belongs to a different execution chain, both of which are
 * conflicts (`409`) on an opened run.
 */
export function mapChainCommandError(
  workflowId: string,
  error: unknown,
): never {
  const { code, message } = grpcErrorOf(error);
  const details =
    typeof (error as { details?: unknown })?.details === 'string'
      ? (error as { details: string }).details
      : '';
  if (code === GRPC_NOT_FOUND) {
    if (
      /already completed/i.test(message) ||
      /already completed/i.test(details)
    ) {
      throw new ConflictError(`Workflow ${workflowId} has already ended`);
    }
    throw new ConflictError(
      `Workflow ${workflowId} now belongs to a different execution chain`,
    );
  }
  return mapCommandError(error);
}

/**
 * For custom actions: Backstage errors are kept, the errors of the Temporal
 * client become the error of what they mean (a workflow that is not found,
 * an update that failed or did not finish in time), and gRPC errors are
 * mapped like those of the built-in operations. Anything else stays a 500.
 */
export function mapActionError(error: unknown): never {
  if (error instanceof Error && BACKSTAGE_ERRORS.has(error.name)) throw error;
  if (error instanceof WorkflowNotFoundError) {
    throw new NotFoundError(error.message);
  }
  if (error instanceof WorkflowUpdateFailedError) {
    const cause = (error.cause as Error | undefined)?.message;
    throw new InputError(cause ? `${error.message}: ${cause}` : error.message);
  }
  if (error instanceof WorkflowUpdateRPCTimeoutOrCancelledError) {
    throw new ServiceUnavailableError(
      `The update did not finish in time: ${error.message}`,
    );
  }
  if (grpcErrorOf(error).code !== undefined) return mapCommandError(error);
  throw error;
}
