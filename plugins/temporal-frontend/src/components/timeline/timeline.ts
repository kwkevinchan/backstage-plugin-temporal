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
  WorkflowLoopGroup,
  WorkflowLoopRound,
  WorkflowNodeStatus,
  WorkflowStatus,
} from '../../common';
import { isMarkerStep, isOpenStep } from '../steps';
import { statusTone, Tone } from '../WorkflowStatusLabel';

/*
 * Layout of the Timeline tab, without React: one row per step with the
 * times of its bar, rows of a loop grouped by round, and the time window
 * shown (zoom, pan, ticks of the time axis).
 */

/** A time range in milliseconds since the epoch. */
export interface Span {
  start: number;
  end: number;
}

/** One step of the timeline. */
export interface TimelineRow {
  id: string;
  node: WorkflowGraphNode;
  /** `bar` from start to end; `point` for an instant (signal, update). */
  shape: 'bar' | 'point';
  /** Scheduled to started: the step waited for a worker. */
  queued?: Span;
  /** Started to closed, or to now while the step is open. */
  run?: Span;
  /** Time of a point. */
  at?: number;
  /** Timers and waits: the run waits, nothing executes. */
  dashed: boolean;
  /** The step is not closed; its bar ends at now. */
  open: boolean;
  /** Attempts before the current one. */
  retries: number;
  tone: Tone;
  /** First and last time of the row. */
  span: Span;
}

/** The steps of one round of a loop. */
export interface TimelineGroup {
  key: string;
  loop: WorkflowLoopGroup;
  round: WorkflowLoopRound;
  rows: TimelineRow[];
  span: Span;
  tone: Tone;
  /** The latest round of its loop in this run. */
  latest: boolean;
}

export type TimelineItem =
  | { type: 'row'; row: TimelineRow }
  | { type: 'group'; group: TimelineGroup };

export interface TimelineModel {
  /** From the start of the run to its end, or to now while it runs. */
  range: Span;
  items: TimelineItem[];
  /** The run is open: bars grow until now. */
  open: boolean;
}

/** Shortest time window the zoom goes to. */
export const MIN_WINDOW_MS = 50;

const POINT_KINDS = new Set([
  'signal',
  'signalSent',
  'update',
  'cancelRequest',
  'marker',
  'event',
  'workflowTask',
  'workflowClosed',
]);

function time(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

function eventTime(
  node: WorkflowGraphNode,
  pattern: RegExp,
): number | undefined {
  const event = node.events.find(e => pattern.test(e.eventType));
  return time(event?.eventTime);
}

/** When an activity or child workflow started executing, if it did. */
function startedTime(node: WorkflowGraphNode): number | undefined {
  if (node.kind === 'activity') {
    const started = node.events.filter(e =>
      /^ActivityTaskStarted$/.test(e.eventType),
    );
    const last = started[started.length - 1];
    const attempts = node.attempts ?? [];
    return (
      time(last?.eventTime) ??
      time(attempts[attempts.length - 1]?.startedTime) ??
      undefined
    );
  }
  if (node.kind === 'childWorkflow') {
    return eventTime(node, /^ChildWorkflowExecutionStarted$/);
  }
  return undefined;
}

function isClosedRun(status: WorkflowStatus): boolean {
  return status !== 'Running' && status !== 'Unknown';
}

/**
 * One row for a step, or undefined for steps without a time (and the
 * internal ones). `waitFrom` is where an open wait without a time of its
 * own starts: the end of the last step before it.
 */
export function timelineRow(
  node: WorkflowGraphNode,
  now: number,
  runEnd: number,
  waitFrom: number,
): TimelineRow | undefined {
  if (node.internal) return undefined;
  const open = isOpenStep(node);
  const start =
    time(node.startTime) ?? (node.kind === 'waiting' ? waitFrom : undefined);
  if (start === undefined) return undefined;
  const closedAt = time(node.endTime);
  const end = Math.max(start, open ? runEnd : closedAt ?? start);
  const tone = statusTone(node.status as WorkflowNodeStatus);
  const retries = node.attempt && node.attempt > 1 ? node.attempt - 1 : 0;
  const base = {
    id: node.id,
    node,
    open: open && runEnd >= now,
    retries,
    tone,
  };

  if (POINT_KINDS.has(node.kind)) {
    return {
      ...base,
      shape: 'point',
      at: start,
      dashed: false,
      open: false,
      span: { start, end: start },
    };
  }
  if (node.kind === 'timer' || node.kind === 'waiting') {
    return {
      ...base,
      shape: 'bar',
      dashed: true,
      run: { start, end },
      span: { start, end },
    };
  }
  if (node.kind === 'activity' || node.kind === 'childWorkflow') {
    const started = startedTime(node);
    if (started !== undefined && started >= start && started <= end) {
      return {
        ...base,
        shape: 'bar',
        dashed: false,
        queued: started > start ? { start, end: started } : undefined,
        run: { start: started, end },
        span: { start, end },
      };
    }
    // Not started: open, it waits in the queue; closed, it never ran
    // (canceled or timed out before a worker picked it up).
    return {
      ...base,
      shape: 'bar',
      dashed: false,
      queued: open || node.status !== 'Completed' ? { start, end } : undefined,
      run: open || node.status !== 'Completed' ? undefined : { start, end },
      span: { start, end },
    };
  }
  return {
    ...base,
    shape: 'bar',
    dashed: false,
    run: { start, end },
    span: { start, end },
  };
}

/** Rounds of the loops that ran in this run, with their steps here. */
function roundsOfRun(
  loops: WorkflowLoopGroup[] | undefined,
  nodeIds: Set<string>,
  runId: string | undefined,
): { loop: WorkflowLoopGroup; round: WorkflowLoopRound; ids: string[] }[] {
  const out: {
    loop: WorkflowLoopGroup;
    round: WorkflowLoopRound;
    ids: string[];
  }[] = [];
  for (const loop of loops ?? []) {
    for (const round of loop.rounds) {
      if (runId && round.runId && round.runId !== runId) continue;
      const ids = round.steps.map(s => s.nodeId).filter(id => nodeIds.has(id));
      if (ids.length > 0) out.push({ loop, round, ids });
    }
  }
  return out;
}

function roundTone(round: WorkflowLoopRound): Tone {
  return statusTone(round.status);
}

/**
 * Rows of a run, oldest first. Rows of a loop round are grouped; a group
 * takes the place of its first row. The run itself is the first row, from
 * its start to its end (or now).
 */
export function buildTimeline(
  graph: WorkflowGraphResponse,
  workflow: {
    runId?: string;
    status: WorkflowStatus;
    startTime?: string;
    closeTime?: string;
  },
  now: number,
  options: { showMarkers?: boolean } = {},
): TimelineModel {
  const nodes = graph.nodes.filter(
    n => !n.internal && (options.showMarkers || !isMarkerStep(n)),
  );
  const starts = nodes
    .map(n => time(n.startTime))
    .filter((t): t is number => t !== undefined);
  const ends = nodes
    .map(n => time(n.endTime))
    .filter((t): t is number => t !== undefined);
  const runStart =
    time(workflow.startTime) ?? (starts.length ? Math.min(...starts) : now);
  const closed = isClosedRun(workflow.status);
  const closeTime = time(workflow.closeTime);
  const lastTime = Math.max(runStart, ...starts, ...ends);
  const runEnd = closed ? closeTime ?? lastTime : Math.max(now, lastTime);
  // An open wait has no time of its own: it starts at the last progress.
  const waitFrom = lastTime;

  const rows: TimelineRow[] = [];
  for (const node of nodes) {
    let row: TimelineRow | undefined;
    if (node.kind === 'workflowStarted') {
      const end = runEnd;
      row = {
        id: node.id,
        node,
        shape: 'bar',
        dashed: false,
        open: !closed,
        retries: 0,
        tone: statusTone(workflow.status),
        run: { start: runStart, end },
        span: { start: runStart, end },
      };
    } else {
      row = timelineRow(node, now, runEnd, waitFrom);
    }
    if (row) rows.push(row);
  }
  // Oldest first; steps that start together keep the order of the graph.
  const order = new Map(rows.map((r, i) => [r.id, i]));
  rows.sort(
    (a, b) =>
      a.span.start - b.span.start || order.get(a.id)! - order.get(b.id)!,
  );

  const byId = new Map(rows.map(r => [r.id, r]));
  const rounds = roundsOfRun(graph.loops, new Set(byId.keys()), workflow.runId);
  const latestByLoop = new Map<string, number>();
  for (const { loop, round } of rounds) {
    latestByLoop.set(
      loop.name,
      Math.max(latestByLoop.get(loop.name) ?? 0, round.iteration),
    );
  }
  const groupOf = new Map<string, TimelineGroup>();
  for (const { loop, round, ids } of rounds) {
    const groupRows = rows.filter(r => ids.includes(r.id));
    const groupStart = Math.min(...groupRows.map(r => r.span.start));
    const groupEnd = Math.max(...groupRows.map(r => r.span.end));
    const group: TimelineGroup = {
      key: `${loop.name}/${round.iteration}`,
      loop,
      round,
      rows: groupRows,
      span: { start: groupStart, end: groupEnd },
      tone: roundTone(round),
      latest: latestByLoop.get(loop.name) === round.iteration,
    };
    for (const r of groupRows) {
      if (!groupOf.has(r.id)) groupOf.set(r.id, group);
    }
  }

  const items: TimelineItem[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const group = groupOf.get(row.id);
    if (!group) {
      items.push({ type: 'row', row });
    } else if (!placed.has(group.key)) {
      placed.add(group.key);
      group.rows = group.rows.filter(r => groupOf.get(r.id) === group);
      items.push({ type: 'group', group });
    }
  }

  const range = { start: runStart, end: Math.max(runEnd, runStart + 1000) };
  return { range, items, open: !closed };
}

/** Keeps a window inside the full range and at least `MIN_WINDOW_MS` wide. */
export function clampWindow(win: Span, full: Span): Span {
  const fullSpan = full.end - full.start;
  let span = Math.min(Math.max(win.end - win.start, MIN_WINDOW_MS), fullSpan);
  if (!Number.isFinite(span) || span <= 0) span = fullSpan;
  let start = Math.max(full.start, Math.min(win.start, full.end - span));
  if (!Number.isFinite(start)) start = full.start;
  return { start, end: start + span };
}

/**
 * Zooms around a point of the window: `anchor` is its place from 0 (left)
 * to 1 (right), which stays where it is. A factor below 1 zooms in.
 */
export function zoomWindow(
  win: Span,
  full: Span,
  anchor: number,
  factor: number,
): Span {
  const a = Math.min(1, Math.max(0, anchor));
  const span = win.end - win.start;
  const at = win.start + span * a;
  const next = span * factor;
  return clampWindow({ start: at - next * a, end: at + next * (1 - a) }, full);
}

/** The window between two places of the current one (0 to 1, any order). */
export function selectWindow(
  win: Span,
  full: Span,
  from: number,
  to: number,
): Span {
  const span = win.end - win.start;
  const a = Math.min(1, Math.max(0, Math.min(from, to)));
  const b = Math.min(1, Math.max(0, Math.max(from, to)));
  return clampWindow(
    { start: win.start + span * a, end: win.start + span * b },
    full,
  );
}

/** Moves the window by a part of its width (negative: to the left). */
export function panWindow(win: Span, full: Span, by: number): Span {
  const shift = (win.end - win.start) * by;
  return clampWindow({ start: win.start + shift, end: win.end + shift }, full);
}

/** True when the window shows the whole range. */
export function isFullWindow(win: Span, full: Span): boolean {
  return win.start <= full.start && win.end >= full.end;
}

/**
 * Place of a span in the window, in percent of its width, cut to the
 * window; undefined when the span is outside.
 */
export function placeSpan(
  span: Span,
  win: Span,
): { left: number; width: number } | undefined {
  const width = win.end - win.start;
  if (width <= 0 || span.end < win.start || span.start > win.end) {
    return undefined;
  }
  const a = Math.max(span.start, win.start);
  const b = Math.min(span.end, win.end);
  return {
    left: ((a - win.start) / width) * 100,
    width: ((b - a) / width) * 100,
  };
}

/** Place of an instant in the window in percent, undefined outside. */
export function placeTime(at: number, win: Span): number | undefined {
  const width = win.end - win.start;
  if (width <= 0 || at < win.start || at > win.end) return undefined;
  return ((at - win.start) / width) * 100;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STEPS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

/** The smallest round step that gives at most `maxTicks` ticks. */
export function tickStep(spanMs: number, maxTicks: number): number {
  const wanted = spanMs / Math.max(1, maxTicks);
  return STEPS.find(s => s >= wanted) ?? Math.ceil(wanted / DAY) * DAY;
}

/** A time offset like `250ms`, `1.5s`, `2m 30s`, `1h 5m` or `2d 3h`. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  let rest = Math.abs(Math.round(ms));
  if (rest < SECOND) return `${sign}${rest}ms`;
  if (rest < 10 * SECOND && rest % SECOND !== 0) {
    return `${sign}${Math.round(rest / 100) / 10}s`;
  }
  const parts: string[] = [];
  for (const [unit, label] of [
    [DAY, 'd'],
    [HOUR, 'h'],
    [MINUTE, 'm'],
    [SECOND, 's'],
  ] as const) {
    const n = Math.floor(rest / unit);
    rest -= n * unit;
    if (n) parts.push(`${n}${label}`);
  }
  return sign + (parts.slice(0, 2).join(' ') || '0s');
}

/**
 * Ticks of the time axis: round offsets from the start of the run inside
 * the window, labeled with the offset (`+1m 30s`).
 */
export function timeTicks(
  win: Span,
  origin: number,
  maxTicks: number,
): { at: number; label: string }[] {
  const step = tickStep(win.end - win.start, maxTicks);
  const first = origin + Math.ceil((win.start - origin) / step) * step;
  const ticks: { at: number; label: string }[] = [];
  for (
    let at = first;
    at <= win.end && ticks.length <= maxTicks + 1;
    at += step
  ) {
    const offset = at - origin;
    ticks.push({ at, label: offset === 0 ? '0' : `+${formatOffset(offset)}` });
  }
  return ticks;
}
