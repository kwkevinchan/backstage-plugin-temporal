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

import type { ReactNode } from 'react';
import type { WorkflowNodeStatus, WorkflowStatus } from '../common';
import {
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningFill,
  RiForbidLine,
  RiHourglassLine,
  RiLoopRightLine,
  RiTimeLine,
  RiArrowRightCircleLine,
  RiQuestionLine,
} from '@remixicon/react';
import { RUN_HELP } from './RunHelp';
import { tp } from './styles';

/**
 * Color tone of a status, mapped to the `@backstage/ui` status tokens.
 *
 * @alpha
 */
export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * A workflow status or a step status.
 *
 * @alpha
 */
export type AnyStatus = WorkflowStatus | WorkflowNodeStatus;

const LABELS: Record<AnyStatus, string> = {
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
  Canceled: 'Canceled',
  Terminated: 'Terminated',
  ContinuedAsNew: 'Continued as new',
  TimedOut: 'Timed out',
  Unknown: 'Unknown',
  Scheduled: 'Scheduled',
  Retrying: 'Retrying',
  Waiting: 'Waiting',
  Rejected: 'Rejected',
};

/**
 * The label of a workflow or step status.
 *
 * @alpha
 */
export function statusLabel(status: AnyStatus): string {
  return LABELS[status] ?? status;
}

/**
 * The color tone of a workflow or step status.
 *
 * @alpha
 */
export function statusTone(status: AnyStatus): Tone {
  switch (status) {
    case 'Completed':
      return 'success';
    case 'Failed':
    case 'TimedOut':
    case 'Rejected':
      return 'danger';
    case 'Terminated':
    case 'Retrying':
      return 'warning';
    case 'Running':
    case 'ContinuedAsNew':
      return 'info';
    default:
      return 'neutral';
  }
}

/**
 * True for statuses that are still in progress.
 *
 * @alpha
 */
export function isActiveStatus(status: AnyStatus): boolean {
  return status === 'Running' || status === 'Retrying';
}

export function StatusIcon(props: { status: AnyStatus; size?: number }) {
  const size = props.size ?? 16;
  switch (props.status) {
    case 'Running':
      return (
        <span
          className={tp('tp-spinner')}
          aria-hidden
          data-testid="workflow-status-running-spinner"
        />
      );
    case 'Completed':
      return <RiCheckboxCircleFill size={size} aria-hidden />;
    case 'Failed':
    case 'Rejected':
      return <RiCloseCircleFill size={size} aria-hidden />;
    case 'TimedOut':
      return <RiTimeLine size={size} aria-hidden />;
    case 'Terminated':
      return <RiErrorWarningFill size={size} aria-hidden />;
    case 'Canceled':
      return <RiForbidLine size={size} aria-hidden />;
    case 'Retrying':
      return <RiLoopRightLine size={size} aria-hidden />;
    case 'Waiting':
    case 'Scheduled':
      return <RiHourglassLine size={size} aria-hidden />;
    case 'ContinuedAsNew':
      return <RiArrowRightCircleLine size={size} aria-hidden />;
    default:
      return <RiQuestionLine size={size} aria-hidden />;
  }
}

/**
 * Running status with a spinner that turns. With reduced motion requested,
 * the spinner stands still as a full ring.
 */
export function RunningStatus(props: { children?: ReactNode }) {
  return (
    <span
      className={tp('tp-status', 'tp-tone-info')}
      data-testid="workflow-status-running"
    >
      <StatusIcon status="Running" />
      <span className={tp('tp-status-text')}>{props.children}</span>
    </span>
  );
}

/** Status with an icon in the status color; every list and page uses it. */
export function WorkflowStatusLabel(props: { status: AnyStatus }) {
  const label = statusLabel(props.status);
  if (props.status === 'Running') {
    return <RunningStatus>{label}</RunningStatus>;
  }
  return (
    <span
      className={tp('tp-status', `tp-tone-${statusTone(props.status)}`)}
      data-status={props.status}
      // Continued as new is the Temporal name of the status; the title says
      // what it means.
      title={props.status === 'ContinuedAsNew' ? RUN_HELP : undefined}
    >
      <StatusIcon status={props.status} />
      <span className={tp('tp-status-text')}>{label}</span>
    </span>
  );
}
