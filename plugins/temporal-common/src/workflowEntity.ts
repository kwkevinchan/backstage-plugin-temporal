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
import type { JsonValue } from '@backstage/types';
import {
  isValidNamespaceName,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  NAME_PATTERN_SOURCES,
  parseTemporalAnnotations,
  TemporalAnnotations,
} from './annotations';
import {
  temporalWorkflowMessageSchema,
  TemporalWorkflowMessagesSpec,
} from './messages';

/**
 * API version of the `TemporalWorkflow` kind.
 *
 * @public
 */
export const TEMPORAL_WORKFLOW_API_VERSION = 'temporal.io/v1alpha1';

/**
 * Kind of catalog entities that describe one Temporal workflow type.
 *
 * @public
 */
export const TEMPORAL_WORKFLOW_KIND = 'TemporalWorkflow';

/**
 * A `TemporalWorkflow` entity: one workflow type, run by a task queue and
 * owned by a group or user.
 *
 * @public
 */
export interface TemporalWorkflowEntityV1alpha1 extends Entity {
  apiVersion: typeof TEMPORAL_WORKFLOW_API_VERSION;
  kind: typeof TEMPORAL_WORKFLOW_KIND;
  spec: {
    /** Entity reference to the owner, for example `group:default/team-a`. */
    owner: string;
    /** Temporal workflow type name. */
    workflowType: string;
    /** Task queue the workflow runs on. */
    taskQueue?: string;
    /** Temporal namespace; defaults to `temporal.connection.defaultNamespace`. */
    namespace?: string;
    /** Entity reference to the system the workflow belongs to. */
    system?: string;
    /** Lifecycle, like on components: `experimental`, `production`. */
    lifecycle?: string;
    /** Entity references of what the workflow needs, like resources. */
    dependsOn?: string[];
    /**
     * Example arguments, filled in the "Start workflow" dialog: an array of
     * workflow arguments, or one value for a workflow with one argument.
     */
    exampleInput?: JsonValue;
    /**
     * The file of the workflow, for the Definition tab: a workflow DSL file
     * (`serverless-workflow`) drawn as a graph, or the source code
     * (`source`) with the workflow's function marked.
     */
    /**
     * The signals, updates and queries of the workflow: their arguments, for
     * the forms of the operation dialogs.
     */
    messages?: TemporalWorkflowMessagesSpec;
    definition?: {
      /** Format of the file: `serverless-workflow` or `source`. */
      format: string;
      /** Path relative to the entity's file, or an absolute URL. */
      target: string;
      /** `source` only: the function to mark; defaults to the workflow type. */
      symbol?: string;
    };
  };
}

/**
 * JSON schema of the `TemporalWorkflow` kind, for
 * `entityKindSchemaValidator` from `@backstage/catalog-model`. Name patterns
 * are the same as for the Temporal annotations.
 *
 * @public
 */
export const temporalWorkflowEntityV1alpha1Schema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  $id: 'TemporalWorkflowV1alpha1',
  description:
    'A TemporalWorkflow describes one Temporal workflow type: what runs it and who owns it.',
  examples: [
    {
      apiVersion: TEMPORAL_WORKFLOW_API_VERSION,
      kind: TEMPORAL_WORKFLOW_KIND,
      metadata: { name: 'order-workflow' },
      spec: {
        owner: 'group:default/orders-team',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        system: 'shop',
      },
    },
  ],
  allOf: [
    { $ref: 'Entity' },
    {
      type: 'object',
      required: ['spec'],
      properties: {
        apiVersion: { enum: [TEMPORAL_WORKFLOW_API_VERSION] },
        kind: { enum: [TEMPORAL_WORKFLOW_KIND] },
        spec: {
          type: 'object',
          required: ['owner', 'workflowType'],
          additionalProperties: false,
          properties: {
            owner: {
              type: 'string',
              description: 'An entity reference to the owner.',
              minLength: 1,
            },
            workflowType: {
              type: 'string',
              description: 'The Temporal workflow type name.',
              pattern: NAME_PATTERN_SOURCES.workflowType,
            },
            taskQueue: {
              type: 'string',
              description: 'The task queue the workflow runs on.',
              pattern: NAME_PATTERN_SOURCES.taskQueue,
            },
            namespace: {
              type: 'string',
              description:
                'The Temporal namespace. Defaults to the configured default namespace.',
              pattern: NAME_PATTERN_SOURCES.namespace,
            },
            system: {
              type: 'string',
              description:
                'An entity reference to the system the workflow belongs to.',
              minLength: 1,
            },
            lifecycle: {
              type: 'string',
              description: 'The lifecycle state of the workflow.',
              minLength: 1,
            },
            dependsOn: {
              type: 'array',
              description:
                'Entity references of what the workflow needs, like resources.',
              items: { type: 'string', minLength: 1 },
            },
            exampleInput: {
              description:
                'Example arguments for the Start workflow dialog: an array of arguments, or one value for a workflow with one argument.',
            },
            messages: {
              type: 'object',
              description:
                'The signals, updates and queries of the workflow, for the forms of the operation dialogs.',
              additionalProperties: false,
              properties: {
                signals: {
                  type: 'array',
                  items: temporalWorkflowMessageSchema,
                },
                updates: {
                  type: 'array',
                  items: temporalWorkflowMessageSchema,
                },
                queries: {
                  type: 'array',
                  items: temporalWorkflowMessageSchema,
                },
              },
            },
            definition: {
              type: 'object',
              description:
                'The file of the workflow: a workflow DSL file, or its source code.',
              required: ['format', 'target'],
              additionalProperties: false,
              properties: {
                format: {
                  type: 'string',
                  enum: ['serverless-workflow', 'source'],
                  description:
                    'Format of the file: serverless-workflow (CNCF Serverless Workflow DSL 1.0, as run by Zigflow), or source (the source code of a workflow written in code).',
                },
                target: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 2048,
                  description:
                    'Path relative to the file of the entity, or an absolute URL.',
                },
                symbol: {
                  type: 'string',
                  pattern: '^[A-Za-z_$][A-Za-z0-9_$.]{0,199}$',
                  description:
                    'For the source format: the function of the workflow, marked in the file. Defaults to the workflow type.',
                },
              },
            },
          },
        },
      },
    },
  ],
} as const;

/**
 * True for entities of the `TemporalWorkflow` kind (any case).
 *
 * @public
 */
export function isTemporalWorkflowEntity(
  entity: Entity,
): entity is TemporalWorkflowEntityV1alpha1 {
  return (
    entity.kind.toLocaleLowerCase('en-US') ===
    TEMPORAL_WORKFLOW_KIND.toLocaleLowerCase('en-US')
  );
}

/**
 * True for an entity reference that points at a `TemporalWorkflow` entity.
 *
 * @public
 */
export function isTemporalWorkflowEntityRef(entityRef: string): boolean {
  return entityRef
    .toLocaleLowerCase('en-US')
    .startsWith(`${TEMPORAL_WORKFLOW_KIND.toLocaleLowerCase('en-US')}:`);
}

/**
 * Thrown by {@link parseTemporalWorkflowSpec} for a spec that is not valid.
 *
 * @public
 */
export class InvalidTemporalWorkflowSpecError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidTemporalWorkflowSpecError';
    this.field = field;
  }
}

function optionalSpecString(
  spec: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = spec[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidTemporalWorkflowSpecError(
      field,
      `spec.${field} must be a string`,
    );
  }
  return value.trim() || undefined;
}

/**
 * Reads the workflow filter of a `TemporalWorkflow` entity from its spec, with
 * the same name rules as the annotations.
 *
 * @throws {@link InvalidTemporalWorkflowSpecError} for a missing workflow type
 * or a name with characters that are not allowed.
 * @public
 */
export function parseTemporalWorkflowSpec(entity: Entity): TemporalAnnotations {
  const spec = (entity.spec ?? {}) as Record<string, unknown>;
  const workflowType = optionalSpecString(spec, 'workflowType');
  const taskQueue = optionalSpecString(spec, 'taskQueue');
  const namespace = optionalSpecString(spec, 'namespace');
  if (!workflowType) {
    throw new InvalidTemporalWorkflowSpecError(
      'workflowType',
      'spec.workflowType is required',
    );
  }
  if (!isValidWorkflowTypeName(workflowType)) {
    throw new InvalidTemporalWorkflowSpecError(
      'workflowType',
      'Invalid value in spec.workflowType',
    );
  }
  if (taskQueue && !isValidTaskQueueName(taskQueue)) {
    throw new InvalidTemporalWorkflowSpecError(
      'taskQueue',
      'Invalid value in spec.taskQueue',
    );
  }
  if (namespace && !isValidNamespaceName(namespace)) {
    throw new InvalidTemporalWorkflowSpecError(
      'namespace',
      'Invalid value in spec.namespace',
    );
  }
  return { namespace, taskQueue, workflowTypes: [workflowType] };
}

/**
 * The example arguments of a `TemporalWorkflow` entity (`spec.exampleInput`)
 * as an argument list: an array as it is, any other value as the only
 * argument. Undefined when the entity has none.
 *
 * @public
 */
export function getTemporalWorkflowExampleArgs(
  entity: Entity,
): JsonValue[] | undefined {
  if (!isTemporalWorkflowEntity(entity)) return undefined;
  const value = (entity.spec as { exampleInput?: JsonValue } | undefined)
    ?.exampleInput;
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * The workflows of an entity: the spec of a `TemporalWorkflow` entity, the
 * annotations of any other entity. The one rule for which workflows belong
 * to an entity, used by the backend, its modules and the frontend.
 *
 * @throws {@link InvalidTemporalWorkflowSpecError} or
 * {@link InvalidTemporalAnnotationError} for a value that is not allowed.
 * @public
 */
export function getTemporalWorkflowSource(entity: Entity): TemporalAnnotations {
  return isTemporalWorkflowEntity(entity)
    ? parseTemporalWorkflowSpec(entity)
    : parseTemporalAnnotations(entity);
}
