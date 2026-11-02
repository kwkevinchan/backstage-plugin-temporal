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
import { useApi } from '@backstage/core-plugin-api';
import {
  isValidWorkflowIdPrefix,
  isValidWorkflowTypeName,
  WorkflowStatus,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { Button, Flex, Text, TextField } from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { StartWorkflowButton } from './controls/StartWorkflow';
import { ErrorAlert } from './feedback';
import { PanelCard } from './PanelCard';
import {
  Pager,
  StatusSelect,
  workflowLink,
  WorkflowRunsTable,
} from './WorkflowRunsTable';
import { AllRunsSwitch } from './WorkflowList';

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
  // A workflow that continues as new is listed once, with its latest run.
  const [allRuns, setAllRuns] = useState(false);
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
        allRuns: allRuns || undefined,
        workflowType: filters.workflowType || undefined,
        workflowIdPrefix: filters.workflowIdPrefix || undefined,
        pageSize: PAGE_SIZE,
        pageToken,
      }),
    [temporalApi, filters, allRuns, pageToken],
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
    <Flex align="end" gap="2" mb="3" style={{ flexWrap: 'wrap' }}>
      <TextField
        label="Workflow ID starts with"
        size="small"
        value={draft.workflowIdPrefix}
        isInvalid={idError}
        onChange={v => setDraft({ ...draft, workflowIdPrefix: v })}
        onKeyDown={onEnter}
        style={{ minWidth: 220 }}
      />
      <TextField
        label="Workflow type"
        size="small"
        value={draft.workflowType}
        isInvalid={typeError}
        onChange={v => setDraft({ ...draft, workflowType: v })}
        onKeyDown={onEnter}
        style={{ minWidth: 200 }}
      />
      <StatusSelect
        value={draft.status}
        onChange={status => {
          const next = { ...draft, status };
          setDraft(next);
          apply(next);
        }}
      />
      <Button
        variant="primary"
        size="small"
        onPress={() => apply(draft)}
        isDisabled={typeError || idError}
      >
        Search
      </Button>
      <Button variant="secondary" size="small" onPress={retry}>
        Refresh
      </Button>
      <AllRunsSwitch
        isSelected={allRuns}
        onChange={next => {
          setAllRuns(next);
          setTokens([undefined]);
        }}
      />
      <div style={{ marginLeft: 'auto' }}>
        <StartWorkflowButton workflowHref={workflowLink} />
      </div>
      {(idError || typeError) && (
        <Text as="p" variant="body-small" color="danger" role="alert">
          {idError ? 'Workflow ID: letters, digits and _ . : / - only. ' : ''}
          {typeError ? 'Not a valid workflow type.' : ''}
        </Text>
      )}
    </Flex>
  );

  return (
    <PanelCard
      title="All workflows"
      subtitle={value ? `Namespace: ${value.namespace}` : undefined}
    >
      {filterBar}
      {error ? (
        <ErrorAlert error={error} />
      ) : (
        <WorkflowRunsTable
          label="All workflows"
          items={value?.items ?? []}
          showTaskQueue
          entityColumn="any"
          pending={loading}
          emptyText="No Temporal workflows match these filters."
        />
      )}
      <Pager
        hasPrevious={tokens.length > 1}
        hasNext={Boolean(value?.nextPageToken)}
        disabled={loading}
        onPrevious={() => setTokens(t => t.slice(0, -1))}
        onNext={() => setTokens(t => [...t, value?.nextPageToken])}
      />
    </PanelCard>
  );
}
