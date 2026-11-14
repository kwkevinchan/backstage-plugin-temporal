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
import type { WorkflowGraphResponse } from '../common';
import {
  Cell,
  Column,
  Flex,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { RiLockLine } from '@remixicon/react';
import { formatTime } from './format';
import { groupHues, groupTree } from './graph/eventGroups';
import type { GroupDisplay } from './graph/WorkflowGraph';
import {
  groupDuration,
  groupKindLabel,
  groupSteps,
  groupTokens,
  UNREADABLE_LABEL_TEXT,
} from './groupText';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';
import { tp } from './styles';

/** Where the graph shows a group that has no box. */
function noteText(display: GroupDisplay[string] | undefined): string {
  if (display === 'label') return 'Labels on its steps in the graph';
  if (display === 'loop') return 'Its steps are in a loop box in the graph';
  return 'Not in the graph';
}

/**
 * The Event Groups tab: the Temporal event groups of the run, in the
 * order they started, each indented under the group it is in. Pressing a
 * group expands it in the graph and brings it into view.
 */
export function EventGroupsTab(props: {
  graph: WorkflowGraphResponse;
  /** How the graph draws each group; left out before it is drawn. */
  display?: GroupDisplay;
  onShowGroup(key: string): void;
}) {
  const { graph, display, onShowGroup } = props;
  const rows = useMemo(
    () => groupTree(graph.eventGroups ?? []),
    [graph.eventGroups],
  );
  const hues = useMemo(() => groupHues(graph.eventGroups), [graph.eventGroups]);
  const withTokens = rows.some(r => r.group.usage);
  return (
    <Flex direction="column" gap="3" data-testid="workflow-event-groups">
      <Text variant="body-small" color="secondary">
        Groups the workflow put its steps in (Temporal Event Groups). Which
        group is inside which is read from their steps.
      </Text>
      <TableRoot
        aria-label="Event groups"
        onRowAction={key => onShowGroup(String(key))}
      >
        <TableHeader>
          <Column isRowHeader>Name</Column>
          <Column>Kind</Column>
          <Column>Status</Column>
          <Column>Steps</Column>
          <Column>Groups</Column>
          <Column>Started</Column>
          <Column>Duration</Column>
          {withTokens ? <Column>Tokens</Column> : null}
        </TableHeader>
        <TableBody>
          {rows.map(({ group, level }) => (
            <Row key={group.key} id={group.key}>
              <Cell>
                <span
                  className={tp('tp-group-row-name')}
                  style={{ paddingLeft: `${level * 20}px` }}
                  data-group-level={level}
                  data-testid={`group-row-${group.key}`}
                >
                  <span
                    className={tp('tp-group-swatch', 'tp-hue')}
                    data-hue={hues.get(group.key)}
                    aria-hidden
                  />
                  <Text variant="body-small" weight="bold">
                    {group.name}
                  </Text>
                  {group.labelUnreadable && (
                    <span
                      className={tp('tp-group-unreadable')}
                      role="img"
                      aria-label={UNREADABLE_LABEL_TEXT}
                      title={UNREADABLE_LABEL_TEXT}
                    >
                      <RiLockLine size={12} aria-hidden />
                    </span>
                  )}
                  {display && display[group.key] !== 'box' && (
                    <span
                      className={tp('tp-group-row-note')}
                      data-testid={`group-row-note-${group.key}`}
                    >
                      {noteText(display[group.key])}
                    </span>
                  )}
                </span>
              </Cell>
              <Cell>
                <Text variant="body-small">
                  {groupKindLabel(group, graph.nodes)}
                </Text>
              </Cell>
              <Cell>
                <WorkflowStatusLabel status={group.status} />
              </Cell>
              <Cell>
                <Text variant="body-small">
                  {groupSteps(group, graph.nodes)}
                </Text>
              </Cell>
              <Cell>
                <Text variant="body-small">
                  {group.children.length > 0 ? group.children.length : ''}
                </Text>
              </Cell>
              <Cell>
                <Text variant="body-small">{formatTime(group.startTime)}</Text>
              </Cell>
              <Cell>
                <Text variant="body-small">{groupDuration(group)}</Text>
              </Cell>
              {withTokens ? (
                <Cell>
                  <Text
                    variant="body-small"
                    title={
                      group.llmCalls
                        ? `${group.llmCalls} model call${
                            group.llmCalls === 1 ? '' : 's'
                          }`
                        : undefined
                    }
                  >
                    {groupTokens(group)}
                  </Text>
                </Cell>
              ) : null}
            </Row>
          ))}
        </TableBody>
      </TableRoot>
    </Flex>
  );
}
