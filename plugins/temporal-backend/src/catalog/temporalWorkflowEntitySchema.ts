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
  TEMPORAL_WORKFLOW_API_VERSION,
  TEMPORAL_WORKFLOW_KIND,
} from '../common';
import { NAME_PATTERN_SOURCES } from '../common/namePatterns';

/**
 * JSON schema of one entry of `spec.messages`, part of the kind schema.
 */
const temporalWorkflowMessageSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string' },
    inputSchema: {
      type: 'object',
      description: 'JSON Schema of the one argument this message takes.',
    },
    example: {
      description:
        'Example arguments: an array of arguments, or one value for a message with one argument.',
    },
    userField: {
      type: 'string',
      pattern: '^[A-Za-z_$][A-Za-z0-9_$]{0,99}$',
      description:
        "A property of the argument filled with the signed-in user's entity reference.",
    },
  },
} as const;

/**
 * JSON schema of the `TemporalWorkflow` kind, for
 * `entityKindSchemaValidator` from `@backstage/catalog-model`. Name patterns
 * are the same as for the Temporal annotations.
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
              description: 'The file of the workflow: a workflow DSL file.',
              required: ['format', 'target'],
              additionalProperties: false,
              properties: {
                format: {
                  type: 'string',
                  enum: ['serverless-workflow'],
                  description:
                    'Format of the file: serverless-workflow (CNCF Serverless Workflow DSL 1.0, as run by Zigflow).',
                },
                target: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 2048,
                  description:
                    'Path relative to the file of the entity, or an absolute URL.',
                },
              },
            },
          },
        },
      },
    },
  ],
} as const;
