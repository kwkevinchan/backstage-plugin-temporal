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

import { Route, Routes } from 'react-router-dom';
import { MissingAnnotationEmptyState } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  getDependsOnTemporalWorkflowRefs,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
  TEMPORAL_TASK_QUEUE_ANNOTATION,
  TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type {
  TemporalWorkflowActionDef,
  TemporalWorkflowListActionDef,
  TemporalWorkflowSectionDef,
} from '../extensions';
import { Flex, Grid } from '@backstage/ui';
import { TemporalRelatedWorkflowsCard } from './TemporalRelatedWorkflowsCard';
import { TemporalWorkflowStatsCard } from './TemporalWorkflowStatsCard';
import { TemporalWorkflowSummaryCard } from './TemporalWorkflowSummaryCard';
import { EntityWorkflowDetailPage } from './WorkflowDetailPage';
import { WorkflowList } from './WorkflowList';

/**
 * Props of {@link EntityTemporalContent}.
 *
 * @public
 */
export interface EntityTemporalContentProps {
  /** Controls in the action bar of the workflow details page. */
  workflowActions?: TemporalWorkflowActionDef[];
  /** Tabs on the workflow details page. */
  workflowSections?: TemporalWorkflowSectionDef[];
  /** Controls above the workflow list, such as "Start workflow". */
  workflowListActions?: TemporalWorkflowListActionDef[];
}

/**
 * Start of the tab. A `TemporalWorkflow` entity gets its summary and recent
 * run statistics above the runs; an entity that depends on
 * `TemporalWorkflow` entities gets the list of those entities.
 */
function TemporalOverview(props: {
  listActions?: TemporalWorkflowListActionDef[];
}) {
  const { entity } = useEntity();
  if (isTemporalWorkflowEntity(entity)) {
    return (
      <Grid.Root columns={{ initial: '1', md: '2' }} gap="4">
        <Grid.Item>
          <TemporalWorkflowSummaryCard />
        </Grid.Item>
        <Grid.Item>
          <TemporalWorkflowStatsCard />
        </Grid.Item>
        <Grid.Item colSpan={{ initial: '1', md: '2' }}>
          <WorkflowList
            title="Workflow executions"
            listActions={props.listActions}
          />
        </Grid.Item>
      </Grid.Root>
    );
  }
  if (getDependsOnTemporalWorkflowRefs(entity).length > 0) {
    return (
      <Flex direction="column" gap="4">
        <TemporalRelatedWorkflowsCard />
        <WorkflowList listActions={props.listActions} />
      </Flex>
    );
  }
  return <WorkflowList listActions={props.listActions} />;
}

/** Entity tab: workflow list, and workflow details on a nested route. */
export function EntityTemporalContentPage(props: EntityTemporalContentProps) {
  const { entity } = useEntity();
  if (!isTemporalAvailable(entity)) {
    return (
      <MissingAnnotationEmptyState
        annotation={[
          TEMPORAL_TASK_QUEUE_ANNOTATION,
          TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
        ]}
      />
    );
  }
  const detail = (
    <EntityWorkflowDetailPage
      workflowActions={props.workflowActions}
      workflowSections={props.workflowSections}
    />
  );
  return (
    <Routes>
      <Route
        path="/"
        element={<TemporalOverview listActions={props.workflowListActions} />}
      />
      <Route
        path="/namespaces/:namespace/workflows/:workflowId"
        element={detail}
      />
      <Route
        path="/namespaces/:namespace/workflows/:workflowId/runs/:runId"
        element={detail}
      />
    </Routes>
  );
}
