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
import { parseActivityLoopMarker, parseLoopMarker } from './loops';

/**
 * Shared examples of the marker format; the loop helpers of
 * `@kwkevinchan/temporal-workflow-kit/loop` are tested against the same file.
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

describe('parseLoopMarker', () => {
  it.each(EXAMPLES)('parses %s', (text, marker) => {
    expect(parseLoopMarker(text)).toEqual(marker);
  });

  it('ignores missing IDs', () => {
    expect(parseLoopMarker(undefined)).toBeUndefined();
    expect(parseLoopMarker('')).toBeUndefined();
  });
});

describe('parseActivityLoopMarker', () => {
  // A child workflow ID may end with a marker; an activity ID must start
  // with one (after the llm/ or tool/ prefix of an LLM step).
  it.each(EXAMPLES.filter(([text]) => text.startsWith('loop/')))(
    'parses %s like a child workflow ID',
    (text, marker) => {
      expect(parseActivityLoopMarker(text)).toEqual(marker);
    },
  );

  it('does not read a marker that only ends the ID', () => {
    expect(parseLoopMarker('order-1/loop/fix/2/childStep')).toBeDefined();
    expect(
      parseActivityLoopMarker('order-1/loop/fix/2/childStep'),
    ).toBeUndefined();
    expect(
      parseActivityLoopMarker('tenants/acme/loop/retry/2/charge'),
    ).toBeUndefined();
    expect(
      parseActivityLoopMarker('llm/agent-1/tenants/loop/agent/1/callModel'),
    ).toBeUndefined();
    expect(
      parseActivityLoopMarker('loop/a/loop/retry/2/charge'),
    ).toBeUndefined();
  });

  it('reads the marker after the prefix of an LLM step', () => {
    const step = { loop: 'agent', iteration: 3, step: 'callModel' };
    expect(
      parseActivityLoopMarker('llm/plan%2F1/loop/agent/3/callModel'),
    ).toEqual(step);
    expect(
      parseActivityLoopMarker('tool/r2/toolu_01/loop/agent/3/callModel'),
    ).toEqual(step);
  });

  it('ignores missing IDs', () => {
    expect(parseActivityLoopMarker(undefined)).toBeUndefined();
    expect(parseActivityLoopMarker('')).toBeUndefined();
  });
});
