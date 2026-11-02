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

import { parseLoopMarker } from './loops';

/** The same examples as in @kwkevinchan/temporal-loop (marker.test.ts). */
const EXAMPLES: [string, ReturnType<typeof parseLoopMarker>][] = [
  ['loop/review/1/draft', { loop: 'review', iteration: 1, step: 'draft' }],
  [
    'loop/review/12/draft/2',
    { loop: 'review', iteration: 12, step: 'draft', occurrence: 2 },
  ],
  ['loop/my%20loop/3/a%2Fb', { loop: 'my loop', iteration: 3, step: 'a/b' }],
  [
    'order-1/loop/fix/2/childStep',
    { loop: 'fix', iteration: 2, step: 'childStep' },
  ],
  ['loop/review/0/draft', undefined],
  ['loop/review/x/draft', undefined],
  ['loop/review/1', undefined],
  ['myloop/review/1/draft', undefined],
  ['loop/%E0%A4%A/1/draft', undefined],
  ['5', undefined],
];

describe('parseLoopMarker', () => {
  it.each(EXAMPLES)('parses %s', (text, marker) => {
    expect(parseLoopMarker(text)).toEqual(marker);
  });

  it('ignores missing IDs', () => {
    expect(parseLoopMarker(undefined)).toBeUndefined();
    expect(parseLoopMarker('')).toBeUndefined();
  });
});
