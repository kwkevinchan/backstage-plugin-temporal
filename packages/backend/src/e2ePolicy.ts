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
  temporalWorkflowHistoryListPermission,
  temporalWorkflowHistoryReadPermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

/** Environment variable that selects a non-default permission policy for e2e tests. */
export const E2E_POLICY_ENV = 'TEMPORAL_E2E_POLICY';

/** Policy name that denies workflow history read and list permissions. */
export const NO_HISTORY_POLICY = 'no-history';

/** Supported permission policy modes for the example backend. */
export type E2ePolicyName = 'allow-all' | 'no-history';

const DENIED_HISTORY_PERMISSIONS = new Set<string>([
  temporalWorkflowHistoryReadPermission.name,
  temporalWorkflowHistoryListPermission.name,
]);

/** Resolves the configured permission policy name, defaulting to `allow-all`. */
export function resolveE2ePolicy(value: string | undefined): E2ePolicyName {
  const trimmed = value?.trim();
  if (!trimmed) return 'allow-all';
  if (trimmed === NO_HISTORY_POLICY) return NO_HISTORY_POLICY;
  throw new Error(
    `Unknown ${E2E_POLICY_ENV}="${value}". Expected unset or "${NO_HISTORY_POLICY}".`,
  );
}

/**
 * Permission policy that denies `temporal.workflow.history.read` and
 * `temporal.workflow.history.list` for every caller while allowing all other
 * permissions. Used to exercise redacted payloads and failure details end to end.
 */
export class NoHistoryPermissionPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery): Promise<PolicyDecision> {
    if (DENIED_HISTORY_PERMISSIONS.has(request.permission.name)) {
      return { result: AuthorizeResult.DENY };
    }
    return { result: AuthorizeResult.ALLOW };
  }
}

/** Backend module registering {@link NoHistoryPermissionPolicy}. */
export const noHistoryPolicyModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'e2e-no-history-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new NoHistoryPermissionPolicy());
      },
    });
  },
});
