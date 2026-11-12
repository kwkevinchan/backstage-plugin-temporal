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

import { addLlmUsage } from '../../common';
import type {
  WorkflowGraphNode,
  WorkflowLlmUsage,
  WorkflowLoopGroup,
  WorkflowLoopMarker,
  WorkflowLoopRound,
  WorkflowLoopStatus,
  WorkflowLoopStep,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowStatus,
} from '../../common';
import { dropUndefined } from '../convert';

/*
 * Loops of a run, from the loop markers of its steps and the loop state in
 * the memo (see @kwkevinchan/temporal-workflow-kit/loop). The marked steps of a loop are
 * grouped by round. Unmarked steps (timers, signals, markers) that start
 * while the loop runs belong to the round they started in, so a collapsed
 * loop has no arrows that go around it.
 */

/** A step with the event IDs of its first and closing event. */
export interface LoopNodeInput extends WorkflowGraphNode {
  first: number;
  last?: number;
}

/** One loop in a loop state (memo or query), as far as it is valid. */
export interface LoopStateEntry {
  name: string;
  iteration?: number;
  maxIterations?: number;
  status?: WorkflowLoopStatus;
  decision?: string;
  score?: number;
  rounds?: LoopStateRound[];
}

export interface LoopStateRound {
  iteration: number;
  segment?: number;
  status?: string;
  decision?: string;
  score?: number;
  startTime?: string;
  endTime?: string;
}

export interface LoopStateValue {
  segment?: number;
  loops: LoopStateEntry[];
  last?: LoopStateRound & { loop: string };
}

const LOOP_STATUSES = new Set(['running', 'done', 'exhausted', 'failed']);

const OPEN_STATUSES = new Set<WorkflowNodeStatus>([
  'Scheduled',
  'Running',
  'Retrying',
  'Waiting',
]);

const FAILED_STATUSES = new Set<WorkflowNodeStatus>([
  'Failed',
  'TimedOut',
  'Terminated',
  'Rejected',
]);

/** Steps that never belong to a round. */
const OUTSIDE_KINDS = new Set<WorkflowNodeKind>([
  'workflowStarted',
  'workflowClosed',
  'waiting',
  'workflowTask',
  'event',
]);

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const pos = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;

/** A marker from a memo value (`temporal.loop` of a child workflow). */
export function readLoopMarker(value: unknown): WorkflowLoopMarker | undefined {
  const v = value as Record<string, unknown> | undefined;
  if (typeof v !== 'object' || v === null) return undefined;
  const loop = str(v.loop);
  const step = str(v.step);
  const iteration = pos(v.iteration);
  if (!loop || !step || !iteration) return undefined;
  return dropUndefined({
    loop,
    iteration,
    step,
    occurrence: pos(v.occurrence),
  });
}

function readRound(value: unknown): LoopStateRound | undefined {
  const v = value as Record<string, unknown> | undefined;
  if (typeof v !== 'object' || v === null) return undefined;
  const iteration = pos(v.iteration);
  if (!iteration) return undefined;
  return dropUndefined({
    iteration,
    segment: pos(v.segment),
    status: str(v.status),
    decision: str(v.decision),
    score: num(v.score),
    startTime: str(v.startTime),
    endTime: str(v.endTime),
  });
}

/**
 * Reads a loop state (the `temporal.loops` memo or the `__loop_state`
 * query result). Fields of the wrong type are left out; anything that is
 * not a loop state gives undefined.
 */
export function readLoopState(value: unknown): LoopStateValue | undefined {
  const v = value as Record<string, unknown> | undefined;
  if (typeof v !== 'object' || v === null || !Array.isArray(v.loops)) {
    return undefined;
  }
  const loops: LoopStateEntry[] = [];
  for (const raw of v.loops as unknown[]) {
    const l = raw as Record<string, unknown>;
    const name = str(l?.name);
    if (!name) continue;
    const status = str(l.status);
    loops.push(
      dropUndefined({
        name,
        iteration: typeof l.iteration === 'number' ? l.iteration : undefined,
        maxIterations: pos(l.maxIterations),
        status:
          status && LOOP_STATUSES.has(status)
            ? (status as WorkflowLoopStatus)
            : undefined,
        decision: str(l.decision),
        score: num(l.score),
        rounds: Array.isArray(l.rounds)
          ? l.rounds
              .map(readRound)
              .filter((r): r is LoopStateRound => Boolean(r))
          : undefined,
      }),
    );
  }
  const lastRaw = v.last as Record<string, unknown> | undefined;
  const lastRound = readRound(lastRaw);
  const lastLoop = str(lastRaw?.loop);
  return dropUndefined({
    segment: pos(v.segment),
    loops,
    last: lastRound && lastLoop ? { ...lastRound, loop: lastLoop } : undefined,
  });
}

/** Status of a round from its marked steps. */
function roundStatus(steps: LoopNodeInput[]): WorkflowNodeStatus {
  if (steps.some(s => s.last === undefined && OPEN_STATUSES.has(s.status))) {
    return 'Running';
  }
  if (steps.some(s => FAILED_STATUSES.has(s.status))) return 'Failed';
  if (steps.some(s => s.status === 'Canceled')) return 'Canceled';
  return 'Completed';
}

function toStep(node: LoopNodeInput): WorkflowLoopStep {
  return dropUndefined({
    nodeId: node.id,
    name: node.name,
    kind: node.kind,
    status: node.status,
    startTime: node.startTime,
    endTime: node.endTime,
    llm: llmRole(node),
    usage: node.llm?.usage,
  });
}

/** `llm` for a model call, `tool` for a tool call. */
function llmRole(node: LoopNodeInput): 'llm' | 'tool' | undefined {
  if (node.llm) return 'llm';
  return node.tool ? 'tool' : undefined;
}

/** Tokens and model calls of the steps of a round. */
function roundUsage(steps: LoopNodeInput[]) {
  const calls = steps.filter(s => s.llm);
  if (calls.length === 0) return {};
  let usage: WorkflowLlmUsage | undefined;
  for (const c of calls) usage = addLlmUsage(usage, c.llm!.usage);
  return { usage, llmCalls: calls.length };
}

/** Status of a loop without a loop state, from the run. */
function derivedStatus(status: WorkflowStatus): WorkflowLoopStatus {
  if (status === 'Running' || status === 'ContinuedAsNew') return 'running';
  if (status === 'Completed') return 'done';
  return 'failed';
}

export interface BuildLoopOptions {
  status: WorkflowStatus;
  /** Loop states of the memo upserts of the run, oldest first. */
  upserts: unknown[];
  /** Loop state carried into the run (memo of the start event). */
  carried?: unknown;
  /** Loop state in the current memo, from describe. */
  current?: unknown;
}

/**
 * Loops of one run, in the order they started, or undefined when no step
 * has a loop marker and no round ended in the run.
 */
export function buildLoopGroups(
  nodes: LoopNodeInput[],
  options: BuildLoopOptions,
): WorkflowLoopGroup[] | undefined {
  const upserts = options.upserts
    .map(readLoopState)
    .filter((s): s is LoopStateValue => Boolean(s));
  const marked = nodes
    .filter(n => n.loop && !n.internal)
    .sort((x, y) => x.first - y.first);
  const names: string[] = [];
  for (const n of marked) {
    if (!names.includes(n.loop!.loop)) names.push(n.loop!.loop);
  }
  for (const u of upserts) {
    if (u.last && !names.includes(u.last.loop)) names.push(u.last.loop);
  }
  if (names.length === 0) return undefined;

  const latest =
    readLoopState(options.current) ??
    upserts[upserts.length - 1] ??
    readLoopState(options.carried);
  const runOpen = options.status === 'Running';
  const absorbed = new Set<string>();
  const candidates = nodes
    .filter(n => !n.loop && !n.internal && !OUTSIDE_KINDS.has(n.kind))
    .sort((x, y) => x.first - y.first);

  return names.map(name => {
    const entry = latest?.loops.find(l => l.name === name);
    const recorded = new Map<number, LoopStateRound>();
    for (const u of upserts) {
      if (u.last?.loop === name) recorded.set(u.last.iteration, u.last);
    }
    const own = marked.filter(n => n.loop!.loop === name);
    const byRound = new Map<number, LoopNodeInput[]>();
    for (const n of own) {
      const list = byRound.get(n.loop!.iteration) ?? [];
      list.push(n);
      byRound.set(n.loop!.iteration, list);
    }
    for (const iteration of recorded.keys()) {
      if (!byRound.has(iteration)) byRound.set(iteration, []);
    }
    const iterations = [...byRound.keys()].sort((a, b) => a - b);

    // Unmarked steps that started while the loop ran.
    const firstOf = (list: LoopNodeInput[]) =>
      list.length > 0 ? Math.min(...list.map(n => n.first)) : Infinity;
    const open = own.some(n => n.last === undefined);
    const loopRunning = runOpen && entry?.status === 'running';
    const start = firstOf(own);
    const end =
      open || loopRunning
        ? Infinity
        : Math.max(-Infinity, ...own.map(n => n.last ?? n.first));
    const extra = new Map<number, LoopNodeInput[]>();
    for (const c of candidates) {
      if (absorbed.has(c.id) || c.first <= start || c.first >= end) continue;
      let target: number | undefined;
      for (const iteration of iterations) {
        if (firstOf(byRound.get(iteration)!) <= c.first) target = iteration;
      }
      if (target === undefined) continue;
      absorbed.add(c.id);
      const list = extra.get(target) ?? [];
      list.push(c);
      extra.set(target, list);
    }

    const rounds: WorkflowLoopRound[] = iterations.map(iteration => {
      const steps = byRound.get(iteration)!;
      const all = [...steps, ...(extra.get(iteration) ?? [])].sort(
        (x, y) => x.first - y.first,
      );
      const record = recorded.get(iteration);
      let status = roundStatus(steps);
      if (record?.status === 'failed') status = 'Failed';
      // A round with nothing open still runs until the workflow records it.
      const lastRound = iteration === iterations[iterations.length - 1];
      if (
        status === 'Completed' &&
        lastRound &&
        loopRunning &&
        upserts.length + (latest ? 1 : 0) > 0 &&
        !record
      ) {
        status = 'Running';
      }
      const starts = all.map(s => s.startTime).filter(Boolean) as string[];
      const ends = all.map(s => s.endTime).filter(Boolean) as string[];
      return dropUndefined({
        iteration,
        status,
        steps: all.map(toStep),
        startTime: starts.sort()[0] ?? record?.startTime,
        endTime:
          status === 'Running'
            ? undefined
            : record?.endTime ?? ends.sort()[ends.length - 1],
        decision: record?.decision,
        score: record?.score,
        ...roundUsage(all),
      });
    });

    // Without a loop state, a loop of a running workflow runs while a step
    // is open or nothing started after it.
    const later = nodes.some(
      n =>
        n.first > end &&
        !absorbed.has(n.id) &&
        n.loop?.loop !== name &&
        !n.internal &&
        !OUTSIDE_KINDS.has(n.kind),
    );
    let status: WorkflowLoopStatus =
      entry?.status ??
      (runOpen && !open && later ? 'done' : derivedStatus(options.status));
    // A run that ended while the loop ran: the loop goes on in the next
    // run (continued as new), or it stopped with the run.
    if (status === 'running' && options.status === 'ContinuedAsNew') {
      status = 'continued';
    } else if (status === 'running' && options.status !== 'Running') {
      status = 'failed';
    }
    const lastIteration = iterations[iterations.length - 1] ?? 0;
    return dropUndefined({
      name,
      status,
      iteration: Math.max(entry?.iteration ?? 0, lastIteration),
      maxIterations: entry?.maxIterations,
      decision: entry?.decision,
      score: entry?.score,
      rounds,
    });
  });
}
