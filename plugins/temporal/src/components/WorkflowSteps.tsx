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

import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import type { WorkflowRef } from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import Box from '@material-ui/core/Box';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Typography from '@material-ui/core/Typography';
import useAsync from 'react-use/esm/useAsync';
import { FailureView } from './FailureView';
import { formatDuration } from './format';
import { PayloadView } from './PayloadView';

/** Workflow input and result, and the input and output of every activity. */
export function WorkflowSteps(props: {
  workflowRef: WorkflowRef;
  entityRef?: string;
}) {
  const { workflowRef, entityRef } = props;
  const temporalApi = useApi(temporalApiRef);
  const { value, loading, error } = useAsync(
    () => temporalApi.getWorkflowSteps(workflowRef, { entityRef }),
    [temporalApi, workflowRef, entityRef],
  );

  if (loading) return <Progress />;
  if (error || !value) {
    return <ResponseErrorPanel error={error ?? new Error('No data')} />;
  }

  return (
    <Box>
      <Box display="flex" flexWrap="wrap" mb={2}>
        <Box flex="1 1 300px" mr={2} mb={1} data-testid="workflow-input">
          <Typography variant="subtitle2">Workflow input</Typography>
          <PayloadView payload={value.input} />
        </Box>
        <Box flex="1 1 300px" mb={1} data-testid="workflow-result">
          <Typography variant="subtitle2">Workflow result</Typography>
          <PayloadView payload={value.result} />
        </Box>
      </Box>
      <Table size="small" aria-label="Activities">
        <TableHead>
          <TableRow>
            <TableCell>Activity</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Duration</TableCell>
            <TableCell>Input</TableCell>
            <TableCell>Output</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {value.activities.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>No activities</TableCell>
            </TableRow>
          )}
          {value.activities.map(a => (
            <TableRow key={a.scheduledEventId} style={{ verticalAlign: 'top' }}>
              <TableCell>
                <Typography variant="body2">{a.activityType}</Typography>
                <Typography variant="caption" color="textSecondary">
                  ID {a.activityId}
                  {a.attempt && a.attempt > 1 ? ` · attempt ${a.attempt}` : ''}
                </Typography>
              </TableCell>
              <TableCell>{a.status}</TableCell>
              <TableCell>
                {formatDuration(a.scheduledTime, a.closeTime)}
              </TableCell>
              <TableCell style={{ maxWidth: 360 }}>
                <PayloadView payload={a.input} />
              </TableCell>
              <TableCell style={{ maxWidth: 360 }}>
                {a.failure ? (
                  <FailureView failure={a.failure} />
                ) : (
                  <PayloadView payload={a.result} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {value.truncated && (
        <Typography variant="caption" color="textSecondary">
          The history is long; only the first events were read.
        </Typography>
      )}
    </Box>
  );
}
