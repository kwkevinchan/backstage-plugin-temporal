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
import { Content, Header, Page } from '@backstage/core-components';
import { Container, Flex } from '@backstage/ui';
import { AllWorkflowsList } from './AllWorkflowsList';
import { WorkflowDetailPage } from './WorkflowDetailPage';
import { WorkflowRunsPage } from './WorkflowRunsPage';
import type {
  TemporalScheduleActionDef,
  TemporalWorkflowActionDef,
  TemporalWorkflowListActionDef,
  TemporalWorkflowSectionDef,
} from '../extensions';
import { SchedulesCard } from './SchedulesCard';
import { tp } from './styles';
import { withControls } from '../control';

/**
 * Props of {@link TemporalPage}.
 *
 * @public
 */
export interface TemporalPageProps {
  /** Controls in the action bar of the workflow details page. */
  workflowActions?: TemporalWorkflowActionDef[];
  /** Tabs on the workflow details page. */
  workflowSections?: TemporalWorkflowSectionDef[];
  /** Controls above the workflow list, such as "Start workflow". */
  workflowListActions?: TemporalWorkflowListActionDef[];
  /** Controls on each schedule, such as "Pause". */
  scheduleActions?: TemporalScheduleActionDef[];
}

/**
 * Temporal page content: the list, and on nested routes the runs of a
 * workflow ID and the details of a run.
 */
export function TemporalPageContent(props: TemporalPageProps) {
  const detail = (
    <WorkflowDetailPage
      workflowActions={props.workflowActions}
      workflowSections={props.workflowSections}
    />
  );
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Flex direction="column" gap="4">
            <AllWorkflowsList listActions={props.workflowListActions} />
            <SchedulesCard actions={props.scheduleActions} />
          </Flex>
        }
      />
      <Route
        path="/namespaces/:namespace/workflows/:workflowId"
        element={<WorkflowRunsPage />}
      />
      <Route
        path="/namespaces/:namespace/workflows/:workflowId/runs/:runId"
        element={detail}
      />
    </Routes>
  );
}

/**
 * Temporal page content with the page margins of the new frontend
 * system, under the page header of the app.
 */
export function TemporalPageInContainer(props: TemporalPageProps) {
  return (
    <Container className={tp('tp-page')}>
      <TemporalPageContent {...props} />
    </Container>
  );
}

/**
 * Temporal page with its own header, for the legacy frontend system: with
 * the operations that change workflows, which the new frontend system adds
 * as extensions.
 */
export function TemporalPageWithHeader(props: TemporalPageProps) {
  return (
    <Page themeId="tool">
      <Header title="Temporal" subtitle="Workflow executions" />
      <Content>
        <TemporalPageContent {...withControls(props)} />
      </Content>
    </Page>
  );
}
