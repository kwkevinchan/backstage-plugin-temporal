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

import { mapInBatches } from './mapInBatches';

describe('mapInBatches', () => {
  it('runs at most `size` calls at the same time and keeps the order', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });

  it('returns an empty list for no items', async () => {
    expect(await mapInBatches([], 3, async n => n)).toEqual([]);
  });
});
