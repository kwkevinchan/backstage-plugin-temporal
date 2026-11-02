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

// Workflows of the integration test (bundled for the workflow sandbox).

import {
  ApplicationFailure,
  condition,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import { createLoops } from '../index';

type Acts = {
  draft(round: number): Promise<string>;
  review(text: string, passAt: number): Promise<{ score: number }>;
};

export async function reviewLoop(input: {
  maxIterations: number;
  passAt: number;
}) {
  const loops = createLoops();
  return loops.run<string>(
    'review',
    { maxIterations: input.maxIterations },
    async round => {
      const acts = round.activities<Acts>({ startToCloseTimeout: '10s' });
      const text = await acts.draft(round.iteration);
      const { score } = await acts.review(text, input.passAt);
      return score >= 1
        ? round.done({ value: text, score, decision: 'accept' })
        : round.next({ value: text, score, decision: 'revise' });
    },
  );
}

export async function longLoop(input: { total: number; every: number }) {
  const loops = createLoops();
  return loops.run<number>(
    'long',
    {
      maxIterations: input.total,
      continueAsNew: { afterRounds: input.every, args: [input] },
    },
    async round => {
      const acts = round.activities<Acts>({ startToCloseTimeout: '10s' });
      await acts.draft(round.iteration);
      return round.next({ value: round.iteration, score: round.iteration });
    },
  );
}

export async function failingLoop() {
  const loops = createLoops();
  return loops.run('broken', { maxIterations: 3 }, async round => {
    const acts = round.activities<Acts>({
      startToCloseTimeout: '10s',
      retry: { maximumAttempts: 1 },
    });
    await acts.draft(round.iteration);
    if (round.iteration === 2) {
      throw ApplicationFailure.nonRetryable('round 2 broke');
    }
    return round.next();
  });
}

export const proceed = defineSignal('proceed');

/** Waits for a signal in round 2, so the test can query a running loop. */
export async function waitingLoop() {
  const loops = createLoops();
  let go = false;
  setHandler(proceed, () => {
    go = true;
  });
  return loops.run('wait', { maxIterations: 3 }, async round => {
    const acts = round.activities<Acts>({ startToCloseTimeout: '10s' });
    await acts.draft(round.iteration);
    await acts.draft(round.iteration);
    round.record({ score: round.iteration / 10 });
    if (round.iteration === 2) await condition(() => go);
    return round.next();
  });
}

export async function childStep(n: number) {
  return n * 2;
}

export async function childLoop() {
  const loops = createLoops();
  return loops.run<number>('children', { maxIterations: 2 }, async round => {
    const value = await round.executeChild(childStep, {
      args: [round.iteration],
    });
    return round.next({ value });
  });
}
