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

/**
 * Alpha API of the Temporal backend plugin: for backend modules, the access
 * service the plugin and its modules share (`temporalAccessServiceRef`), the
 * control extension point (`temporalControlExtensionPoint`) and the workflow
 * enricher extension point (`temporalWorkflowEnricherExtensionPoint`); for permission policies, the conditions of the
 * `temporal-workflow` resource type; and the default factory of the access
 * service. This entry point does not load the plugin itself.
 *
 * @packageDocumentation
 */

import { createConditionExports } from '@backstage/plugin-permission-node';
import { temporalWorkflowPermissionResourceRef } from './node/alpha';
import { temporalWorkflowPermissionRules } from './access/rules';

export * from './node/alpha';
export { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
export { temporalWorkflowPermissionRules };

const { conditions, createConditionalDecision } = createConditionExports({
  resourceRef: temporalWorkflowPermissionResourceRef,
  rules: temporalWorkflowPermissionRules,
});

/**
 * Conditions of the `temporal-workflow` resource type, for permission
 * policies: `hasWorkflowType`, `hasTaskQueue`, `inNamespace` and
 * `isInitiator`.
 *
 * @alpha
 */
export const temporalWorkflowConditions = conditions;

/**
 * Makes a conditional decision for `temporal.workflow.list` and
 * `temporal.workflow.history.list` from {@link temporalWorkflowConditions}.
 *
 * @alpha
 */
export const createTemporalWorkflowConditionalDecision =
  createConditionalDecision;
