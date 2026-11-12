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

import type {
  CalendarSpecDescription,
  ScheduleSummary,
} from '@temporalio/client';
import type { TemporalSchedule } from '../common';

/** Recent actions and next times kept per schedule. */
const MAX_RECENT_ACTIONS = 5;
const MAX_NEXT_TIMES = 3;

type Range<T> = { start: T; end?: T; step?: number };

function rangeText<T extends string | number>(
  ranges: Range<T>[] | undefined,
  full: { start: T; end: T },
): string | undefined {
  if (!ranges || ranges.length === 0) return undefined;
  if (
    ranges.length === 1 &&
    ranges[0].start === full.start &&
    (ranges[0].end ?? ranges[0].start) === full.end &&
    (ranges[0].step ?? 1) === 1
  ) {
    return undefined; // every value
  }
  return ranges
    .map(r => {
      const end = r.end ?? r.start;
      const base = end === r.start ? `${r.start}` : `${r.start}-${end}`;
      return r.step && r.step > 1 ? `${base}/${r.step}` : base;
    })
    .join(',');
}

const pad = (v: string) => (/^\d$/.test(v) ? `0${v}` : v);

/**
 * One line for a calendar: its comment, or the fields that are not every
 * value, e.g. `02:00 on MONDAY-FRIDAY`.
 */
export function calendarText(calendar: CalendarSpecDescription): string {
  if (calendar.comment) return calendar.comment;
  const minute = rangeText(calendar.minute, { start: 0, end: 59 }) ?? '*';
  const hour = rangeText(calendar.hour, { start: 0, end: 23 }) ?? '*';
  const parts = [`${pad(hour)}:${pad(minute)}`];
  const second = rangeText(calendar.second, { start: 0, end: 59 });
  if (second && second !== '0') parts[0] += `:${pad(second)}`;
  const dayOfWeek = rangeText(calendar.dayOfWeek, {
    start: 'SUNDAY',
    end: 'SATURDAY',
  });
  const dayOfMonth = rangeText(calendar.dayOfMonth, { start: 1, end: 31 });
  const month = rangeText(calendar.month, {
    start: 'JANUARY',
    end: 'DECEMBER',
  });
  if (dayOfWeek) parts.push(`on ${dayOfWeek}`);
  if (dayOfMonth) parts.push(`day ${dayOfMonth}`);
  if (month) parts.push(`in ${month}`);
  return parts.join(' ');
}

/** `1h 30m`, `45s`, `2d` from milliseconds. */
export function durationText(ms: number): string {
  let s = Math.round(ms / 1000);
  const units: [string, number][] = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  const parts: string[] = [];
  for (const [unit, size] of units) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)}${unit}`);
      s %= size;
    }
  }
  return parts.join(' ') || '0s';
}

const iso = (d: Date | undefined) =>
  d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;

/** Converts a schedule from the SDK's list. */
export function toTemporalSchedule(
  namespace: string,
  summary: ScheduleSummary,
): TemporalSchedule {
  const spec: string[] = [
    ...(summary.spec?.intervals ?? []).map(
      i =>
        `every ${durationText(i.every)}${
          i.offset ? ` (offset ${durationText(i.offset)})` : ''
        }`,
    ),
    ...(summary.spec?.calendars ?? []).map(calendarText),
  ];
  const schedule: TemporalSchedule = {
    namespace,
    scheduleId: summary.scheduleId,
    spec,
    paused: summary.state.paused,
    nextActionTimes: summary.info.nextActionTimes
      .slice(0, MAX_NEXT_TIMES)
      .map(iso)
      .filter((t): t is string => Boolean(t)),
    recentActions: [...summary.info.recentActions]
      .reverse()
      .slice(0, MAX_RECENT_ACTIONS)
      .map(a => ({
        scheduledAt: iso(a.scheduledAt) ?? '',
        takenAt: iso(a.takenAt) ?? '',
        workflowId: a.action.workflow.workflowId,
        runId: a.action.workflow.firstExecutionRunId,
      })),
  };
  if (summary.action?.workflowType) {
    schedule.workflowType = summary.action.workflowType;
  }
  if (summary.spec?.timezone) schedule.timezone = summary.spec.timezone;
  if (summary.state.note) schedule.note = summary.state.note;
  return schedule;
}
