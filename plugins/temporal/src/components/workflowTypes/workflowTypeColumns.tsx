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

import type { ReactNode, SyntheticEvent } from 'react';
import {
  Entity,
  RELATION_DEPENDENCY_OF,
  RELATION_OWNED_BY,
  RELATION_PART_OF,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  EntityRefLink,
  EntityRefLinks,
  getEntityRelations,
} from '@backstage/plugin-catalog-react';
import { ButtonIcon, Flex, Link, Skeleton, Text } from '@backstage/ui';
import { RiRefreshLine } from '@remixicon/react';
import type {
  WorkflowTypeOverview,
  WorkflowTypeOverviewRun,
} from '../../common';
import { OVERVIEW_WINDOW_DAYS } from '../../common/listLimits';
import { formatMilliseconds, formatTime } from '../format';
import { tp } from '../styles';
import { workflowLink } from '../WorkflowRunsTable';
import { WorkflowStatusLabel } from '../WorkflowStatusLabel';
import { isFailure, isOverview, RowNumbers } from './rowNumbers';

export const COUNTS_HELP =
  `Running now / completed in the last ${OVERVIEW_WINDOW_DAYS} days / failed, timed out or terminated in the last ${OVERVIEW_WINDOW_DAYS} days. ` +
  "Approximate: Temporal's visibility store is eventually consistent, and the numbers are up to a minute old.";

/** A column that the Columns menu adds. */
export type Optional = 'lifecycle' | 'source' | 'usedBy' | 'tags';
export const OPTIONAL_COLUMNS: { id: Optional; title: string }[] = [
  { id: 'lifecycle', title: 'Lifecycle' },
  { id: 'source', title: 'Namespace / Task queue' },
  { id: 'usedBy', title: 'Used by' },
  { id: 'tags', title: 'Tags' },
];

/** Keeps a press on a link in a row from also opening the row. */
const stop = (e: SyntheticEvent) => e.stopPropagation();
function Inner(props: { children: ReactNode }) {
  return (
    <span
      role="presentation"
      onPointerDown={stop}
      onClick={stop}
      onKeyDown={stop}
    >
      {props.children}
    </span>
  );
}

/** A time on two lines, the date and then the time, so that it fits a narrow column. */
function DateTime(props: { iso: string | undefined }) {
  const date = props.iso ? new Date(props.iso) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    return <>{formatTime(props.iso)}</>;
  }
  return (
    <>
      <span className={tp('tp-overview-line')}>
        {date.toLocaleDateString()}
      </span>{' '}
      <span className={tp('tp-overview-line')}>
        {date.toLocaleTimeString()}
      </span>
    </>
  );
}

function RunLink(props: { run: WorkflowTypeOverviewRun; time?: string }) {
  return (
    <Inner>
      <Link
        href={workflowLink(props.run)}
        variant="body-small"
        color="info"
        title={props.run.workflowId}
      >
        <DateTime iso={props.time ?? props.run.startTime} />
      </Link>
    </Inner>
  );
}

function Counts(props: { overview: WorkflowTypeOverview }) {
  const { running, completed, failed } = props.overview;
  const tone = (value: number, active: string) =>
    tp('tp-overview-count', value > 0 ? active : 'tp-tone-neutral');
  return (
    <span
      className={tp('tp-overview-counts')}
      title={COUNTS_HELP}
      data-testid="overview-counts"
    >
      <span className={tone(running, 'tp-tone-info')}>{running}</span>
      {' / '}
      <span className={tone(completed, 'tp-tone-success')}>{completed}</span>
      {' / '}
      <span className={tone(failed, 'tp-tone-danger')}>{failed}</span>
    </span>
  );
}

/** A column of the table of the Workflows tab. */
export interface ColumnDef {
  id: string;
  title: string;
  help?: string;
  sortable?: boolean;
  cell(entity: Entity, numbers: RowNumbers | undefined): ReactNode;
}

/** A cell that needs the numbers of its row: a placeholder until they are read. */
function numbersCell(
  numbersOf: RowNumbers | undefined,
  render: (o: WorkflowTypeOverview) => ReactNode,
  width = 80,
) {
  if (numbersOf === undefined || numbersOf === 'loading') {
    return <Skeleton width={width} height={12} />;
  }
  if (numbersOf === 'missing' || isFailure(numbersOf)) return null;
  if (numbersOf.error) return null;
  return render(numbersOf);
}

/**
 * The columns of the table of the Workflows tab: the fixed ones, then the
 * ones picked in the Columns menu.
 */
export function workflowTypeColumns(options: {
  columns: Set<Optional>;
  /** The namespace of an entity that names none. */
  defaultNamespace: string;
  /** Reads the numbers of a row again. */
  retry(ref: string): void;
}): ColumnDef[] {
  const { columns, defaultNamespace, retry } = options;
  const columnDefs: ColumnDef[] = [
    {
      id: 'name',
      title: 'Workflow',
      sortable: true,
      cell: entity => (
        <Flex direction="column" gap="0">
          <Inner>
            <EntityRefLink entityRef={entity}>
              {entity.metadata.title ?? entity.metadata.name}
            </EntityRefLink>
          </Inner>
          {entity.metadata.description && (
            <Text variant="body-x-small" color="secondary">
              {entity.metadata.description}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'owner',
      title: 'Owner',
      cell: entity => {
        const owners = getEntityRelations(entity, RELATION_OWNED_BY);
        return owners.length > 0 ? (
          <Inner>
            <EntityRefLinks entityRefs={owners} defaultKind="group" />
          </Inner>
        ) : null;
      },
    },
    {
      id: 'system',
      title: 'System',
      cell: entity => {
        const systems = getEntityRelations(entity, RELATION_PART_OF, {
          kind: 'system',
        });
        return systems.length > 0 ? (
          <Inner>
            <EntityRefLinks entityRefs={systems} defaultKind="system" />
          </Inner>
        ) : null;
      },
    },
    {
      id: 'counts',
      title: 'Running / Completed / Failed',
      help: COUNTS_HELP,
      cell: (entity, n) => {
        const ref = stringifyEntityRef(entity);
        const rowError = isFailure(n)
          ? n.failure.error.message
          : isOverview(n) && n.error?.message;
        if (rowError) {
          return (
            <Flex align="center" gap="1">
              <span title={rowError} data-testid="overview-error">
                —
              </span>
              <Inner>
                <ButtonIcon
                  size="small"
                  variant="tertiary"
                  icon={<RiRefreshLine aria-hidden />}
                  aria-label={`Retry ${entity.metadata.name}`}
                  onPress={() => retry(ref)}
                />
              </Inner>
            </Flex>
          );
        }
        return numbersCell(n, o => <Counts overview={o} />);
      },
    },
    {
      id: 'latestRun',
      title: 'Latest run',
      cell: (_entity, n) =>
        numbersCell(n, o =>
          o.latestRun ? (
            <Flex direction="column" align="start" gap="1">
              <WorkflowStatusLabel status={o.latestRun.status} />
              <RunLink run={o.latestRun} />
            </Flex>
          ) : (
            <Text variant="body-small" color="secondary">
              No runs
            </Text>
          ),
        ),
    },
    {
      id: 'duration',
      title: 'Average (last 50)',
      help: 'Mean duration of the closed runs among the 50 most recent runs.',
      cell: (_entity, n) =>
        numbersCell(n, o => (
          <Text variant="body-small">
            {o.averageDurationMs !== undefined
              ? formatMilliseconds(o.averageDurationMs)
              : ''}
          </Text>
        )),
    },
    {
      id: 'lastFailure',
      title: `Last failure (${OVERVIEW_WINDOW_DAYS} days)`,
      cell: (_entity, n) =>
        numbersCell(n, o =>
          o.lastFailure ? (
            <RunLink run={o.lastFailure} time={o.lastFailure.closeTime} />
          ) : null,
        ),
    },
  ];
  for (const optional of OPTIONAL_COLUMNS) {
    if (!columns.has(optional.id)) continue;
    columnDefs.push({
      id: optional.id,
      title: optional.title,
      cell: entity => {
        const spec = (entity.spec ?? {}) as Record<string, unknown>;
        switch (optional.id) {
          case 'lifecycle':
            return (
              <Text variant="body-small">{String(spec.lifecycle ?? '')}</Text>
            );
          case 'source':
            return (
              <Text variant="body-small">
                {String(spec.namespace ?? defaultNamespace)}
                {spec.taskQueue ? ` / ${String(spec.taskQueue)}` : ''}
              </Text>
            );
          case 'usedBy': {
            const usedBy = getEntityRelations(entity, RELATION_DEPENDENCY_OF);
            return usedBy.length > 0 ? (
              <Inner>
                <EntityRefLinks entityRefs={usedBy} />
              </Inner>
            ) : null;
          }
          default:
            return (
              <Text variant="body-small">
                {(entity.metadata.tags ?? []).join(', ')}
              </Text>
            );
        }
      },
    });
  }
  return columnDefs;
}
