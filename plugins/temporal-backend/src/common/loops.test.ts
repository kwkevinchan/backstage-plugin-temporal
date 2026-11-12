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
import { parseLoopMarker } from './loops';

/**
 * Shared examples of the marker format; the loop helpers of
 * `@kwkevinchan/temporal-workflow-kit/loop` are tested against the same file.
 */
const EXAMPLES: [string, ReturnType<typeof parseLoopMarker>][] = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../test-fixtures/loop-markers.json'),
    'utf8',
  ),
).examples.map((e: { text: string; marker: unknown }) => [
  e.text,
  e.marker ?? undefined,
]);

describe('parseLoopMarker', () => {
  it.each(EXAMPLES)('parses %s', (text, marker) => {
    expect(parseLoopMarker(text)).toEqual(marker);
  });

  it('ignores missing IDs', () => {
    expect(parseLoopMarker(undefined)).toBeUndefined();
    expect(parseLoopMarker('')).toBeUndefined();
  });
});
