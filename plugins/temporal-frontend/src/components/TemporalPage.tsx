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
import {
  WorkflowDetailPage,
  WorkflowDetailPageProps,
} from './WorkflowDetailPage';
import type {
  TemporalScheduleActionDef,
  TemporalWorkflowListActionDef,
} from '../extensions';
import { SchedulesCard } from './SchedulesCard';
import { tp } from './styles';

/**
 * Props of {@link TemporalPage}.
 *
 * @public
 */
export type TemporalPageProps = WorkflowDetailPageProps & {
  /** Controls above the workflow list, such as "Start workflow". */
  workflowListActions?: TemporalWorkflowListActionDef[];
  /** Controls on each schedule, such as "Pause". */
  scheduleActions?: TemporalScheduleActionDef[];
};

/** Workflows page content: the list, and details on a nested route. */
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
        element={detail}
      />
      <Route
        path="/namespaces/:namespace/workflows/:workflowId/runs/:runId"
        element={detail}
      />
    </Routes>
  );
}

/**
 * Workflows page content with the page margins of the new frontend
 * system, under the page header of the app.
 */
export function TemporalPageInContainer(props: TemporalPageProps) {
  return (
    <Container className={tp('tp-page')}>
      <TemporalPageContent {...props} />
    </Container>
  );
}

/** Workflows page with its own header, for the legacy frontend system. */
export function TemporalPageWithHeader(props: TemporalPageProps) {
  return (
    <Page themeId="tool">
      <Header title="Workflows" subtitle="Temporal workflow executions" />
      <Content>
        <TemporalPageContent {...props} />
      </Content>
    </Page>
  );
}
