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
  isTemporalAvailable,
  TEMPORAL_TASK_QUEUE_ANNOTATION,
  TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type {
  TemporalWorkflowActionDef,
  TemporalWorkflowSectionDef,
} from '@kwkevinchan/backstage-plugin-temporal-react';
import { WorkflowDetailPage } from './WorkflowDetailPage';
import { WorkflowList } from './WorkflowList';

/**
 * Props of {@link EntityTemporalContent}.
 *
 * @public
 */
export interface EntityTemporalContentProps {
  /** Controls in the action bar of the workflow details page. */
  workflowActions?: TemporalWorkflowActionDef[];
  /** Cards on the workflow details page. */
  workflowSections?: TemporalWorkflowSectionDef[];
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
    <WorkflowDetailPage
      workflowActions={props.workflowActions}
      workflowSections={props.workflowSections}
    />
  );
  return (
    <Routes>
      <Route path="/" element={<WorkflowList />} />
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
