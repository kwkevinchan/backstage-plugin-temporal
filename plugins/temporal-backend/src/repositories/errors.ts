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

/** gRPC status codes used to map Temporal errors to HTTP errors. */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_ALREADY_EXISTS = 6;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_UNAUTHENTICATED = 16;
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_FAILED_PRECONDITION = 9;
const GRPC_NOT_FOUND = 5;
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

/** The schedule client's error for a schedule that does not exist. */
export function isScheduleNotFound(error: unknown): boolean {
  return (error as Error)?.name === 'ScheduleNotFoundError';
}

/** The client's error for a namespace that the server does not have. */
function isNamespaceNotFound(error: unknown): boolean {
  return (error as Error)?.name === 'NamespaceNotFoundError';
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
  if (code === GRPC_PERMISSION_DENIED || code === GRPC_UNAUTHENTICATED) {
    // The backend's own credentials, not the user's: a server-side problem.
    throw new ServiceUnavailableError(
      `Temporal refused the credentials of the backend: ${message}`,
    );
  }
  throw error;
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
 * Like the errors of a query, for the operations that change workflows and
 * schedules (`WorkflowCommands`): a workflow ID that is taken is a conflict
 * too.
 */
export function mapCommandError(error: unknown): never {
  const { code, message } = grpcErrorOf(error);
  if (code === GRPC_ALREADY_EXISTS) throw new ConflictError(message);
  return mapQueryError(error);
}
