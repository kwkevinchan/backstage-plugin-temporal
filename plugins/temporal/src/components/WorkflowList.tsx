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

import { useState } from 'react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  EmptyState,
  InfoCard,
  Link,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { EntityRefLink, useEntity } from '@backstage/plugin-catalog-react';
import {
  buildWorkflowPath,
  WORKFLOW_STATUSES,
  WorkflowStatus,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import MenuItem from '@material-ui/core/MenuItem';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import TextField from '@material-ui/core/TextField';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { formatDuration, formatTime } from './format';
import { statusLabel, WorkflowStatusLabel } from './WorkflowStatusLabel';

const PAGE_SIZE = 20;

/** Relative link from the entity tab to a workflow's details. */
export function workflowLink(ref: {
  namespace: string;
  workflowId: string;
  runId?: string;
}): string {
  // Same shape as the backend path, without the leading slash.
  return buildWorkflowPath(ref).slice(1);
}

/** Workflow list of the current entity. */
export function WorkflowList(props: { title?: string }) {
  const { entity } = useEntity();
  const temporalApi = useApi(temporalApiRef);
  const entityRef = stringifyEntityRef(entity);
  const [status, setStatus] = useState<WorkflowStatus | ''>('');
  // Page tokens of the pages seen so far; the last one is the current page.
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined]);
  const pageToken = tokens[tokens.length - 1];

  const { value, loading, error, retry } = useAsyncRetry(
    () =>
      temporalApi.listEntityWorkflows(entityRef, {
        status: status || undefined,
        pageSize: PAGE_SIZE,
        pageToken,
      }),
    [temporalApi, entityRef, status, pageToken],
  );

  const filter = (
    <TextField
      select
      size="small"
      variant="outlined"
      label="Status"
      value={status}
      style={{ minWidth: 160 }}
      onChange={e => {
        setStatus(e.target.value as WorkflowStatus | '');
        setTokens([undefined]);
      }}
      SelectProps={{ inputProps: { 'aria-label': 'Status filter' } }}
    >
      <MenuItem value="">All</MenuItem>
      {WORKFLOW_STATUSES.map(s => (
        <MenuItem key={s} value={s}>
          {statusLabel(s)}
        </MenuItem>
      ))}
    </TextField>
  );

  let body;
  if (loading) {
    body = <Progress />;
  } else if (error) {
    body = <ResponseErrorPanel error={error} />;
  } else if (!value || value.items.length === 0) {
    body = (
      <EmptyState
        missing="data"
        title="No workflows"
        description={
          status
            ? `No workflows with status ${statusLabel(status)}.`
            : 'No Temporal workflows were found for this entity.'
        }
      />
    );
  } else {
    // Runs listed through a TemporalWorkflow entity the entity depends on.
    const showWorkflowEntity = value.items.some(i => i.workflowEntityRef);
    body = (
      <Table size="small" aria-label="Workflows">
        <TableHead>
          <TableRow>
            <TableCell>Workflow ID</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Ended</TableCell>
            <TableCell>Duration</TableCell>
            {showWorkflowEntity && <TableCell>Workflow entity</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {value.items.map(item => (
            <TableRow key={`${item.workflowId}/${item.runId}`}>
              <TableCell>
                <Link to={workflowLink(item)}>{item.workflowId}</Link>
              </TableCell>
              <TableCell>{item.workflowType}</TableCell>
              <TableCell>
                <WorkflowStatusLabel status={item.status} />
              </TableCell>
              <TableCell>{formatTime(item.startTime)}</TableCell>
              <TableCell>{formatTime(item.closeTime)}</TableCell>
              <TableCell>
                {formatDuration(item.startTime, item.closeTime)}
              </TableCell>
              {showWorkflowEntity && (
                <TableCell>
                  {item.workflowEntityRef && (
                    <EntityRefLink entityRef={item.workflowEntityRef} />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <InfoCard
      title={props.title ?? 'Temporal workflows'}
      subheader={value ? `Namespace: ${value.namespace}` : undefined}
      action={
        <Box display="flex" alignItems="center" mt={1} mr={1}>
          {filter}
          <Button style={{ marginLeft: 8 }} onClick={retry}>
            Refresh
          </Button>
        </Box>
      }
    >
      {body}
      <Box display="flex" justifyContent="flex-end" mt={2}>
        <Button
          disabled={tokens.length <= 1 || loading}
          onClick={() => setTokens(t => t.slice(0, -1))}
        >
          Previous page
        </Button>
        <Button
          disabled={!value?.nextPageToken || loading}
          onClick={() => setTokens(t => [...t, value?.nextPageToken])}
        >
          Next page
        </Button>
      </Box>
    </InfoCard>
  );
}
