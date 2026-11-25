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

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  temporalWorkflowListPermission,
  temporalWorkflowReadPermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

/** Environment variable that selects a non-default permission policy for e2e tests. */
export const E2E_POLICY_ENV = 'TEMPORAL_E2E_POLICY';

/** Policy name that denies the workflow read and list permissions. */
export const NO_READ_POLICY = 'no-read';

/** Supported permission policy modes for the example backend. */
export type E2ePolicyName = 'allow-all' | 'no-read';

const DENIED_PERMISSIONS = new Set<string>([
  temporalWorkflowReadPermission.name,
  temporalWorkflowListPermission.name,
]);

/** Resolves the configured permission policy name, defaulting to `allow-all`. */
export function resolveE2ePolicy(value: string | undefined): E2ePolicyName {
  const trimmed = value?.trim();
  if (!trimmed) return 'allow-all';
  if (trimmed === NO_READ_POLICY) return NO_READ_POLICY;
  throw new Error(
    `Unknown ${E2E_POLICY_ENV}="${value}". Expected unset or "${NO_READ_POLICY}".`,
  );
}

/**
 * Permission policy that denies `temporal.workflow.read` and
 * `temporal.workflow.list` for every caller while allowing all other
 * permissions. Used to exercise the workflow views of a user who may see
 * the catalog but no workflows, end to end.
 */
export class NoReadPermissionPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery): Promise<PolicyDecision> {
    if (DENIED_PERMISSIONS.has(request.permission.name)) {
      return { result: AuthorizeResult.DENY };
    }
    return { result: AuthorizeResult.ALLOW };
  }
}

/** Backend module registering {@link NoReadPermissionPolicy}. */
export const noReadPolicyModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'e2e-no-read-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new NoReadPermissionPolicy());
      },
    });
  },
});
