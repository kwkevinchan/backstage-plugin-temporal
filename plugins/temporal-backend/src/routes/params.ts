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
  CompoundEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import {
  isTemporalWorkflowEntityRef,
  MAX_WORKFLOW_TYPE_OVERVIEW_REFS,
  WorkflowMessageRequest,
  WorkflowRef,
  WorkflowRunRef,
  WorkflowUpdateRequest,
} from '../common';
import { normalizeEntityRef } from '../access/DefaultTemporalAccessService';
import { Request } from 'express';

// Parsing and validation of request parameters, shared by the routes.

/** Longest signal, update or query name accepted. */
const MAX_CONTROL_NAME_LENGTH = 200;

/** Longest update ID accepted. */
const MAX_UPDATE_ID_LENGTH = 200;

/**
 * True for a valid custom action ID: letters, digits, `.`, `_` and `-`,
 * starting with a letter.
 */
export function isValidControlActionId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]{0,99}$/.test(id);
}

export function parsePageSize(
  value: unknown,
  limits: { default: number; max: number },
  name = 'pageSize',
): number {
  if (value === undefined || value === '') return limits.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > limits.max) {
    throw new InputError(`${name} must be between 1 and ${limits.max}`);
  }
  return n;
}

export function optionalString(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputError(`Invalid ${name}`);
  return value;
}

/** `true` or `false`; absent is false. */
export function parseFlag(value: unknown, name: string): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new InputError(`${name} must be true or false`);
}

export function parseEntityRefParam(value: unknown): string | undefined {
  const raw = optionalString(value, 'entityRef');
  if (!raw) return undefined;
  return normalizeEntityRef(raw);
}

export function entityRefFromParams(req: Request): string {
  const compound: CompoundEntityRef = {
    kind: req.params.kind,
    namespace: req.params.namespace,
    name: req.params.name,
  };
  try {
    return stringifyEntityRef(compound);
  } catch {
    throw new InputError('Invalid entity reference');
  }
}

/** Longest workflow ID and run ID of a path. */
export const MAX_PATH_ID_LENGTH = 1000;

/** True for a non-empty path ID within {@link MAX_PATH_ID_LENGTH}. */
export function isValidPathId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_ID_LENGTH
  );
}

/** The workflow ID of the path, without a run. */
export function workflowIdFromParams(
  req: Request,
): Pick<WorkflowRef, 'namespace' | 'workflowId'> {
  const { namespace, workflowId } = req.params;
  if (!isValidPathId(workflowId)) {
    throw new InputError('Invalid workflowId');
  }
  return { namespace, workflowId };
}

/** The run of the path: its workflow ID and run ID. */
export function workflowRunRefFromParams(req: Request): WorkflowRunRef {
  const runId = req.params.runId;
  if (!isValidPathId(runId)) {
    throw new InputError('Invalid runId');
  }
  return { ...workflowIdFromParams(req), runId };
}

/** The JSON object of a request body; no body is an empty object. */
export function requestBody(req: Request): Record<string, unknown> {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('The request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** The `args` of a message or a start: an array, or undefined. */
export function parseArgs(value: unknown): JsonValue[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new InputError('args must be an array of arguments');
  }
  return value as JsonValue[];
}

/** The `name` and `args` of a message body (query, signal, update). */
export function parseMessageBody(req: Request): WorkflowMessageRequest {
  const { name, args } = requestBody(req);
  if (typeof name !== 'string' || !name.trim()) {
    throw new InputError('name is required');
  }
  if (name.length > MAX_CONTROL_NAME_LENGTH) {
    throw new InputError(
      `name must be at most ${MAX_CONTROL_NAME_LENGTH} characters`,
    );
  }
  return { name: name.trim(), args: parseArgs(args) };
}

/** The `name`, `args` and `updateId` of an update body. */
export function parseUpdateBody(req: Request): WorkflowUpdateRequest {
  const message = parseMessageBody(req);
  const { updateId } = requestBody(req);
  if (updateId === undefined || updateId === null) return message;
  if (
    typeof updateId !== 'string' ||
    !updateId.trim() ||
    updateId.length > MAX_UPDATE_ID_LENGTH
  ) {
    throw new InputError(
      `updateId must be a text of 1 to ${MAX_UPDATE_ID_LENGTH} characters`,
    );
  }
  return { ...message, updateId: updateId.trim() };
}

/**
 * The `entityRefs` of an overview body: 1 to
 * {@link MAX_WORKFLOW_TYPE_OVERVIEW_REFS} references of `TemporalWorkflow`
 * entities, in their canonical form, without repeats.
 */
export function parseOverviewEntityRefs(req: Request): string[] {
  const { entityRefs } = requestBody(req);
  if (
    !Array.isArray(entityRefs) ||
    entityRefs.length === 0 ||
    entityRefs.length > MAX_WORKFLOW_TYPE_OVERVIEW_REFS
  ) {
    throw new InputError(
      `entityRefs must be an array of 1 to ${MAX_WORKFLOW_TYPE_OVERVIEW_REFS} entity references`,
    );
  }
  const refs = entityRefs.map(raw => {
    if (typeof raw !== 'string') throw new InputError('Invalid entityRef');
    const ref = normalizeEntityRef(raw);
    if (!isTemporalWorkflowEntityRef(ref)) {
      throw new InputError(`Not a TemporalWorkflow entity: ${ref}`);
    }
    return ref;
  });
  return [...new Set(refs)];
}

/**
 * The `refresh` of an overview request: true reads the numbers again instead
 * of using the ones the backend kept. Absent means false.
 */
export function parseOverviewRefresh(req: Request): boolean {
  const { refresh } = requestBody(req);
  if (refresh === undefined) return false;
  if (typeof refresh !== 'boolean') {
    throw new InputError('refresh must be a boolean');
  }
  return refresh;
}
