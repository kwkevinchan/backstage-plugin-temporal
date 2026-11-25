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
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import {
  temporalWorkflowHistoryListPermission,
  temporalWorkflowHistoryReadPermission,
  temporalWorkflowListPermission,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  temporalWorkflowStartPermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import { NoHistoryPermissionPolicy, resolveE2ePolicy } from './e2ePolicy';

describe('resolveE2ePolicy', () => {
  it('defaults to allow-all when unset or blank', () => {
    expect(resolveE2ePolicy(undefined)).toBe('allow-all');
    expect(resolveE2ePolicy('')).toBe('allow-all');
    expect(resolveE2ePolicy('   ')).toBe('allow-all');
  });

  it('returns no-history when configured', () => {
    expect(resolveE2ePolicy('no-history')).toBe('no-history');
    expect(resolveE2ePolicy(' no-history ')).toBe('no-history');
  });

  it('rejects unknown values', () => {
    expect(() => resolveE2ePolicy('deny-all')).toThrow(/TEMPORAL_E2E_POLICY/);
  });
});

describe('NoHistoryPermissionPolicy', () => {
  const policy = new NoHistoryPermissionPolicy();

  it('denies history read and history list permissions', async () => {
    await expect(
      policy.handle({ permission: temporalWorkflowHistoryReadPermission }),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
    await expect(
      policy.handle({ permission: temporalWorkflowHistoryListPermission }),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
  });

  it('allows other temporal and catalog permissions', async () => {
    const catalogRead = createPermission({
      name: 'catalog.entity.read',
      attributes: { action: 'read' },
    });
    for (const permission of [
      temporalWorkflowReadPermission,
      temporalWorkflowListPermission,
      temporalWorkflowQueryPermission,
      temporalWorkflowStartPermission,
      catalogRead,
    ]) {
      await expect(policy.handle({ permission })).resolves.toEqual({
        result: AuthorizeResult.ALLOW,
      });
    }
  });
});
