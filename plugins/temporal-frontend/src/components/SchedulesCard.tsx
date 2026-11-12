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

import { useMemo } from 'react';
import type { Entity } from '@backstage/catalog-model';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useApi, useApiHolder } from '@backstage/core-plugin-api';
import {
  Cell,
  Column,
  Flex,
  Link,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import type { TemporalSchedule } from '../common';
import {
  temporalApiRef,
  TemporalScheduleActionDef,
  temporalWorkflowExtensionsApiRef,
} from '../extensions';
import { ErrorAlert } from './feedback';
import { formatTime } from './format';
import { PanelCard } from './PanelCard';
import { workflowLink } from './WorkflowRunsTable';
import { useShownScheduleActions } from '../control';

type ColumnDef = {
  id: string;
  title: string;
  cell: (schedule: TemporalSchedule) => React.ReactNode;
};

/**
 * The schedule actions (such as "Pause") from the props (legacy frontend
 * system) and from the shared workflow extensions API (new frontend
 * system).
 */
function useScheduleActions(
  actions: TemporalScheduleActionDef[] | undefined,
): TemporalScheduleActionDef[] {
  const shared = useApiHolder().get(temporalWorkflowExtensionsApiRef);
  return useMemo(() => {
    const all = [...(actions ?? []), ...(shared?.getScheduleActions() ?? [])];
    return all.filter((a, i) => all.findIndex(o => o.id === a.id) === i);
  }, [actions, shared]);
}

/**
 * The Temporal schedules of an entity (those that start its workflow types)
 * or of the Workflows page: when they run, the next and the last runs, and
 * whether they are paused. The card is left out for an entity without
 * schedules, and on the Workflows page for users who may not list every
 * workflow.
 */
export function SchedulesCard(props: {
  entity?: Entity;
  actions?: TemporalScheduleActionDef[];
}) {
  const { entity } = props;
  const api = useApi(temporalApiRef);
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const { value, error, loading, retry } = useAsyncRetry(
    () =>
      entityRef ? api.listEntitySchedules(entityRef) : api.listSchedules(),
    [api, entityRef],
  );
  const actions = useShownScheduleActions(useScheduleActions(props.actions));

  const status = error as
    | { statusCode?: number; response?: { status?: number } }
    | undefined;
  const forbidden =
    status?.statusCode === 403 || status?.response?.status === 403;
  if (forbidden) return null;
  if (entity && !error && (!value || value.items.length === 0)) return null;

  const columns: ColumnDef[] = [
    {
      id: 'scheduleId',
      title: 'Schedule',
      cell: s => (
        <Flex direction="column" gap="1">
          <Text variant="body-small" weight="bold">
            {s.scheduleId}
          </Text>
          {s.workflowType && (
            <Text variant="body-x-small" color="secondary">
              {s.workflowType}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'spec',
      title: 'Runs',
      cell: s => (
        <Flex direction="column" gap="1">
          {s.spec.map((line, i) => (
            <Text key={`${i}:${line}`} variant="body-small">
              {line}
            </Text>
          ))}
          {s.timezone && (
            <Text variant="body-x-small" color="secondary">
              {s.timezone}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'state',
      title: 'State',
      cell: s => (
        <Flex direction="column" gap="1">
          <Text
            variant="body-small"
            color={s.paused ? 'warning' : 'success'}
            data-testid={`schedule-state-${s.scheduleId}`}
          >
            {s.paused ? 'Paused' : 'Active'}
          </Text>
          {s.note && (
            <Text variant="body-x-small" color="secondary">
              {s.note}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'next',
      title: 'Next run',
      cell: s =>
        s.paused || s.nextActionTimes.length === 0 ? (
          <Text variant="body-small" color="secondary">
            —
          </Text>
        ) : (
          <Text variant="body-small">{formatTime(s.nextActionTimes[0])}</Text>
        ),
    },
    {
      id: 'last',
      title: 'Last run',
      cell: s => {
        const last = s.recentActions[0];
        if (!last) {
          return (
            <Text variant="body-small" color="secondary">
              —
            </Text>
          );
        }
        return (
          <Link
            href={workflowLink({
              namespace: s.namespace,
              workflowId: last.workflowId,
              runId: last.runId,
            })}
            variant="body-small"
            color="info"
          >
            {formatTime(last.takenAt)}
          </Link>
        );
      },
    },
  ];
  if (actions.length > 0) {
    columns.push({
      id: 'actions',
      title: 'Actions',
      cell: s => (
        <Flex gap="2" style={{ flexWrap: 'wrap' }}>
          {actions
            .filter(action => !action.filter || action.filter(s))
            .map(({ id, component: Action }) => (
              <Action key={id} schedule={s} entity={entity} reload={retry} />
            ))}
        </Flex>
      ),
    });
  }

  return (
    <PanelCard
      title="Schedules"
      subtitle={
        entity
          ? 'Temporal schedules that start these workflows'
          : 'Temporal schedules of the default namespace'
      }
      testId="temporal-schedules"
    >
      {error ? (
        <ErrorAlert error={error} />
      ) : (
        <TableRoot aria-label="Schedules" isPending={loading}>
          <TableHeader columns={columns}>
            {column => (
              <Column id={column.id} isRowHeader={column.id === 'scheduleId'}>
                {column.title}
              </Column>
            )}
          </TableHeader>
          <TableBody
            items={(value?.items ?? []).map(s => ({ ...s, id: s.scheduleId }))}
            renderEmptyState={() => (
              <Text as="p" variant="body-medium" color="secondary">
                No schedules.
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
      )}
      {value?.truncated && (
        <Text as="p" variant="body-x-small" color="secondary">
          Only the first 500 schedules of the namespace are read.
        </Text>
      )}
    </PanelCard>
  );
}
