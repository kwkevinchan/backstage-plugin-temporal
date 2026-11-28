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
import { Flex, Text } from '@backstage/ui';
import type { WorkflowDetail } from '../../common';
import { DefinitionList } from '../DefinitionList';
import { FailureView } from '../FailureView';
import { formatDuration, formatTime } from '../format';
import { JsonView, MemoView } from '../PayloadView';
import { PendingActivities } from '../PendingActivities';
import { WorkflowStatusLabel } from '../WorkflowStatusLabel';

function detailItems(workflow: WorkflowDetail): [string, ReactNode][] {
  const typeEntityRef =
    workflow.workflowEntityRef ?? workflow.workflowTypeEntityRef;
  return [
    ['Workflow ID', workflow.workflowId],
    ['Run ID', workflow.runId],
    [
      'Workflow type',
      typeEntityRef ? (
        <EntityRefLink entityRef={typeEntityRef}>
          {workflow.workflowType}
        </EntityRefLink>
      ) : (
        workflow.workflowType
      ),
    ],
    ['Task queue', workflow.taskQueue],
    ['Namespace', workflow.namespace],
    ['Status', <WorkflowStatusLabel status={workflow.status} />],
    ['Started', formatTime(workflow.startTime)],
    ['Ended', formatTime(workflow.closeTime)],
    ['Duration', formatDuration(workflow.startTime, workflow.closeTime)],
    ['History events', workflow.historyLength],
    ['Parent workflow', workflow.parent?.workflowId],
    [
      'Catalog entity',
      workflow.entityRef ? (
        <EntityRefLink entityRef={workflow.entityRef} />
      ) : undefined,
    ],
  ];
}

/** The Details tab: the summary table, failure and pending activities. */
export function DetailsTab(props: { workflow: WorkflowDetail }) {
  const { workflow } = props;
  return (
    <Flex direction="column" gap="4">
      <DefinitionList items={detailItems(workflow)} />
      {workflow.failure && (
        <div>
          <Text as="h3" variant="title-x-small">
            Failure
          </Text>
          <FailureView failure={workflow.failure} />
        </div>
      )}
      {workflow.pendingActivities.length > 0 && (
        <div>
          <Text as="h3" variant="title-x-small">
            Pending activities
          </Text>
          <PendingActivities activities={workflow.pendingActivities} />
        </div>
      )}
      {workflow.searchAttributes &&
        Object.keys(workflow.searchAttributes).length > 0 && (
          <div>
            <Text as="h3" variant="title-x-small">
              Search attributes
            </Text>
            <JsonView value={workflow.searchAttributes} />
          </div>
        )}
      {workflow.memo && (
        <div>
          <Text as="h3" variant="title-x-small">
            Memo
          </Text>
          <MemoView memo={workflow.memo} />
        </div>
      )}
    </Flex>
  );
}
