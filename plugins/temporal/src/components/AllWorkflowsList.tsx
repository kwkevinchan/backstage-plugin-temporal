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
import {
  EmptyState,
  InfoCard,
  Link,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import {
  isValidWorkflowIdPrefix,
  isValidWorkflowTypeName,
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
import { workflowLink } from './WorkflowList';
import { statusLabel, WorkflowStatusLabel } from './WorkflowStatusLabel';

const PAGE_SIZE = 20;

interface Filters {
  status: WorkflowStatus | '';
  workflowType: string;
  workflowIdPrefix: string;
}

const EMPTY: Filters = { status: '', workflowType: '', workflowIdPrefix: '' };

/** Every workflow of the default namespace, with filters. */
export function AllWorkflowsList() {
  const temporalApi = useApi(temporalApiRef);
  // Text fields are applied with the Search button or the Enter key.
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined]);
  const pageToken = tokens[tokens.length - 1];

  const typeError =
    draft.workflowType !== '' && !isValidWorkflowTypeName(draft.workflowType);
  const idError =
    draft.workflowIdPrefix !== '' &&
    !isValidWorkflowIdPrefix(draft.workflowIdPrefix);

  const { value, loading, error, retry } = useAsyncRetry(
    () =>
      temporalApi.listWorkflows({
        status: filters.status || undefined,
        workflowType: filters.workflowType || undefined,
        workflowIdPrefix: filters.workflowIdPrefix || undefined,
        pageSize: PAGE_SIZE,
        pageToken,
      }),
    [temporalApi, filters, pageToken],
  );

  const apply = (next: Filters) => {
    if (
      (next.workflowType && !isValidWorkflowTypeName(next.workflowType)) ||
      (next.workflowIdPrefix && !isValidWorkflowIdPrefix(next.workflowIdPrefix))
    ) {
      return;
    }
    setFilters(next);
    setTokens([undefined]);
  };
  const onEnter = (e: { key: string }) => {
    if (e.key === 'Enter') apply(draft);
  };

  const filterBar = (
    <Box display="flex" flexWrap="wrap" alignItems="flex-start" mb={2}>
      <TextField
        label="Workflow ID starts with"
        size="small"
        variant="outlined"
        value={draft.workflowIdPrefix}
        error={idError}
        helperText={idError ? 'Letters, digits and _ . : / - only' : ' '}
        onChange={e => setDraft({ ...draft, workflowIdPrefix: e.target.value })}
        onKeyDown={onEnter}
        style={{ marginRight: 8, minWidth: 220 }}
        inputProps={{ 'aria-label': 'Workflow ID search' }}
      />
      <TextField
        label="Workflow type"
        size="small"
        variant="outlined"
        value={draft.workflowType}
        error={typeError}
        helperText={typeError ? 'Not a valid workflow type' : ' '}
        onChange={e => setDraft({ ...draft, workflowType: e.target.value })}
        onKeyDown={onEnter}
        style={{ marginRight: 8, minWidth: 200 }}
        inputProps={{ 'aria-label': 'Workflow type filter' }}
      />
      <TextField
        select
        size="small"
        variant="outlined"
        label="Status"
        value={draft.status}
        helperText=" "
        style={{ marginRight: 8, minWidth: 160 }}
        onChange={e => {
          const next = {
            ...draft,
            status: e.target.value as WorkflowStatus | '',
          };
          setDraft(next);
          apply(next);
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
      <Button
        variant="outlined"
        color="primary"
        onClick={() => apply(draft)}
        disabled={typeError || idError}
        style={{ marginTop: 2 }}
      >
        Search
      </Button>
      <Button onClick={retry} style={{ marginLeft: 8, marginTop: 2 }}>
        Refresh
      </Button>
    </Box>
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
        description="No Temporal workflows match these filters."
      />
    );
  } else {
    body = (
      <Table size="small" aria-label="All workflows">
        <TableHead>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell>Workflow ID</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Task queue</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Duration</TableCell>
            <TableCell>Entity</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {value.items.map(item => {
            const entityRef = item.workflowEntityRef ?? item.entityRef;
            return (
              <TableRow key={`${item.workflowId}/${item.runId}`}>
                <TableCell>
                  <WorkflowStatusLabel status={item.status} />
                </TableCell>
                <TableCell>
                  <Link to={workflowLink(item)}>{item.workflowId}</Link>
                </TableCell>
                <TableCell>{item.workflowType}</TableCell>
                <TableCell>{item.taskQueue}</TableCell>
                <TableCell>{formatTime(item.startTime)}</TableCell>
                <TableCell>
                  {formatDuration(item.startTime, item.closeTime)}
                </TableCell>
                <TableCell>
                  {entityRef && <EntityRefLink entityRef={entityRef} />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <InfoCard
      title="All workflows"
      subheader={value ? `Namespace: ${value.namespace}` : undefined}
    >
      {filterBar}
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
