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
import { AnyStatus, statusLabel, statusTone } from './status';
import { tp } from './styles';

function StatusIcon(props: { status: AnyStatus; size?: number }) {
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

/** Status with an icon in the status color; every list and page uses it. */
export function WorkflowStatusLabel(props: { status: AnyStatus }) {
  const label = statusLabel(props.status);
  if (props.status === 'Running') {
    // The spinner turns; with reduced motion requested it stands still as a
    // full ring.
    return (
      <span
        className={tp('tp-status', 'tp-tone-info')}
        data-testid="workflow-status-running"
      >
        <StatusIcon status="Running" />
        <span className={tp('tp-status-text')}>{label}</span>
      </span>
    );
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
