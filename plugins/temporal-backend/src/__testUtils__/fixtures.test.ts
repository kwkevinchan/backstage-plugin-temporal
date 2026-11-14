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
import { readHistoryFixture } from './fixtures';

describe('readHistoryFixture', () => {
  it('gives times and durations the shape of HistoryEvent.toJSON()', () => {
    const events = readHistoryFixture('event-groups', 'flat').events;
    expect(events[0].eventTime).toEqual({
      seconds: expect.stringMatching(/^\d+$/),
      nanos: expect.any(Number),
    });
    expect(events[0].workflowExecutionStartedEventAttributes).toMatchObject({
      workflowTaskTimeout: { seconds: '10' },
      // A zero duration is an empty message.
      firstWorkflowTaskBackoff: {},
    });
  });

  it('reads whole and fractions of seconds', () => {
    const timers = (name: string) =>
      readHistoryFixture('event-groups', name)
        .events.map(
          (e: any) => e.timerStartedEventAttributes?.startToFireTimeout,
        )
        .filter(Boolean);
    expect(timers('parallel')).toContainEqual({ nanos: 200000000 });
    expect(timers('continue-as-new')).toContainEqual({ seconds: '1' });
  });

  it('leaves payload data alone', () => {
    const raw = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../../test-fixtures/event-groups/flat.json'),
        'utf8',
      ),
    ).events;
    const events = readHistoryFixture('event-groups', 'flat').events;
    const payloads = (list: any[]) =>
      list.flatMap(e => JSON.stringify(e).match(/"data":"[^"]*"/g) ?? []);
    expect(payloads(events)).toEqual(payloads(raw));
    expect(payloads(events).length).toBeGreaterThan(0);
  });
});
