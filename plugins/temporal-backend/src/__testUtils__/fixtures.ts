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

/**
 * Fields that hold a time or a duration: `eventTime` and the timeouts,
 * intervals, backoffs and delays of the event attributes. Decided by name
 * so that a payload that looks like a time is left alone.
 */
const TIME_FIELD = /^(eventTime|.*(Timeout|Interval|Backoff|Delay|Duration))$/;

/** Subtrees that hold user data, not event attributes. */
const DATA_FIELDS = new Set(['data', 'metadata', 'fields']);

const ISO_TIME = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/;
const DURATION = /^(-?\d+)(?:\.(\d{1,9}))?s$/;

/**
 * A message of the shape `message.toJSON()` gives for a `Timestamp` or a
 * `Duration`: `seconds` is a string and `nanos` a number, each left out
 * when it is zero.
 */
function seconds(whole: number, fraction = ''): Record<string, unknown> {
  const nanos = Number(fraction.padEnd(9, '0'));
  const out: Record<string, unknown> = {};
  if (whole !== 0) out.seconds = String(whole);
  if (nanos !== 0) out.nanos = whole < 0 ? -nanos : nanos;
  return out;
}

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (DATA_FIELDS.has(key)) {
      out[key] = v;
    } else if (TIME_FIELD.test(key) && typeof v === 'string') {
      const time = ISO_TIME.exec(v);
      const duration = DURATION.exec(v);
      if (time) {
        out[key] = seconds(Date.parse(`${time[1]}Z`) / 1000, time[2]);
      } else if (duration) {
        out[key] = seconds(Number(duration[1]), duration[2]);
      } else {
        out[key] = v;
      }
    } else {
      out[key] = convert(v);
    }
  }
  return out;
}

/**
 * A history of `test-fixtures/<dir>/<name>.json` in the form the plugin
 * reads in production. The files are the output of the Temporal CLI, where
 * times are ISO strings and durations are strings like `2s`; the plugin
 * reads `HistoryEvent.toJSON()`, where both are `{ seconds, nanos }`.
 */
export function readHistoryFixture(
  dir: string,
  name: string,
): { events: any[] } {
  return convert(
    JSON.parse(
      readFileSync(
        resolve(__dirname, `../../../../test-fixtures/${dir}/${name}.json`),
        'utf8',
      ),
    ),
  ) as { events: any[] };
}
