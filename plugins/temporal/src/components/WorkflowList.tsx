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

import { stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { isTemporalWorkflowEntity } from '../common';
import { temporalApiRef } from '../extensions';
import { Alert, Button, Switch } from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { StartWorkflowButton } from './controls/StartWorkflow';
import { ErrorAlert } from './feedback';
import { useListScroll, useWorkflowListState } from './listState';
import { PanelCard } from './PanelCard';
import {
  Pager,
  StatusSelect,
  workflowLink,
  WorkflowRunsTable,
} from './WorkflowRunsTable';
import { statusLabel } from './WorkflowStatusLabel';

export { workflowLink } from './WorkflowRunsTable';

/**
 * Switch of the workflow lists: off lists only the latest run of a workflow
 * that continues as new.
 */
export function AllRunsSwitch(props: {
  isSelected: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <Switch
      label="Show all runs"
      isSelected={props.isSelected}
      onChange={props.onChange}
    />
  );
}

/** Notice when a page of the list could not be opened again. */
export function LostPageNotice(props: { page?: number }) {
  if (!props.page) return null;
  return (
    <Alert
      status="info"
      icon
      title={`Page ${props.page} could not be opened again, so the first page is shown.`}
      style={{ marginBottom: 12 }}
      data-testid="list-lost-page"
    />
  );
}

/** Workflow list of the current entity. */
export function WorkflowList(props: { title?: string }) {
  const { entity } = useEntity();
  const temporalApi = useApi(temporalApiRef);
  const entityRef = stringifyEntityRef(entity);
  // Filters, page and page size live in the URL, so they are kept when a
  // workflow is opened and the user comes back.
  const list = useWorkflowListState();
  const { status, allRuns } = list.filters;

  const { value, loading, error, retry } = useAsyncRetry(
    () =>
      temporalApi.listEntityWorkflows(entityRef, {
        status: status || undefined,
        allRuns: allRuns || undefined,
        pageSize: list.pageSize,
        pageToken: list.pageToken,
      }),
    [temporalApi, entityRef, status, allRuns, list.pageSize, list.pageToken],
  );
  const scrollRef = useListScroll(Boolean(value) && !loading);

  // Runs listed through a TemporalWorkflow entity the entity depends on.
  const showWorkflowEntity = value?.items.some(i => i.workflowEntityRef);

  return (
    <div ref={scrollRef}>
      <PanelCard
        title={props.title ?? 'Temporal workflows'}
        subtitle={value ? `Namespace: ${value.namespace}` : undefined}
        actions={
          <>
            <AllRunsSwitch
              isSelected={allRuns}
              onChange={next =>
                list.setFilters({ ...list.filters, allRuns: next })
              }
            />
            <StatusSelect
              value={status}
              onChange={next =>
                list.setFilters({ ...list.filters, status: next })
              }
            />
            <Button variant="secondary" size="small" onPress={retry}>
              Refresh
            </Button>
            {isTemporalWorkflowEntity(entity) && (
              <StartWorkflowButton
                entity={entity}
                workflowHref={workflowLink}
              />
            )}
          </>
        }
      >
        <LostPageNotice page={list.lostPage} />
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
          page={list.page}
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
          hasPrevious={list.page > 1}
          hasNext={Boolean(value?.nextPageToken)}
          disabled={loading}
          onPrevious={list.previousPage}
          onNext={() => list.nextPage(value?.nextPageToken)}
        />
      </PanelCard>
    </div>
  );
}
