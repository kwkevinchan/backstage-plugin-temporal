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

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import type { WorkflowProgressResponse, WorkflowSummary } from '../common';
import { temporalApiRef } from '../extensions';
import { ButtonIcon, Skeleton } from '@backstage/ui';
import { RiRefreshLine } from '@remixicon/react';
import { deadlineText } from './format';
import { statusTone } from './status';
import { tp } from './styles';

/** Most progress requests in flight at once, for all lists on the page. */
const MAX_PROGRESS_REQUESTS = 4;

type QueuedTask = {
  run: () => void;
};

let active = 0;
const queue: QueuedTask[] = [];

/**
 * Runs `task` when fewer than {@link MAX_PROGRESS_REQUESTS} are running and
 * returns a `cancel` handle that drops it from the queue before it starts.
 */
function enqueueLimited<T>(task: () => Promise<T>): {
  promise: Promise<T>;
  cancel: () => void;
} {
  let entry: QueuedTask | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    const run = () => {
      entry = undefined;
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          queue.shift()?.run();
        });
    };
    if (active < MAX_PROGRESS_REQUESTS) {
      run();
    } else {
      entry = { run };
      queue.push(entry);
    }
  });
  return {
    promise,
    cancel: () => {
      if (!entry) return;
      const index = queue.indexOf(entry);
      if (index !== -1) queue.splice(index, 1);
      entry = undefined;
    },
  };
}

/** True once the element has been on screen. */
function useSeen(ref: React.RefObject<Element>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

const TRUNCATED_LABEL = 'Partial count · first events only';
const TRUNCATED_TOOLTIP =
  'The history is long; only its first events were read, so the step count is incomplete.';

/** Count of finished steps without implying a known total. */
export function stepsDoneText(completedSteps: number): string {
  return completedSteps === 1 ? '1 step done' : `${completedSteps} steps done`;
}

/** Text of a progress: done steps and the current step or failure. */
export function progressText(progress: WorkflowProgressResponse): string {
  let steps: string;
  if (progress.status === 'Running') {
    steps = stepsDoneText(progress.completedSteps);
  } else {
    steps =
      progress.totalSteps > 0
        ? `${progress.completedSteps}/${progress.totalSteps} steps`
        : 'No steps';
  }
  const deadline = progress.currentDeadline
    ? deadlineText(progress.currentDeadline)
    : '';
  return [steps, progress.current, deadline].filter(Boolean).join(' · ');
}

/**
 * Progress of one run in a list. It is loaded only when the row is on
 * screen, with a few requests at a time; the backend caches closed runs.
 * It is loaded again when `refreshToken` changes (the Refresh button of the
 * list) and when the failed request is retried; a result of another run is
 * never shown.
 */
export function WorkflowProgress(props: {
  workflow: WorkflowSummary;
  entityRef?: string;
  refreshToken?: number;
}) {
  const { workflow, entityRef, refreshToken } = props;
  const temporalApi = useApi(temporalApiRef);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const key = JSON.stringify([
    workflow.namespace,
    workflow.workflowId,
    workflow.runId,
    entityRef,
  ]);
  const [result, setResult] = useState<{
    key: string;
    progress?: WorkflowProgressResponse;
    failed?: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  const current = result?.key === key ? result : undefined;
  const progress = current?.progress;
  const failed = current?.failed;

  useEffect(() => {
    if (!seen) return undefined;
    let cancelled = false;
    const { promise, cancel } = enqueueLimited(() =>
      temporalApi.getWorkflowProgress(
        {
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        },
        { entityRef },
      ),
    );
    promise.then(
      value => !cancelled && setResult({ key, progress: value }),
      () => !cancelled && setResult({ key, failed: true }),
    );
    return () => {
      cancelled = true;
      cancel();
    };
  }, [
    seen,
    temporalApi,
    workflow.namespace,
    workflow.workflowId,
    workflow.runId,
    entityRef,
    key,
    refreshToken,
    attempt,
  ]);

  let content;
  if (failed) {
    content = (
      <div className={tp('tp-progress-failed')}>
        <span className={tp('tp-progress-text')}>—</span>
        <ButtonIcon
          size="small"
          variant="tertiary"
          icon={<RiRefreshLine aria-hidden />}
          aria-label="Retry progress"
          onPress={() => {
            setResult(undefined);
            setAttempt(n => n + 1);
          }}
        />
      </div>
    );
  } else if (!progress) {
    content = <Skeleton width={120} height={12} />;
  } else {
    const running = progress.status === 'Running';
    let share = progress.status === 'Completed' ? 1 : 0;
    if (progress.totalSteps > 0) {
      share = progress.completedSteps / progress.totalSteps;
    }
    const text = progressText(progress);
    content = (
      <>
        {!running && (
          <div
            className={tp(
              'tp-progress-bar',
              `tp-tone-${statusTone(progress.status)}`,
            )}
            role="progressbar"
            aria-label="Steps done"
            aria-valuemin={0}
            aria-valuemax={progress.totalSteps}
            aria-valuenow={progress.completedSteps}
          >
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        )}
        <span className={tp('tp-progress-text')} title={text}>
          {text}
        </span>
        {progress.truncated && (
          <span
            className={tp('tp-progress-truncated')}
            title={TRUNCATED_TOOLTIP}
            data-testid="workflow-progress-truncated"
          >
            {TRUNCATED_LABEL}
          </span>
        )}
      </>
    );
  }
  return (
    <div
      ref={ref}
      className={tp('tp-progress')}
      data-testid="workflow-progress"
    >
      {content}
    </div>
  );
}
