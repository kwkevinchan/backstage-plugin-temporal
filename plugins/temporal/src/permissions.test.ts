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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { temporalPermissions } from './common';

/**
 * The permissions are defined in the backend and copied to the frontend
 * (scripts/sync-common.mjs). Both packages are tested against the same list,
 * so a policy written with the backend objects matches what the frontend
 * asks for.
 */
const expected = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../test-fixtures/permissions.json'),
    'utf8',
  ),
).permissions;

describe('permissions (shared list)', () => {
  it('match test-fixtures/permissions.json', () => {
    expect(
      temporalPermissions.map(p => ({
        name: p.name,
        attributes: p.attributes,
        type: p.type,
        ...(p.type === 'resource' ? { resourceType: p.resourceType } : {}),
      })),
    ).toEqual(expected);
  });
});
