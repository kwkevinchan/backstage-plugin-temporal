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
import { useNavigate } from 'react-router-dom';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  entityRouteParams,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import {
  Alert,
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { ErrorAlert } from './feedback';
import { PanelCard } from './PanelCard';
import { tp } from './styles';
import { useTemporalDefaultNamespace } from './webUi';
import { Pager } from './WorkflowRunsTable';
import { useWorkflowTypeEntities } from './workflowTypes/useWorkflowTypeEntities';
import { useWorkflowTypeNumbers } from './workflowTypes/useWorkflowTypeNumbers';
import {
  COUNTS_HELP,
  Optional,
  workflowTypeColumns,
} from './workflowTypes/workflowTypeColumns';
import { WorkflowTypesFilterBar } from './workflowTypes/WorkflowTypesFilterBar';

function agoText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

/**
 * The Workflows tab of the Temporal page: one row for each
 * `TemporalWorkflow` entity the user can read, with the numbers of its
 * runs. The rows come from the catalog, one page at a time; the numbers of
 * a page are read from the backend in one request.
 */
export function WorkflowTypesList() {
  const navigate = useNavigate();
  const entityRoute = useRouteRef(entityRouteRef);
  const defaultNamespace = useTemporalDefaultNamespace();
  const entities = useWorkflowTypeEntities();
  const { filters, sort, setSort, loaded, error, pending, page, nextCursor } =
    entities;
  const [columns, setColumns] = useState<Set<Optional>>(new Set());
  const { numbers, retry, rows, requestError, rateLimited, oldest, now } =
    useWorkflowTypeNumbers(loaded);
  const columnDefs = workflowTypeColumns({ columns, defaultNamespace, retry });

  return (
    <PanelCard
      title="Workflows"
      subtitle="The TemporalWorkflow entities you can see, with the numbers of their runs."
      actions={
        oldest !== undefined && (
          <Text
            variant="body-small"
            color="secondary"
            data-testid="overview-updated"
          >
            Updated {agoText(Math.max(0, Math.round((now - oldest) / 1000)))}
          </Text>
        )
      }
    >
      <WorkflowTypesFilterBar
        filters={filters}
        columns={columns}
        onColumnsChange={setColumns}
      />
      {rateLimited && (
        <div style={{ marginBottom: 12 }}>
          <Alert
            status="warning"
            icon
            title="Temporal is rate limiting the backend"
            description="Some numbers could not be read. Retry them in a moment."
            data-testid="overview-rate-limited"
          />
        </div>
      )}
      <Text
        as="p"
        variant="body-x-small"
        color="secondary"
        style={{ margin: '0 0 8px' }}
      >
        {COUNTS_HELP}
      </Text>
      {requestError && !error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorAlert
            error={requestError}
            title="The numbers of the workflows could not be read"
          />
        </div>
      )}
      {error ? (
        <ErrorAlert error={error} />
      ) : (
        <div className={tp('tp-overview-table')}>
          <TableRoot
            aria-label="Workflows"
            isPending={pending}
            sortDescriptor={sort}
            onSortChange={descriptor =>
              setSort({
                column: 'name',
                direction: descriptor.direction,
              })
            }
          >
            <TableHeader columns={columnDefs}>
              {column => (
                <Column
                  id={column.id}
                  isRowHeader={column.id === 'name'}
                  allowsSorting={column.sortable}
                >
                  <span className={tp('tp-overview-head')} title={column.help}>
                    {column.title}
                  </span>
                </Column>
              )}
            </TableHeader>
            <TableBody
              items={rows.map(entity => ({
                id: stringifyEntityRef(entity),
                entity,
              }))}
              renderEmptyState={() =>
                pending ? null : (
                  <Text as="p" variant="body-medium" color="secondary">
                    No TemporalWorkflow entities match these filters.
                  </Text>
                )
              }
            >
              {item => (
                <Row
                  id={item.id}
                  columns={columnDefs}
                  onAction={() =>
                    navigate(entityRoute(entityRouteParams(item.entity)))
                  }
                >
                  {column => (
                    <Cell>{column.cell(item.entity, numbers[item.id])}</Cell>
                  )}
                </Row>
              )}
            </TableBody>
          </TableRoot>
        </div>
      )}
      <Pager
        page={page}
        hasPrevious={page > 1}
        hasNext={Boolean(nextCursor)}
        disabled={pending}
        onPrevious={() => entities.setCursors(c => c.slice(0, -1))}
        onNext={() => {
          if (nextCursor) entities.setCursors(c => [...c, nextCursor]);
        }}
      />
    </PanelCard>
  );
}
