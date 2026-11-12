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

import type { WorkflowLoopGroup, WorkflowLoopStatus } from '../common';
import type { Tone } from './WorkflowStatusLabel';

const LOOP_STATUS_LABELS: Record<WorkflowLoopStatus, string> = {
  running: 'Running',
  done: 'Done',
  exhausted: 'Out of rounds',
  failed: 'Failed',
  continued: 'Continued in next run',
};

export function loopStatusLabel(status: WorkflowLoopStatus): string {
  return LOOP_STATUS_LABELS[status] ?? status;
}

/** The status in a loop box, where the room is short. */
export function loopStatusShort(status: WorkflowLoopStatus): string {
  return status === 'continued' ? 'Continued' : loopStatusLabel(status);
}

export function loopTone(status: WorkflowLoopStatus): Tone {
  switch (status) {
    case 'running':
      return 'info';
    case 'done':
      return 'success';
    case 'exhausted':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'continued':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** `3/5`, or `3` for a loop without limit. */
export function roundBadge(iteration: number, loop: WorkflowLoopGroup): string {
  return loop.maxIterations
    ? `${iteration}/${loop.maxIterations}`
    : String(iteration);
}

/** `Round 3 of 5`, or `Round 3` for a loop without limit. */
export function roundLabel(iteration: number, loop: WorkflowLoopGroup): string {
  return loop.maxIterations
    ? `Round ${iteration} of ${loop.maxIterations}`
    : `Round ${iteration}`;
}

/** Decision and score of a round, for example `revise · score 0.4`. */
export function decisionText(item: {
  decision?: string;
  score?: number;
}): string {
  return [
    item.decision,
    item.score !== undefined ? `score ${item.score}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The rounds of a run: "Rounds 11–20 of 30", "Round 4 of 5". */
export function roundsText(
  rounds: { iteration: number }[],
  loop: WorkflowLoopGroup,
): string {
  if (rounds.length === 0) return 'No rounds';
  const first = rounds[0].iteration;
  const last = rounds[rounds.length - 1].iteration;
  if (first === last) return roundLabel(first, loop);
  const of = loop.maxIterations ? ` of ${loop.maxIterations}` : '';
  return `Rounds ${first}–${last}${of}`;
}
