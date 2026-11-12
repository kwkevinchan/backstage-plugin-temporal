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

export function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function formatDuration(start?: string, end?: string): string {
  if (!start) return '';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '';
  return formatSeconds(Math.round((to - from) / 1000));
}

/** A mean duration like `1m 5s`; below ten seconds with tenths, like `2.5s`. */
export function formatMilliseconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) {
    return `${Math.round(ms / 100) / 10}s`;
  }
  return formatSeconds(Math.round(ms / 1000));
}

/**
 * How long until a timer fires, in words: `fires in 2m 30s`, or for the
 * time limit of a wait `times out in 23h 40m`.
 */
export function deadlineText(
  deadline: { time: string; kind: 'fires' | 'timeout' },
  now: number = Date.now(),
): string {
  const at = new Date(deadline.time).getTime();
  if (Number.isNaN(at)) return '';
  const verb = deadline.kind === 'timeout' ? 'times out' : 'fires';
  const left = Math.ceil((at - now) / 1000);
  return left > 0 ? `${verb} in ${formatSeconds(left)}` : `${verb} now`;
}

function formatSeconds(totalSeconds: number): string {
  let seconds = totalSeconds;
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.slice(0, 2).join(' ');
}
