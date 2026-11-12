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
  WorkflowGraphNode,
  WorkflowGraphResponse,
} from '../../common';
import {
  loopGraphResponse,
  timelineNodes as nodes,
  TIMELINE_T0 as T0,
} from '../../testData';

const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

function graph(steps: WorkflowGraphNode[]): WorkflowGraphResponse {
  return {
    status: 'Running',
    nodes: steps,
    edges: [],
    completedSteps: 0,
    totalSteps: steps.length,
    truncated: false,
    payloadsHidden: false,
  };
}

import {
  buildTimeline,
  clampWindow,
  formatOffset,
  isFullWindow,
  MIN_WINDOW_MS,
  panWindow,
  placeSpan,
  placeTime,
  selectWindow,
  tickStep,
  TimelineRow,
  timeTicks,
  zoomWindow,
} from './timeline';

const running = {
  runId: 'run-1',
  status: 'Running' as const,
  startTime: at(0),
};
const now = T0 + 40_000;

function rows(model: ReturnType<typeof buildTimeline>): TimelineRow[] {
  return model.items.flatMap(i => (i.type === 'row' ? [i.row] : i.group.rows));
}

describe('buildTimeline', () => {
  const model = buildTimeline(graph(nodes), running, now);
  const byId = Object.fromEntries(rows(model).map(r => [r.id, r]));

  it('runs from the start of the run to now while it runs', () => {
    expect(model.open).toBe(true);
    expect(model.range).toEqual({ start: T0, end: now });
    expect(byId.start.run).toEqual({ start: T0, end: now });
    expect(byId.start.open).toBe(true);
  });

  it('leaves out internal steps and orders the rows by start', () => {
    expect(rows(model).map(r => r.id)).toEqual([
      'start',
      'activity-5',
      'activity-9',
      'timer-12',
      'signal-14',
      'activity-16',
      'waiting',
    ]);
  });

  it('splits an activity into the time queued and the time it ran', () => {
    expect(byId['activity-5']).toMatchObject({
      shape: 'bar',
      queued: { start: T0 + 1000, end: T0 + 2000 },
      run: { start: T0 + 2000, end: T0 + 4000 },
      retries: 0,
      tone: 'success',
      open: false,
    });
  });

  it('counts retries and colors a failed step red', () => {
    expect(byId['activity-9']).toMatchObject({
      retries: 2,
      tone: 'danger',
      queued: { start: T0 + 5000, end: T0 + 15_000 },
    });
  });

  it('dashes timers and waits, and points at signals', () => {
    expect(byId['timer-12']).toMatchObject({ shape: 'bar', dashed: true });
    expect(byId['signal-14']).toMatchObject({
      shape: 'point',
      at: T0 + 25_000,
    });
    // A wait without a time of its own starts at the last progress.
    expect(byId.waiting).toMatchObject({
      dashed: true,
      open: true,
      run: { start: T0 + 32_000, end: now },
    });
  });

  it('extends an open activity to now, started from its pending attempt', () => {
    expect(byId['activity-16']).toMatchObject({
      open: true,
      queued: { start: T0 + 32_000, end: T0 + 34_000 },
      run: { start: T0 + 34_000, end: now },
    });
    // A minute later the bar is longer.
    const later = buildTimeline(graph(nodes), running, now + 60_000);
    const row = rows(later).find(r => r.id === 'activity-16')!;
    expect(row.run?.end).toBe(now + 60_000);
  });

  it('ends at the close time of a closed run', () => {
    const closed = buildTimeline(
      graph(nodes.filter(n => n.id !== 'waiting' && n.id !== 'activity-16')),
      { status: 'Completed', startTime: at(0), closeTime: at(35) },
      now,
    );
    expect(closed.open).toBe(false);
    expect(closed.range).toEqual({ start: T0, end: T0 + 35_000 });
  });

  it('keeps an activity that never started in the queue', () => {
    const row = buildTimeline(
      graph([
        {
          id: 'activity-2',
          kind: 'activity',
          name: 'late',
          status: 'Scheduled',
          startTime: at(1),
          events: [],
        },
      ]),
      running,
      now,
    ).items[0];
    expect(row).toMatchObject({
      type: 'row',
      row: { queued: { start: T0 + 1000, end: now }, open: true },
    });
    expect(row.type === 'row' && row.row.run).toBeUndefined();
  });

  it('groups the steps of each loop round, latest round marked', () => {
    const loop = buildTimeline(
      loopGraphResponse,
      {
        status: 'Completed',
        startTime: new Date(Date.UTC(2026, 0, 1, 11, 0, 0)).toISOString(),
        closeTime: new Date(Date.UTC(2026, 0, 1, 11, 0, 10)).toISOString(),
      },
      now,
    );
    const groups = loop.items.flatMap(i =>
      i.type === 'group' ? [i.group] : [],
    );
    expect(groups.map(g => [g.key, g.rows.map(r => r.id), g.latest])).toEqual([
      ['draft-review/1', ['activity-5', 'activity-8'], false],
      ['draft-review/2', ['activity-12', 'activity-15'], true],
    ]);
    // A group takes the place of its first step.
    expect(loop.items[0]).toMatchObject({ type: 'row', row: { id: 'start' } });
    expect(groups[0].span).toEqual({
      start: Date.UTC(2026, 0, 1, 11, 0, 1),
      end: Date.UTC(2026, 0, 1, 11, 0, 3),
    });
  });

  it('leaves out the rounds of other runs', () => {
    const other = {
      ...loopGraphResponse,
      loops: loopGraphResponse.loops!.map(l => ({
        ...l,
        rounds: l.rounds.map(r => ({
          ...r,
          runId: r.iteration === 1 ? 'run-0' : 'run-1',
        })),
      })),
    };
    const model2 = buildTimeline(other, { ...running, runId: 'run-1' }, now);
    const keys = model2.items.flatMap(i =>
      i.type === 'group' ? [i.group.key] : [],
    );
    expect(keys).toEqual(['draft-review/2']);
  });
});

describe('time window', () => {
  const full = { start: 0, end: 10_000 };

  it('zooms around the anchor and stays inside the range', () => {
    expect(zoomWindow(full, full, 0.5, 0.5)).toEqual({
      start: 2500,
      end: 7500,
    });
    expect(zoomWindow(full, full, 0, 0.5)).toEqual({ start: 0, end: 5000 });
    // Zooming out past the range shows the whole range.
    expect(zoomWindow({ start: 2000, end: 4000 }, full, 0.5, 100)).toEqual(
      full,
    );
  });

  it('does not zoom in below the shortest window', () => {
    const tiny = zoomWindow(full, full, 0.5, 0.000001);
    expect(tiny.end - tiny.start).toBe(MIN_WINDOW_MS);
  });

  it('selects a dragged range in either direction', () => {
    const win = { start: 2000, end: 6000 };
    expect(selectWindow(win, full, 0.75, 0.25)).toEqual({
      start: 3000,
      end: 5000,
    });
    expect(selectWindow(win, full, -1, 2)).toEqual(win);
  });

  it('pans and stops at the ends', () => {
    const win = { start: 2000, end: 4000 };
    expect(panWindow(win, full, 0.5)).toEqual({ start: 3000, end: 5000 });
    expect(panWindow(win, full, -5)).toEqual({ start: 0, end: 2000 });
    expect(panWindow(win, full, 50)).toEqual({ start: 8000, end: 10_000 });
    expect(clampWindow({ start: -100, end: 20_000 }, full)).toEqual(full);
    expect(isFullWindow(full, full)).toBe(true);
    expect(isFullWindow(win, full)).toBe(false);
  });

  it('places spans and instants in percent, cut to the window', () => {
    const win = { start: 1000, end: 3000 };
    expect(placeSpan({ start: 1500, end: 2000 }, win)).toEqual({
      left: 25,
      width: 25,
    });
    expect(placeSpan({ start: 0, end: 2000 }, win)).toEqual({
      left: 0,
      width: 50,
    });
    expect(placeSpan({ start: 4000, end: 5000 }, win)).toBeUndefined();
    expect(placeTime(2000, win)).toBe(50);
    expect(placeTime(500, win)).toBeUndefined();
  });
});

describe('time axis', () => {
  it('picks round steps', () => {
    expect(tickStep(10_000, 5)).toBe(2000);
    expect(tickStep(60 * 60_000, 6)).toBe(10 * 60_000);
    expect(tickStep(300, 6)).toBe(50);
  });

  it('labels ticks with the offset from the start of the run', () => {
    expect(timeTicks({ start: 0, end: 90_000 }, 0, 3)).toEqual([
      { at: 0, label: '0' },
      { at: 30_000, label: '+30s' },
      { at: 60_000, label: '+1m' },
      { at: 90_000, label: '+1m 30s' },
    ]);
    // A zoomed window starts at the next round offset.
    expect(
      timeTicks({ start: 1100, end: 2100 }, 0, 5).map(t => t.label),
    ).toEqual(['+1.2s', '+1.4s', '+1.6s', '+1.8s', '+2s']);
  });

  it('formats offsets', () => {
    expect(formatOffset(250)).toBe('250ms');
    expect(formatOffset(1500)).toBe('1.5s');
    expect(formatOffset(150_000)).toBe('2m 30s');
    expect(formatOffset(26 * 3600_000 + 60_000)).toBe('1d 2h');
    expect(formatOffset(0)).toBe('0ms');
  });
});
