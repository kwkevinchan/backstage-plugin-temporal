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

import { InputError } from '@backstage/errors';
import {
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  TemporalAnnotations,
  WORKFLOW_STATUSES,
  WorkflowStatus,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';

const ENTITY_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,511}$/;
const SEARCH_ATTRIBUTE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Parses a status query parameter; rejects anything outside the list. */
export function parseStatus(value: unknown): WorkflowStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !(WORKFLOW_STATUSES as readonly string[]).includes(value)
  ) {
    throw new InputError(
      `Invalid status, expected one of ${WORKFLOW_STATUSES.join(', ')}`,
    );
  }
  return value as WorkflowStatus;
}

function quote(value: string): string {
  // Values are validated before they get here; this is a second guard.
  if (/['"\\\s()]/.test(value)) {
    throw new InputError('Value is not allowed in a workflow query');
  }
  return `'${value}'`;
}

export interface EntityWorkflowFilter {
  annotations: TemporalAnnotations;
  entityRef: string;
  /** Name of the entity reference search attribute, if configured. */
  entityRefAttribute?: string;
}

/**
 * Builds the visibility query for an entity's workflows:
 * `(TaskQueue = 'q' AND WorkflowType IN ('a', 'b')) OR (BackstageEntityRef = 'ref')`,
 * plus an optional status condition.
 */
export function buildEntityWorkflowQuery(
  filter: EntityWorkflowFilter,
  options?: { status?: WorkflowStatus },
): string {
  const { annotations, entityRef, entityRefAttribute } = filter;
  const byAnnotations: string[] = [];
  if (annotations.taskQueue) {
    if (!isValidTaskQueueName(annotations.taskQueue)) {
      throw new InputError('Invalid task queue');
    }
    byAnnotations.push(`TaskQueue = ${quote(annotations.taskQueue)}`);
  }
  if (annotations.workflowTypes.length > 0) {
    for (const type of annotations.workflowTypes) {
      if (!isValidWorkflowTypeName(type)) {
        throw new InputError('Invalid workflow type');
      }
    }
    byAnnotations.push(
      annotations.workflowTypes.length === 1
        ? `WorkflowType = ${quote(annotations.workflowTypes[0])}`
        : `WorkflowType IN (${annotations.workflowTypes
            .map(quote)
            .join(', ')})`,
    );
  }

  const alternatives: string[] = [];
  if (byAnnotations.length > 0) {
    alternatives.push(byAnnotations.join(' AND '));
  }
  if (entityRefAttribute) {
    if (!SEARCH_ATTRIBUTE_PATTERN.test(entityRefAttribute)) {
      throw new InputError('Invalid search attribute name');
    }
    if (!ENTITY_REF_PATTERN.test(entityRef)) {
      throw new InputError('Invalid entity reference');
    }
    alternatives.push(`${entityRefAttribute} = ${quote(entityRef)}`);
  }
  if (alternatives.length === 0) {
    throw new InputError(
      'The entity needs a temporal.io/task-queue or temporal.io/workflow-type annotation, or temporal.searchAttributes.entityRef must be configured',
    );
  }

  let query =
    alternatives.length === 1
      ? alternatives[0]
      : alternatives.map(a => `(${a})`).join(' OR ');
  if (options?.status) {
    query = `(${query}) AND ExecutionStatus = ${quote(options.status)}`;
  }
  return query;
}

/**
 * True when a workflow belongs to the entity by the same rules as
 * {@link buildEntityWorkflowQuery}. Used before showing a single workflow.
 */
export function workflowBelongsToEntity(
  workflow: Pick<WorkflowSummary, 'taskQueue' | 'workflowType' | 'entityRef'>,
  filter: EntityWorkflowFilter,
): boolean {
  const { annotations, entityRef, entityRefAttribute } = filter;
  if (entityRefAttribute && workflow.entityRef === entityRef) {
    return true;
  }
  const hasAnnotationFilter =
    Boolean(annotations.taskQueue) || annotations.workflowTypes.length > 0;
  if (!hasAnnotationFilter) return false;
  if (annotations.taskQueue && workflow.taskQueue !== annotations.taskQueue) {
    return false;
  }
  if (
    annotations.workflowTypes.length > 0 &&
    !annotations.workflowTypes.includes(workflow.workflowType)
  ) {
    return false;
  }
  return true;
}
