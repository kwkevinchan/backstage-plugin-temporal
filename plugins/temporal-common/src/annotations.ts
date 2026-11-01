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

import type { Entity } from '@backstage/catalog-model';

/**
 * Annotation with the Temporal namespace of an entity's workflows. When it is
 * missing, the backend uses `temporal.connection.defaultNamespace`.
 *
 * @public
 */
export const TEMPORAL_NAMESPACE_ANNOTATION = 'temporal.io/namespace';

/**
 * Annotation with the task queue of an entity's workflows.
 *
 * @public
 */
export const TEMPORAL_TASK_QUEUE_ANNOTATION = 'temporal.io/task-queue';

/**
 * Annotation with the workflow types of an entity, separated by commas.
 *
 * @public
 */
export const TEMPORAL_WORKFLOW_TYPE_ANNOTATION = 'temporal.io/workflow-type';

/**
 * Allowed characters for annotation values. Values end up inside a Temporal
 * visibility query, so quotes, backslashes, spaces and brackets are rejected.
 */
const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const TASK_QUEUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/;
const WORKFLOW_TYPE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,254}$/;

/** @public */
export function isValidNamespaceName(value: string): boolean {
  return NAMESPACE_PATTERN.test(value);
}

/** @public */
export function isValidTaskQueueName(value: string): boolean {
  return TASK_QUEUE_PATTERN.test(value);
}

/** @public */
export function isValidWorkflowTypeName(value: string): boolean {
  return WORKFLOW_TYPE_PATTERN.test(value);
}

/**
 * Parsed Temporal annotations of an entity.
 *
 * @public
 */
export interface TemporalAnnotations {
  namespace?: string;
  taskQueue?: string;
  workflowTypes: string[];
}

/**
 * Thrown by {@link parseTemporalAnnotations} for a value that is not allowed.
 *
 * @public
 */
export class InvalidTemporalAnnotationError extends Error {
  readonly annotation: string;

  constructor(annotation: string, message: string) {
    super(message);
    this.name = 'InvalidTemporalAnnotationError';
    this.annotation = annotation;
  }
}

/**
 * Reads and validates the Temporal annotations of an entity.
 *
 * @throws {@link InvalidTemporalAnnotationError} when a value has characters
 * that are not allowed.
 * @public
 */
export function parseTemporalAnnotations(entity: Entity): TemporalAnnotations {
  const annotations = entity.metadata.annotations ?? {};
  const namespace = annotations[TEMPORAL_NAMESPACE_ANNOTATION]?.trim();
  const taskQueue = annotations[TEMPORAL_TASK_QUEUE_ANNOTATION]?.trim();
  const workflowTypes = (annotations[TEMPORAL_WORKFLOW_TYPE_ANNOTATION] ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  if (namespace && !isValidNamespaceName(namespace)) {
    throw new InvalidTemporalAnnotationError(
      TEMPORAL_NAMESPACE_ANNOTATION,
      `Invalid value in annotation ${TEMPORAL_NAMESPACE_ANNOTATION}`,
    );
  }
  if (taskQueue && !isValidTaskQueueName(taskQueue)) {
    throw new InvalidTemporalAnnotationError(
      TEMPORAL_TASK_QUEUE_ANNOTATION,
      `Invalid value in annotation ${TEMPORAL_TASK_QUEUE_ANNOTATION}`,
    );
  }
  for (const type of workflowTypes) {
    if (!isValidWorkflowTypeName(type)) {
      throw new InvalidTemporalAnnotationError(
        TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
        `Invalid value in annotation ${TEMPORAL_WORKFLOW_TYPE_ANNOTATION}`,
      );
    }
  }

  return {
    namespace: namespace || undefined,
    taskQueue: taskQueue || undefined,
    workflowTypes,
  };
}

/**
 * True when the entity has at least one Temporal annotation. Use it as the
 * condition of the entity tab.
 *
 * @public
 */
export function isTemporalAvailable(entity: Entity): boolean {
  const annotations = entity.metadata.annotations ?? {};
  return Boolean(
    annotations[TEMPORAL_NAMESPACE_ANNOTATION] ||
      annotations[TEMPORAL_TASK_QUEUE_ANNOTATION] ||
      annotations[TEMPORAL_WORKFLOW_TYPE_ANNOTATION],
  );
}
