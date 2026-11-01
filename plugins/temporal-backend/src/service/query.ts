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
  isValidWorkflowIdPrefix,
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

/** Workflows of a `TemporalWorkflow` entity that the entity depends on. */
export interface RelatedWorkflowSource {
  entityRef: string;
  taskQueue?: string;
  workflowTypes: string[];
}

export interface EntityWorkflowFilter {
  /** Filter of the entity itself: annotations, or the TemporalWorkflow spec. */
  annotations: TemporalAnnotations;
  entityRef: string;
  /** Name of the entity reference search attribute, if configured. */
  entityRefAttribute?: string;
  /** TemporalWorkflow entities the entity depends on, in the same namespace. */
  related?: RelatedWorkflowSource[];
}

/** `TaskQueue = 'q' AND WorkflowType IN (...)`, or undefined without both. */
function sourceCondition(source: {
  taskQueue?: string;
  workflowTypes: string[];
}): string | undefined {
  const parts: string[] = [];
  if (source.taskQueue) {
    if (!isValidTaskQueueName(source.taskQueue)) {
      throw new InputError('Invalid task queue');
    }
    parts.push(`TaskQueue = ${quote(source.taskQueue)}`);
  }
  if (source.workflowTypes.length > 0) {
    for (const type of source.workflowTypes) {
      if (!isValidWorkflowTypeName(type)) {
        throw new InputError('Invalid workflow type');
      }
    }
    parts.push(
      source.workflowTypes.length === 1
        ? `WorkflowType = ${quote(source.workflowTypes[0])}`
        : `WorkflowType IN (${source.workflowTypes.map(quote).join(', ')})`,
    );
  }
  return parts.length > 0 ? parts.join(' AND ') : undefined;
}

/**
 * Builds the visibility query for an entity's workflows:
 * `(TaskQueue = 'q' AND WorkflowType IN ('a', 'b')) OR (BackstageEntityRef = 'ref')`,
 * with one more alternative for each related TemporalWorkflow entity, plus an
 * optional status condition.
 */
export function buildEntityWorkflowQuery(
  filter: EntityWorkflowFilter,
  options?: { status?: WorkflowStatus },
): string {
  const { annotations, entityRef, entityRefAttribute } = filter;
  const related = filter.related ?? [];
  const alternatives: string[] = [];
  for (const source of [annotations, ...related]) {
    const condition = sourceCondition(source);
    if (condition && !alternatives.includes(condition)) {
      alternatives.push(condition);
    }
  }
  if (entityRefAttribute) {
    if (!SEARCH_ATTRIBUTE_PATTERN.test(entityRefAttribute)) {
      throw new InputError('Invalid search attribute name');
    }
    const refs = [entityRef, ...related.map(r => r.entityRef)];
    for (const ref of refs) {
      if (!ENTITY_REF_PATTERN.test(ref)) {
        throw new InputError('Invalid entity reference');
      }
    }
    alternatives.push(
      refs.length === 1
        ? `${entityRefAttribute} = ${quote(refs[0])}`
        : `${entityRefAttribute} IN (${refs.map(quote).join(', ')})`,
    );
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

function matchesSource(
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

/**
 * The related TemporalWorkflow entity that a workflow matches, by its spec
 * or by the entity reference search attribute.
 */
export function matchingWorkflowEntity(
  workflow: Pick<WorkflowSummary, 'taskQueue' | 'workflowType' | 'entityRef'>,
  filter: EntityWorkflowFilter,
): string | undefined {
  for (const source of filter.related ?? []) {
    if (
      (filter.entityRefAttribute && workflow.entityRef === source.entityRef) ||
      matchesSource(workflow, source)
    ) {
      return source.entityRef;
    }
  }
  return undefined;
}

/** Filters of the list of every workflow in a namespace. */
export interface NamespaceWorkflowFilter {
  status?: WorkflowStatus;
  workflowType?: string;
  /** Start of the workflow ID. */
  workflowIdPrefix?: string;
}

/**
 * Builds the visibility query of the namespace-wide list, for example
 * `WorkflowType = 'a' AND WorkflowId STARTS_WITH 'order-'`. Empty without
 * filters (every workflow).
 */
export function buildNamespaceWorkflowQuery(
  filter: NamespaceWorkflowFilter,
): string {
  const parts: string[] = [];
  if (filter.workflowType) {
    if (!isValidWorkflowTypeName(filter.workflowType)) {
      throw new InputError('Invalid workflow type');
    }
    parts.push(`WorkflowType = ${quote(filter.workflowType)}`);
  }
  if (filter.workflowIdPrefix) {
    if (!isValidWorkflowIdPrefix(filter.workflowIdPrefix)) {
      throw new InputError(
        'The workflow ID search may only contain letters, digits and _ . : / -',
      );
    }
    parts.push(`WorkflowId STARTS_WITH ${quote(filter.workflowIdPrefix)}`);
  }
  if (filter.status) {
    parts.push(`ExecutionStatus = ${quote(filter.status)}`);
  }
  return parts.join(' AND ');
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
  return (
    matchesSource(workflow, annotations) ||
    matchingWorkflowEntity(workflow, filter) !== undefined
  );
}
