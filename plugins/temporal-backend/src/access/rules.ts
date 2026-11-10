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
import { createPermissionRule } from '@backstage/plugin-permission-node';
import {
  isValidNamespaceName,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalWorkflowPermissionResourceRef } from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import { z } from 'zod';
import { inQuery, isValidEntityRefValue } from '../services/query';

const hasWorkflowType = createPermissionRule({
  name: 'HAS_WORKFLOW_TYPE',
  description: 'Allow workflows of one of the given workflow types',
  resourceRef: temporalWorkflowPermissionResourceRef,
  paramsSchema: z.object({
    workflowTypes: z
      .array(z.string())
      .min(1)
      .describe('Workflow types to match at least one of'),
  }),
  apply: (workflow, { workflowTypes }) =>
    workflowTypes.includes(workflow.workflowType),
  toQuery: ({ workflowTypes }) =>
    inQuery('WorkflowType', workflowTypes, isValidWorkflowTypeName),
});

const hasTaskQueue = createPermissionRule({
  name: 'HAS_TASK_QUEUE',
  description: 'Allow workflows that run on one of the given task queues',
  resourceRef: temporalWorkflowPermissionResourceRef,
  paramsSchema: z.object({
    taskQueues: z
      .array(z.string())
      .min(1)
      .describe('Task queues to match at least one of'),
  }),
  apply: (workflow, { taskQueues }) =>
    workflow.taskQueue !== undefined && taskQueues.includes(workflow.taskQueue),
  toQuery: ({ taskQueues }) =>
    inQuery('TaskQueue', taskQueues, isValidTaskQueueName),
});

const inNamespace = createPermissionRule({
  name: 'IN_NAMESPACE',
  description: 'Allow workflows of one of the given Temporal namespaces',
  resourceRef: temporalWorkflowPermissionResourceRef,
  paramsSchema: z.object({
    namespaces: z
      .array(z.string())
      .min(1)
      .describe('Temporal namespaces to match at least one of'),
  }),
  apply: (workflow, { namespaces }) => namespaces.includes(workflow.namespace),
  toQuery: ({ namespaces }) => {
    if (!namespaces.every(isValidNamespaceName)) {
      throw new InputError('Invalid namespace in a condition');
    }
    return { namespaces };
  },
});

const isInitiator = createPermissionRule({
  name: 'IS_INITIATOR',
  description:
    'Allow workflows started by one of the given users, from the search ' +
    'attribute temporal.searchAttributes.initiator. Allows nothing when it ' +
    'is not configured.',
  resourceRef: temporalWorkflowPermissionResourceRef,
  paramsSchema: z.object({
    claims: z
      .array(z.string())
      .min(1)
      .describe(
        'Entity references of users, for example the ownershipEntityRefs of the signed-in user',
      ),
  }),
  apply: (workflow, { claims }) =>
    workflow.initiator !== undefined && claims.includes(workflow.initiator),
  toQuery: ({ claims }) => {
    if (!claims.every(isValidEntityRefValue)) {
      throw new InputError('Invalid entity reference in a condition');
    }
    return { initiators: claims };
  },
});

/**
 * The permission rules of the `temporal-workflow` resource type that the
 * plugin registers.
 *
 * @alpha
 */
export const temporalWorkflowPermissionRules = {
  hasWorkflowType,
  hasTaskQueue,
  inNamespace,
  isInitiator,
};
