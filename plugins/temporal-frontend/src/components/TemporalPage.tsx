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

import { Route, Routes, useSearchParams } from 'react-router-dom';
import { Content, Header, Page } from '@backstage/core-components';
import { Container, Flex, Tab, TabList, TabPanel, Tabs } from '@backstage/ui';
import { AllWorkflowsList } from './AllWorkflowsList';
import { WorkflowTypesList } from './WorkflowTypesList';
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

/** The tab of the Temporal page in `?tab=`; Workflows without it. */
const EXECUTIONS_TAB = 'executions';
const WORKFLOWS_TAB = 'workflows';

/**
 * The two tabs of the Temporal page: the `TemporalWorkflow` entities with
 * the numbers of their runs, and the list of every run with the schedules.
 */
function TemporalPageTabs(props: TemporalPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab =
    searchParams.get('tab') === EXECUTIONS_TAB ? EXECUTIONS_TAB : WORKFLOWS_TAB;
  return (
    <Tabs
      selectedKey={tab}
      onSelectionChange={key =>
        setSearchParams(
          current => {
            const next = new URLSearchParams(current);
            if (key === EXECUTIONS_TAB) next.set('tab', EXECUTIONS_TAB);
            else next.delete('tab');
            return next;
          },
          { replace: true },
        )
      }
    >
      <TabList aria-label="Temporal">
        <Tab id={WORKFLOWS_TAB}>Workflows</Tab>
        <Tab id={EXECUTIONS_TAB}>Executions</Tab>
      </TabList>
      <TabPanel id={WORKFLOWS_TAB}>
        <WorkflowTypesList />
      </TabPanel>
      <TabPanel id={EXECUTIONS_TAB}>
        <Flex direction="column" gap="4">
          <AllWorkflowsList listActions={props.workflowListActions} />
          <SchedulesCard actions={props.scheduleActions} />
        </Flex>
      </TabPanel>
    </Tabs>
  );
}

/**
 * Temporal page content: the Workflows and Executions tabs, and on nested
 * routes the runs of a workflow ID and the details of a run.
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
      <Route path="/" element={<TemporalPageTabs {...props} />} />
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
