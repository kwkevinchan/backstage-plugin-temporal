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
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import type { WorkflowStatus } from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { Button } from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { ErrorAlert } from './feedback';
import { PanelCard } from './PanelCard';
import { Pager, StatusSelect, WorkflowRunsTable } from './WorkflowRunsTable';
import { statusLabel } from './WorkflowStatusLabel';

export { workflowLink } from './WorkflowRunsTable';

const PAGE_SIZE = 20;

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

  // Runs listed through a TemporalWorkflow entity the entity depends on.
  const showWorkflowEntity = value?.items.some(i => i.workflowEntityRef);

  return (
    <PanelCard
      title={props.title ?? 'Temporal workflows'}
      subtitle={value ? `Namespace: ${value.namespace}` : undefined}
      actions={
        <>
          <StatusSelect
            value={status}
            onChange={next => {
              setStatus(next);
              setTokens([undefined]);
            }}
          />
          <Button variant="secondary" size="small" onPress={retry}>
            Refresh
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorAlert error={error} />
      ) : (
        <WorkflowRunsTable
          label="Workflows"
          items={value?.items ?? []}
          entityRef={entityRef}
          entityColumn={showWorkflowEntity ? 'workflow' : undefined}
          pending={loading}
          emptyText={
            status
              ? `No workflows with status ${statusLabel(status)}.`
              : 'No Temporal workflows were found for this entity.'
          }
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
