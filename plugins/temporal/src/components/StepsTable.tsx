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

import type { WorkflowGraphNode } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { formatDuration, formatTime } from './format';
import { kindLabel, retryBadge } from './steps';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';

/**
 * The steps of a run as a table, in event order. Selecting a row opens the
 * step next to the graph.
 */
export function StepsTable(props: {
  steps: WorkflowGraphNode[];
  onSelect(id: string): void;
}) {
  const steps = props.steps.filter(s => !s.internal);
  return (
    <TableRoot
      aria-label="Steps"
      onRowAction={key => props.onSelect(String(key))}
    >
      <TableHeader>
        <Column isRowHeader>Step</Column>
        <Column>Kind</Column>
        <Column>Status</Column>
        <Column>Attempts</Column>
        <Column>Started</Column>
        <Column>Duration</Column>
        <Column>Notes</Column>
      </TableHeader>
      <TableBody
        renderEmptyState={() => <Text color="secondary">No steps</Text>}
      >
        {steps.map(step => (
          <Row key={step.id} id={step.id}>
            <Cell>
              <Text variant="body-small" weight="bold">
                {step.name}
              </Text>
            </Cell>
            <Cell>
              <Text variant="body-small">{kindLabel(step.kind)}</Text>
            </Cell>
            <Cell>
              <WorkflowStatusLabel status={step.status} />
            </Cell>
            <Cell>
              <Text variant="body-small">{retryBadge(step) ?? ''}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small">{formatTime(step.startTime)}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small">
                {step.startTime && step.startTime !== step.endTime
                  ? formatDuration(step.startTime, step.endTime)
                  : ''}
              </Text>
            </Cell>
            <Cell>
              <Text variant="body-small" color="secondary">
                {step.failure?.message ?? step.waitingFor ?? ''}
              </Text>
            </Cell>
          </Row>
        ))}
      </TableBody>
    </TableRoot>
  );
}
