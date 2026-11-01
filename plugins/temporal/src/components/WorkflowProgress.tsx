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
import type {
  WorkflowProgressResponse,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { Skeleton } from '@backstage/ui';
import { deadlineText } from './format';
import { statusTone } from './WorkflowStatusLabel';
import { tp } from './styles';

/** Most progress requests in flight at once, for all lists on the page. */
export const MAX_PROGRESS_REQUESTS = 4;

let active = 0;
const queue: (() => void)[] = [];

/** Runs `task` when fewer than {@link MAX_PROGRESS_REQUESTS} are running. */
function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          queue.shift()?.();
        });
    };
    if (active < MAX_PROGRESS_REQUESTS) run();
    else queue.push(run);
  });
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

/** Text of a progress: done steps and the current step or failure. */
export function progressText(progress: WorkflowProgressResponse): string {
  const steps =
    progress.totalSteps > 0
      ? `${progress.completedSteps}/${progress.totalSteps} steps`
      : 'No steps';
  const deadline = progress.currentDeadline
    ? deadlineText(progress.currentDeadline)
    : '';
  return [steps, progress.current, deadline].filter(Boolean).join(' · ');
}

/**
 * Progress of one run in a list. It is loaded only when the row is on
 * screen, with a few requests at a time; the backend caches closed runs.
 */
export function WorkflowProgress(props: {
  workflow: WorkflowSummary;
  entityRef?: string;
}) {
  const { workflow, entityRef } = props;
  const temporalApi = useApi(temporalApiRef);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const [progress, setProgress] = useState<WorkflowProgressResponse>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!seen) return undefined;
    let cancelled = false;
    limited(() =>
      temporalApi.getWorkflowProgress(
        {
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        },
        { entityRef },
      ),
    ).then(
      value => !cancelled && setProgress(value),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [
    seen,
    temporalApi,
    workflow.namespace,
    workflow.workflowId,
    workflow.runId,
    entityRef,
  ]);

  let content;
  if (failed) {
    content = <span className={tp('tp-progress-text')}>—</span>;
  } else if (!progress) {
    content = <Skeleton width={120} height={12} />;
  } else {
    let share = progress.status === 'Completed' ? 1 : 0;
    if (progress.totalSteps > 0) {
      share = progress.completedSteps / progress.totalSteps;
    }
    const text = progressText(progress);
    content = (
      <>
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
        <span className={tp('tp-progress-text')} title={text}>
          {text}
        </span>
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
