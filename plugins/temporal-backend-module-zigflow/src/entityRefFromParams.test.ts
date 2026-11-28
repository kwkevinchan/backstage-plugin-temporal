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

import type { Request } from 'express';
// The rule of the core plugin is not public, so the test reads it from its source.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import { entityRefFromParams as coreEntityRefFromParams } from '../../temporal-backend/src/routes/params';
import { entityRefFromParams } from './router';

const outcome = (read: () => string) => {
  try {
    return { ref: read() };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
};

describe('entityRefFromParams', () => {
  it('reads the entity of the path like the routes of the core plugin', () => {
    const cases: Record<string, string>[] = [
      { kind: 'TemporalWorkflow', namespace: 'default', name: 'flow' },
      { kind: 'component', namespace: 'team a', name: 'order/flow' },
      { kind: '', namespace: 'default', name: 'flow' },
      { kind: 'component', namespace: '', name: 'flow' },
      { kind: 'component', namespace: 'default', name: '' },
      { namespace: 'default', name: 'flow' },
    ];
    for (const params of cases) {
      const req = { params } as unknown as Request;
      expect(outcome(() => entityRefFromParams(req))).toEqual(
        outcome(() => coreEntityRefFromParams(req)),
      );
    }
    expect(
      outcome(() => entityRefFromParams({ params: cases[0] } as any)),
    ).toEqual({ ref: 'temporalworkflow:default/flow' });
  });
});
