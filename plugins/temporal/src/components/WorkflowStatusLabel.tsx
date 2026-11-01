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
import {
  StatusAborted,
  StatusError,
  StatusOK,
  StatusPending,
  StatusWarning,
} from '@backstage/core-components';
import Box from '@material-ui/core/Box';
import CircularProgress from '@material-ui/core/CircularProgress';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import type { WorkflowStatus } from '@kwkevinchan/backstage-plugin-temporal-common';

const LABELS: Record<WorkflowStatus, string> = {
  Running: 'Running',
  Completed: 'Completed',
  Failed: 'Failed',
  Canceled: 'Canceled',
  Terminated: 'Terminated',
  ContinuedAsNew: 'Continued as new',
  TimedOut: 'Timed out',
  Unknown: 'Unknown',
};

export function statusLabel(status: WorkflowStatus): string {
  return LABELS[status] ?? status;
}

/**
 * Running status with a spinner that turns. With reduced motion requested,
 * the spinner stands still as a three-quarter circle.
 */
export function RunningStatus(props: { children?: ReactNode }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <Box
      component="span"
      display="inline-flex"
      alignItems="center"
      data-testid="workflow-status-running"
    >
      <Box
        component="span"
        position="relative"
        display="inline-flex"
        mr={1}
        aria-hidden
      >
        {/* Faint full ring, so the icon is visible at every frame. */}
        <CircularProgress
          size={14}
          thickness={5}
          variant="determinate"
          value={100}
          style={{ opacity: 0.25 }}
        />
        <CircularProgress
          size={14}
          thickness={5}
          variant={reducedMotion ? 'determinate' : 'indeterminate'}
          value={reducedMotion ? 75 : undefined}
          disableShrink
          data-testid="workflow-status-running-spinner"
          style={{ position: 'absolute', left: 0, top: 0 }}
        />
      </Box>
      {props.children}
    </Box>
  );
}

/**
 * Status with the Backstage status icons; every list and page uses it.
 */
export function WorkflowStatusLabel(props: { status: WorkflowStatus }) {
  const label = statusLabel(props.status);
  switch (props.status) {
    case 'Completed':
      return <StatusOK>{label}</StatusOK>;
    case 'Running':
      return <RunningStatus>{label}</RunningStatus>;
    case 'Failed':
    case 'TimedOut':
      return <StatusError>{label}</StatusError>;
    case 'Terminated':
      return <StatusWarning>{label}</StatusWarning>;
    case 'Canceled':
      return <StatusAborted>{label}</StatusAborted>;
    default:
      return <StatusPending>{label}</StatusPending>;
  }
}
