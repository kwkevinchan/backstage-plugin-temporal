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
  Entity,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import {
  InvalidTemporalAnnotationError,
  InvalidTemporalWorkflowSpecError,
  getTemporalWorkflowSource,
  WorkflowRef,
  WorkflowSummary,
} from '../common';
import { Request } from 'express';

// Parsing and validation of request parameters.

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InputError(`Invalid ${name}`);
  return value;
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

/**
 * The workflow types and task queue of an entity: the spec of a
 * `TemporalWorkflow` entity, the annotations of any other entity.
 */
export function entityWorkflowSource(entity: Entity): {
  namespace?: string;
  taskQueue?: string;
  workflowTypes: string[];
} {
  try {
    return getTemporalWorkflowSource(entity);
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

/** True when a workflow has the entity's task queue and one of its types. */
export function matchesSource(
  workflow: Pick<WorkflowSummary, 'taskQueue' | 'workflowType'>,
  source: { taskQueue?: string; workflowTypes: string[] },
): boolean {
  const hasFilter =
    Boolean(source.taskQueue) || source.workflowTypes.length > 0;
  if (!hasFilter) return false;
  if (source.taskQueue && workflow.taskQueue !== source.taskQueue) {
    return false;
  }
  if (
    source.workflowTypes.length > 0 &&
    !source.workflowTypes.includes(workflow.workflowType)
  ) {
    return false;
  }
  return true;
}
