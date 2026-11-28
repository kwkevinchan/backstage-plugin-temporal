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

import { buildEntityDefinitionPath, walkDefinitionTasks } from './definition';

describe('workflow definitions', () => {
  it('builds the path of a definition', () => {
    expect(
      buildEntityDefinitionPath({
        kind: 'TemporalWorkflow',
        namespace: 'default',
        name: 'Flow',
      }),
    ).toBe('/entities/temporalworkflow/default/flow/definition');
  });

  it('walks the tasks with their pointers and Zigflow task paths', () => {
    const seen: [string, string, boolean, string | undefined][] = [];
    walkDefinitionTasks(
      {
        do: [
          { 'a/b': { set: {} } },
          { t: { try: [{ x: { set: {} } }], catch: { do: [{ y: {} }] } } },
          { f: { fork: { branches: [{ br: { do: [{ z: {} }] } }] } } },
          { l: { for: { in: '${ . }' }, do: [{ s: {} }] } },
          'not a task',
          { two: {}, keys: {} },
        ],
      },
      v => seen.push([v.pointer, v.taskPath.join('.'), v.inFork, v.parent]),
    );
    expect(seen).toEqual([
      ['/do/0/a~1b', 'a/b', false, undefined],
      ['/do/1/t', 't', false, undefined],
      ['/do/1/t/try/0/x', 't.try.x', false, '/do/1/t'],
      ['/do/1/t/catch/do/0/y', 't.catch.y', false, '/do/1/t'],
      ['/do/2/f', 'f', false, undefined],
      ['/do/2/f/fork/branches/0/br', 'f.br', true, '/do/2/f'],
      [
        '/do/2/f/fork/branches/0/br/do/0/z',
        'f.br.z',
        true,
        '/do/2/f/fork/branches/0/br',
      ],
      ['/do/3/l', 'l', false, undefined],
      ['/do/3/l/do/0/s', 'l.s', false, '/do/3/l'],
    ]);
  });
});
