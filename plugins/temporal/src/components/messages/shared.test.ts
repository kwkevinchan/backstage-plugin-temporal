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

import type { JsonValue } from '@backstage/types';
import { exampleArgs } from '../../common';
import { argsText, parseArgs } from './shared';

describe('the arguments field', () => {
  it('reads an array as the argument list and any other value as the only argument, like an example', () => {
    for (const value of [[1, 'a'], [[1]], { a: 1 }, 'x', 1, null, []]) {
      expect(parseArgs(JSON.stringify(value))).toEqual({
        args: exampleArgs(value as JsonValue),
      });
    }
    expect(parseArgs('')).toEqual({ args: [] });
  });

  it('reads back the arguments it shows', () => {
    const lists: JsonValue[][] = [
      [],
      [{ a: 1 }],
      [[1, 2]],
      ['x'],
      [null],
      [1, 'a'],
      [[1], [2]],
    ];
    for (const args of lists) {
      expect(parseArgs(argsText(args))).toEqual({ args });
    }
  });
});
