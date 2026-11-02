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

import {
  ActivityInterfaceFor,
  ActivityOptions,
  ChildWorkflowOptions,
  ContinueAsNewOptions,
  defineQuery,
  executeChild as temporalExecuteChild,
  makeContinueAsNewFunc,
  proxyActivities,
  setHandler,
  upsertMemo,
  Workflow,
  workflowInfo,
  WorkflowResultType,
} from '@temporalio/workflow';
import {
  formatLoopMarker,
  LoopMarker,
  LOOP_MARKER_MEMO_KEY,
  LOOP_STATE_MEMO_KEY,
  LOOP_STATE_QUERY,
  LOOP_STATE_VERSION,
} from './marker';
import type {
  LoopRoundState,
  LoopState,
  LoopsState,
  LoopStatus,
} from './state';

/** Most rounds per loop the query returns; older rounds are in the history. */
export const MAX_QUERY_ROUNDS = 500;

/**
 * When a loop continues as new: after a number of rounds in one run, or
 * when Temporal suggests it (the history grows long).
 *
 * @public
 */
export interface LoopContinueAsNewOptions {
  /** Continue as new after this many rounds in one run. */
  afterRounds?: number;
  /** Continue as new when `workflowInfo().continueAsNewSuggested` is true. */
  whenSuggested?: boolean;
  /** Arguments of the next run, usually the workflow input. */
  args: unknown[] | (() => unknown[]);
  /** Other options of the next run (task queue, timeouts). */
  options?: ContinueAsNewOptions;
}

/**
 * Options of one loop.
 *
 * @public
 */
export interface LoopOptions {
  /** Most rounds; the loop is `exhausted` after the last one. */
  maxIterations?: number;
  continueAsNew?: LoopContinueAsNewOptions;
}

/**
 * What a round decided, returned by {@link LoopRound.done} and
 * {@link LoopRound.next}.
 *
 * @public
 */
export interface LoopRoundOutcome<T> {
  readonly kind: 'done' | 'next';
  value?: T;
  decision?: string;
  score?: number;
}

/**
 * Decision, score and value of a round.
 *
 * @public
 */
export interface LoopRoundResult<T> {
  /** The value the loop returns (the last one when it is exhausted). */
  value?: T;
  /** Decision of the round, shown in Backstage, for example `revise`. */
  decision?: string;
  /** Score of the round, shown in Backstage. */
  score?: number;
}

/**
 * Result of {@link Loops.run}.
 *
 * @public
 */
export interface LoopResult<T> {
  status: 'done' | 'exhausted';
  /** The last round. */
  iterations: number;
  /**
   * Value of the last round. Left out when the loop ended in an earlier
   * run of a workflow that continued as new.
   */
  value?: T;
  decision?: string;
  score?: number;
}

/**
 * One round of a loop. Activities and child workflows started through it
 * carry the loop marker.
 *
 * @public
 */
export interface LoopRound {
  readonly loop: string;
  /** The round, from 1, counted across continue-as-new runs. */
  readonly iteration: number;
  readonly maxIterations?: number;
  /** Run of the workflow, from 1. */
  readonly segment: number;
  /**
   * Activities of this round, like `proxyActivities`. Each call gets the
   * activity ID `loop/<loop>/<iteration>/<activity type>` and a summary.
   */
  activities<A = Record<string, (...args: any[]) => any>>(
    options: ActivityOptions,
  ): ActivityInterfaceFor<A>;
  /**
   * Activity options with the marker of one call of `step`, for your own
   * `proxyActivities`. Call it once per scheduled activity.
   */
  activityOptions(step: string, options: ActivityOptions): ActivityOptions;
  /**
   * Child workflow options with the marker of one call of `step`: a memo
   * entry and, without a workflow ID, the ID `<parent ID>/loop/...`.
   */
  childOptions<O extends ChildWorkflowOptions>(step: string, options: O): O;
  /** `executeChild` with the marker; the step is the workflow type. */
  executeChild<T extends Workflow>(
    workflow: string | T,
    options?: ChildWorkflowOptions & { args?: Parameters<T> },
  ): Promise<WorkflowResultType<T>>;
  /** Sets the decision and score of the round before it ends. */
  record(result: { decision?: string; score?: number }): void;
  /** Ends the loop: the result is good enough. */
  done<T>(result?: LoopRoundResult<T>): LoopRoundOutcome<T>;
  /** Ends the round; the next one starts unless this was the last. */
  next<T>(result?: LoopRoundResult<T>): LoopRoundOutcome<T>;
}

/**
 * Options of {@link createLoops}.
 *
 * @public
 */
export interface CreateLoopsOptions {
  /**
   * State to continue from, for example from the workflow input. Without
   * it, a run that continued as new reads the `temporal.loops` memo.
   */
  resume?: LoopsState;
  /** False: no memo upserts (Backstage then shows no decisions of ended runs). */
  memo?: boolean;
}

function now(): string {
  // The workflow clock: deterministic in the sandbox.
  return new Date(Date.now()).toISOString();
}

function isLoopsState(value: unknown): value is LoopsState {
  const v = value as LoopsState | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.segment === 'number' &&
    Array.isArray(v.loops)
  );
}

function clean<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

/**
 * Loops of one workflow. Create it once, at the start of the workflow
 * function; it registers the `__loop_state` query.
 *
 * @public
 */
export class Loops {
  private readonly segment: number;
  private readonly loops: LoopState[] = [];
  private readonly rounds = new Map<string, LoopRoundState[]>();
  private readonly memoEnabled: boolean;

  constructor(options: CreateLoopsOptions = {}) {
    this.memoEnabled = options.memo !== false;
    const resume = options.resume ?? Loops.memoState();
    this.segment = resume?.segment ?? 1;
    for (const loop of resume?.loops ?? []) {
      const { rounds: _rounds, ...rest } = loop;
      this.loops.push({ ...rest });
    }
    setHandler(defineQuery<LoopsState>(LOOP_STATE_QUERY), () => this.state());
  }

  /** The state in the memo of a run that continued as new. */
  private static memoState(): LoopsState | undefined {
    const info = workflowInfo();
    if (!info.continuedFromExecutionRunId) return undefined;
    const value = info.memo?.[LOOP_STATE_MEMO_KEY];
    return isLoopsState(value) ? value : undefined;
  }

  /** The state of all loops, with the rounds of this run. */
  state(): LoopsState {
    return {
      v: LOOP_STATE_VERSION,
      segment: this.segment,
      loops: this.loops.map(loop =>
        clean({
          ...loop,
          rounds: (this.rounds.get(loop.name) ?? []).slice(-MAX_QUERY_ROUNDS),
        }),
      ),
    };
  }

  /** One loop, or undefined before it started. */
  get(name: string): LoopState | undefined {
    const loop = this.loops.find(l => l.name === name);
    return loop ? { ...loop } : undefined;
  }

  /** The state the next run continues from (its segment is one more). */
  snapshot(): LoopsState {
    return {
      v: LOOP_STATE_VERSION,
      segment: this.segment + 1,
      loops: this.loops.map(loop => ({ ...loop })),
    };
  }

  /**
   * Continues as new with the loop state in the memo, so the next run's
   * {@link createLoops} continues the round count.
   */
  async continueAsNew(
    args: unknown[],
    options: ContinueAsNewOptions = {},
  ): Promise<never> {
    const memo = {
      ...(workflowInfo().memo ?? {}),
      ...(options.memo ?? {}),
      [LOOP_STATE_MEMO_KEY]: this.snapshot(),
    };
    const next = makeContinueAsNewFunc<(...a: unknown[]) => Promise<unknown>>({
      ...options,
      memo,
    });
    return next(...args);
  }

  /**
   * Runs `body` once per round until a round returns `round.done()`, the
   * last round (`maxIterations`) ends, or a round throws. A loop that
   * already ended in an earlier run returns its result without running.
   */
  async run<T>(
    name: string,
    options: LoopOptions,
    body: (
      round: LoopRound,
    ) => Promise<LoopRoundOutcome<T> | void> | LoopRoundOutcome<T> | void,
  ): Promise<LoopResult<T>> {
    if (!name) throw new TypeError('The loop name must not be empty');
    const max = options.maxIterations;
    if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
      throw new TypeError('maxIterations must be an integer from 1');
    }
    let loop = this.loops.find(l => l.name === name);
    if (loop && (loop.status === 'done' || loop.status === 'exhausted')) {
      return clean({
        status: loop.status,
        iterations: loop.iteration,
        decision: loop.decision,
        score: loop.score,
      });
    }
    if (!loop) {
      loop = { name, iteration: 0, status: 'running' };
      this.loops.push(loop);
    }
    loop.status = 'running';
    if (max !== undefined) loop.maxIterations = max;
    else delete loop.maxIterations;
    const rounds = this.rounds.get(name) ?? [];
    this.rounds.set(name, rounds);

    let roundsInRun = 0;
    let lastValue: T | undefined;
    for (;;) {
      const iteration = loop.iteration + 1;
      loop.iteration = iteration;
      const record: LoopRoundState = {
        iteration,
        segment: this.segment,
        status: 'running',
        startTime: now(),
      };
      rounds.push(record);
      if (rounds.length > MAX_QUERY_ROUNDS) rounds.shift();
      const round = this.round(loop, record);
      let outcome: LoopRoundOutcome<T> | void;
      try {
        outcome = await body(round);
      } catch (error) {
        record.status = 'failed';
        record.endTime = now();
        loop.status = 'failed';
        this.upsert(loop, record);
        throw error;
      }
      roundsInRun += 1;
      record.status = 'completed';
      record.endTime = now();
      if (outcome?.decision !== undefined) record.decision = outcome.decision;
      if (outcome?.score !== undefined) record.score = outcome.score;
      if (record.decision !== undefined) loop.decision = record.decision;
      if (record.score !== undefined) loop.score = record.score;
      if (outcome && 'value' in outcome) lastValue = outcome.value;
      let status: LoopStatus = 'running';
      if (outcome?.kind === 'done') status = 'done';
      else if (max !== undefined && iteration >= max) status = 'exhausted';
      loop.status = status;
      this.upsert(loop, record);
      if (status !== 'running') {
        return clean({
          status,
          iterations: iteration,
          value: lastValue,
          decision: loop.decision,
          score: loop.score,
        });
      }
      const can = options.continueAsNew;
      if (
        can &&
        ((can.afterRounds !== undefined && roundsInRun >= can.afterRounds) ||
          (can.whenSuggested && workflowInfo().continueAsNewSuggested))
      ) {
        const args = typeof can.args === 'function' ? can.args() : can.args;
        await this.continueAsNew(args, can.options);
      }
    }
  }

  private upsert(loop: LoopState, record: LoopRoundState) {
    if (!this.memoEnabled) return;
    const state: LoopsState = {
      v: LOOP_STATE_VERSION,
      segment: this.segment,
      loops: this.loops.map(l => ({ ...l })),
      last: clean({ loop: loop.name, ...record }),
    };
    upsertMemo({ [LOOP_STATE_MEMO_KEY]: state });
  }

  private round(loop: LoopState, record: LoopRoundState): LoopRound {
    const counts = new Map<string, number>();
    const marker = (step: string): LoopMarker => {
      const occurrence = (counts.get(step) ?? 0) + 1;
      counts.set(step, occurrence);
      return clean({
        loop: loop.name,
        iteration: record.iteration,
        step,
        occurrence: occurrence > 1 ? occurrence : undefined,
      });
    };
    const summary = (step: string) =>
      `${loop.name} · round ${record.iteration} · ${step}`;
    const activityOptions = (
      step: string,
      options: ActivityOptions,
    ): ActivityOptions => ({
      ...options,
      activityId: formatLoopMarker(marker(step)),
      summary: options.summary ?? summary(step),
    });
    const childOptions = <O extends ChildWorkflowOptions>(
      step: string,
      options: O,
    ): O => {
      const m = marker(step);
      return {
        ...options,
        workflowId:
          options.workflowId ??
          `${workflowInfo().workflowId}/${formatLoopMarker(m)}`,
        staticSummary: options.staticSummary ?? summary(step),
        memo: { ...(options.memo ?? {}), [LOOP_MARKER_MEMO_KEY]: m },
      };
    };
    const outcome =
      (kind: 'done' | 'next') =>
      <T>(result: LoopRoundResult<T> = {}): LoopRoundOutcome<T> => ({
        kind,
        ...result,
      });
    return {
      loop: loop.name,
      iteration: record.iteration,
      maxIterations: loop.maxIterations,
      segment: this.segment,
      activities<A>(options: ActivityOptions) {
        return new Proxy(
          {},
          {
            get(_target, property) {
              // Not a thenable, and no symbols.
              if (typeof property !== 'string' || property === 'then') {
                return undefined;
              }
              return (...args: unknown[]) => {
                const proxy = proxyActivities<any>(
                  activityOptions(property, options),
                );
                return proxy[property](...args);
              };
            },
          },
        ) as ActivityInterfaceFor<A>;
      },
      activityOptions,
      childOptions,
      executeChild<T extends Workflow>(
        workflow: string | T,
        options: ChildWorkflowOptions & { args?: Parameters<T> } = {},
      ) {
        const step = typeof workflow === 'string' ? workflow : workflow.name;
        return temporalExecuteChild(
          workflow as string,
          childOptions(step, options) as any,
        ) as Promise<WorkflowResultType<T>>;
      },
      record(result) {
        if (result.decision !== undefined) record.decision = result.decision;
        if (result.score !== undefined) record.score = result.score;
      },
      done: outcome('done'),
      next: outcome('next'),
    };
  }
}

/**
 * The loops of a workflow. Call it once at the start of the workflow
 * function: it registers the `__loop_state` query and, in a run that
 * continued as new, continues the round count from the memo.
 *
 * @public
 */
export function createLoops(options?: CreateLoopsOptions): Loops {
  return new Loops(options);
}
