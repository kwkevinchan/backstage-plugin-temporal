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
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import {
  MAX_CONTROL_NAME_LENGTH,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { Request } from 'express';

// Parsing and validation of request parameters, shared by the routes.

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
  try {
    return stringifyEntityRef(parseEntityRef(raw));
  } catch {
    throw new InputError('Invalid entityRef');
  }
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

export function workflowRefFromParams(req: Request): WorkflowRef {
  const { namespace, workflowId, runId } = req.params;
  if (!workflowId || workflowId.length > 1000) {
    throw new InputError('Invalid workflowId');
  }
  return { namespace, workflowId, runId: runId || undefined };
}

/** The `name` and `args` of a message body (`POST .../query`). */
export function parseMessageBody(req: Request): {
  name: string;
  args?: JsonValue[];
} {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new InputError('The request body must be a JSON object');
  }
  const { name, args } = body as Record<string, unknown>;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > MAX_CONTROL_NAME_LENGTH
  ) {
    throw new InputError('name is required');
  }
  if (args !== undefined && args !== null && !Array.isArray(args)) {
    throw new InputError('args must be an array of arguments');
  }
  return {
    name: name.trim(),
    args: (args ?? undefined) as JsonValue[] | undefined,
  };
}
