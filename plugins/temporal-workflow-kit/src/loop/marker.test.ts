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
import { formatLoopMarker, parseLoopMarker } from './marker';

/**
 * Shared examples of the marker format; the backend of the Backstage plugin
 * is tested against the same file.
 */
const EXAMPLES: [string, ReturnType<typeof parseLoopMarker>][] = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../test-fixtures/loop-markers.json'),
    'utf8',
  ),
).examples.map((e: { text: string; marker: unknown }) => [
  e.text,
  e.marker ?? undefined,
]);

describe('loop markers', () => {
  it.each(EXAMPLES)('parses %s', (text, marker) => {
    expect(parseLoopMarker(text)).toEqual(marker);
  });

  it('formats markers that parse back', () => {
    for (const [text, marker] of EXAMPLES) {
      if (!marker || !text.startsWith('loop/')) continue;
      expect(formatLoopMarker(marker)).toBe(text);
    }
  });

  it('rejects empty names and bad rounds', () => {
    expect(() =>
      formatLoopMarker({ loop: '', iteration: 1, step: 'a' }),
    ).toThrow();
    expect(() =>
      formatLoopMarker({ loop: 'a', iteration: 1, step: '' }),
    ).toThrow();
    expect(() =>
      formatLoopMarker({ loop: 'a', iteration: 0, step: 'b' }),
    ).toThrow();
    expect(() =>
      formatLoopMarker({ loop: 'a', iteration: 1.5, step: 'b' }),
    ).toThrow();
  });
});
