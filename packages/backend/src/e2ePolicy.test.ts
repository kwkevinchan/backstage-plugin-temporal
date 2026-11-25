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
  temporalWorkflowListPermission,
  temporalWorkflowQueryPermission,
  temporalWorkflowReadPermission,
  temporalWorkflowStartPermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import { NoReadPermissionPolicy, resolveE2ePolicy } from './e2ePolicy';

describe('resolveE2ePolicy', () => {
  it('defaults to allow-all when unset or blank', () => {
    expect(resolveE2ePolicy(undefined)).toBe('allow-all');
    expect(resolveE2ePolicy('')).toBe('allow-all');
    expect(resolveE2ePolicy('   ')).toBe('allow-all');
  });

  it('returns no-read when configured', () => {
    expect(resolveE2ePolicy('no-read')).toBe('no-read');
    expect(resolveE2ePolicy(' no-read ')).toBe('no-read');
  });

  it('rejects unknown values', () => {
    expect(() => resolveE2ePolicy('deny-all')).toThrow(/TEMPORAL_E2E_POLICY/);
    expect(() => resolveE2ePolicy('no-history')).toThrow(/TEMPORAL_E2E_POLICY/);
  });
});

describe('NoReadPermissionPolicy', () => {
  const policy = new NoReadPermissionPolicy();

  it('denies the workflow read and list permissions', async () => {
    await expect(
      policy.handle({ permission: temporalWorkflowReadPermission }),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
    await expect(
      policy.handle({ permission: temporalWorkflowListPermission }),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
  });

  it('allows other temporal and catalog permissions', async () => {
    const catalogRead = createPermission({
      name: 'catalog.entity.read',
      attributes: { action: 'read' },
    });
    for (const permission of [
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
