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
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import {
  buildWorkflowPath,
  WORKFLOW_STATUSES,
  WorkflowStatus,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  Button,
  Cell,
  Column,
  Flex,
  Link,
  Row,
  Select,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { formatDuration, formatTime } from './format';
import { PAGE_SIZES } from './listState';
import { WorkflowProgress } from './WorkflowProgress';
import { statusLabel, WorkflowStatusLabel } from './WorkflowStatusLabel';

/** Relative link from a workflow list to a workflow's details. */
export function workflowLink(ref: {
  namespace: string;
  workflowId: string;
  runId?: string;
}): string {
  // Same shape as the backend path, without the leading slash.
  return buildWorkflowPath(ref).slice(1);
}

const ALL = 'all';

/** Status filter of the workflow lists. */
export function StatusSelect(props: {
  value: WorkflowStatus | '';
  onChange(value: WorkflowStatus | ''): void;
}) {
  return (
    <Select
      label="Status"
      size="small"
      style={{ minWidth: 160 }}
      options={[
        { id: ALL, label: 'All' },
        ...WORKFLOW_STATUSES.map(s => ({ id: s, label: statusLabel(s) })),
      ]}
      selectedKey={props.value || ALL}
      onSelectionChange={key =>
        props.onChange(
          key === ALL || !key ? '' : (String(key) as WorkflowStatus),
        )
      }
    />
  );
}

/** Previous and next page buttons, the page number and the page size. */
/**
 * Sizes offered by the "Per page" select: the usual sizes, plus the
 * current one when the URL asks for another size (`?pageSize=5`), so the
 * select shows what the list shows.
 */
export function pageSizeOptions(current: number): number[] {
  const sizes: number[] = [...PAGE_SIZES];
  if (!sizes.includes(current)) sizes.push(current);
  return sizes.sort((a, b) => a - b);
}

export function Pager(props: {
  hasPrevious: boolean;
  hasNext: boolean;
  disabled: boolean;
  onPrevious(): void;
  onNext(): void;
  page?: number;
  pageSize?: number;
  onPageSizeChange?(size: number): void;
}) {
  return (
    <Flex justify="end" align="center" gap="2" mt="3">
      {props.pageSize !== undefined && props.onPageSizeChange && (
        <Select
          label="Per page"
          size="small"
          // The select grows by default (`flex: 1`); keep it small.
          style={{ flex: '0 0 auto', width: 110 }}
          options={pageSizeOptions(props.pageSize).map(n => ({
            id: String(n),
            label: String(n),
          }))}
          selectedKey={String(props.pageSize)}
          onSelectionChange={key => key && props.onPageSizeChange!(Number(key))}
        />
      )}
      {props.page !== undefined && (
        <Text variant="body-small" color="secondary" data-testid="list-page">
          Page {props.page}
        </Text>
      )}
      <Button
        variant="secondary"
        size="small"
        isDisabled={!props.hasPrevious || props.disabled}
        onPress={props.onPrevious}
      >
        Previous page
      </Button>
      <Button
        variant="secondary"
        size="small"
        isDisabled={!props.hasNext || props.disabled}
        onPress={props.onNext}
      >
        Next page
      </Button>
    </Flex>
  );
}

interface ColumnDef {
  id: string;
  title: string;
  cell(item: WorkflowSummary): ReactNode;
}

/**
 * Workflow executions as a table, in the order of the Temporal UI: status,
 * the workflow ID (the link to the run), the workflow type (a link to its
 * TemporalWorkflow entity when there is one), progress and times.
 * `entityRef` is passed to the progress requests, so they are checked on
 * that entity.
 */
export function WorkflowRunsTable(props: {
  label: string;
  items: WorkflowSummary[];
  entityRef?: string;
  showTaskQueue?: boolean;
  /**
   * Hides the workflow type: the list of a TemporalWorkflow entity has one
   * type only.
   */
  hideType?: boolean;
  /** Adds the entity a workflow belongs to (the Workflows page). */
  showEntity?: boolean;
  emptyText: string;
  pending?: boolean;
}) {
  const columns: ColumnDef[] = [
    {
      id: 'status',
      title: 'Status',
      cell: item => <WorkflowStatusLabel status={item.status} />,
    },
    {
      id: 'workflowId',
      title: 'Workflow ID',
      cell: item => (
        <Link href={workflowLink(item)} variant="body-small" color="info">
          {item.workflowId}
        </Link>
      ),
    },
  ];
  if (!props.hideType) {
    columns.push({
      id: 'type',
      title: 'Workflow type',
      cell: item =>
        item.workflowEntityRef ? (
          <EntityRefLink entityRef={item.workflowEntityRef}>
            {item.workflowType}
          </EntityRefLink>
        ) : (
          <Text variant="body-small">{item.workflowType}</Text>
        ),
    });
  }
  columns.push({
    id: 'progress',
    title: 'Progress',
    cell: item => (
      <WorkflowProgress workflow={item} entityRef={props.entityRef} />
    ),
  });
  if (props.showTaskQueue) {
    columns.push({
      id: 'taskQueue',
      title: 'Task queue',
      cell: item => <Text variant="body-small">{item.taskQueue}</Text>,
    });
  }
  columns.push(
    {
      id: 'started',
      title: 'Started',
      cell: item => (
        <Text variant="body-small">{formatTime(item.startTime)}</Text>
      ),
    },
    {
      id: 'duration',
      title: 'Duration',
      cell: item => (
        <Text variant="body-small">
          {formatDuration(item.startTime, item.closeTime)}
        </Text>
      ),
    },
  );
  if (props.showEntity) {
    columns.push({
      id: 'entity',
      title: 'Entity',
      cell: item =>
        item.entityRef ? <EntityRefLink entityRef={item.entityRef} /> : null,
    });
  }

  return (
    <TableRoot aria-label={props.label} isPending={props.pending}>
      <TableHeader columns={columns}>
        {column => (
          <Column id={column.id} isRowHeader={column.id === 'workflowId'}>
            {column.title}
          </Column>
        )}
      </TableHeader>
      <TableBody
        items={props.items.map(item => ({
          ...item,
          id: `${item.workflowId}/${item.runId}`,
        }))}
        renderEmptyState={() => (
          <Text as="p" variant="body-medium" color="secondary">
            {props.emptyText}
          </Text>
        )}
      >
        {item => (
          <Row id={item.id} columns={columns}>
            {column => <Cell>{column.cell(item)}</Cell>}
          </Row>
        )}
      </TableBody>
    </TableRoot>
  );
}
