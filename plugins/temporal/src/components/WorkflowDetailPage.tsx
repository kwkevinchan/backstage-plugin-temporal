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

import { useCallback, useMemo, useState } from 'react';
import { useParams, useResolvedPath } from 'react-router-dom';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import type { WorkflowRef } from '../common';
import {
  TemporalWorkflowActionDef,
  TemporalWorkflowSectionDef,
} from '../extensions';
import {
  Button,
  Card,
  CardBody,
  Flex,
  Link,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@backstage/ui';
import { RiRefreshLine } from '@remixicon/react';
import { DetailsTab } from './detail/DetailsTab';
import { GraphCard } from './detail/GraphCard';
import { TimelineTab } from './detail/TimelineTab';
import { useDetailSelection } from './detail/useDetailSelection';
import { WorkflowHeader } from './detail/WorkflowHeader';
import { ErrorAlert, Loading } from './feedback';
import {
  EVENT_GROUPS_TAB,
  resolveDetailTab,
  STATIC_DETAIL_TABS,
} from './detailState';
import { EventGroupsTab } from './EventGroupsTab';
import { savedListSearch } from './listState';
import { StepsTable } from './StepsTable';
import { useRefreshLock } from './useRefreshLock';
import { sharedExtensions, useSharedExtensions } from './useSharedExtensions';
import { useWorkflowData } from './useWorkflowData';
import { WorkflowEvents } from './WorkflowEvents';
import { workflowLink } from './WorkflowRunsTable';

/** Props of {@link WorkflowDetailPage}. */
export interface WorkflowDetailPageProps {
  workflowActions?: TemporalWorkflowActionDef[];
  workflowSections?: TemporalWorkflowSectionDef[];
}

/** Details of one workflow execution, inside the entity tab. */
export function EntityWorkflowDetailPage(props: WorkflowDetailPageProps) {
  const { entity } = useEntity();
  return <WorkflowDetailPage {...props} entity={entity} />;
}

/**
 * Actions and sections from the props (legacy frontend system) and from
 * the shared workflow extensions API (new frontend system).
 */
function useExtensions(props: WorkflowDetailPageProps) {
  return {
    actions: useSharedExtensions(
      sharedExtensions.actions,
      props.workflowActions,
    ),
    sections: useSharedExtensions(
      sharedExtensions.sections,
      props.workflowSections,
    ),
  };
}

/**
 * Details of one workflow execution: a summary line, the step graph with a
 * panel for the selected step, and tabs with the steps, the events and the
 * details. With an entity, the backend checks the permission on that
 * entity; without one (the Temporal page), it checks
 * `temporal.workflow.list`.
 */
export function WorkflowDetailPage(
  props: WorkflowDetailPageProps & { entity?: Entity },
) {
  const { entity } = props;
  const { actions: workflowActions, sections: workflowSections } =
    useExtensions(props);
  const params = useParams();
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const workflowRef = useMemo(
    () => ({
      namespace: params.namespace ?? '',
      workflowId: params.workflowId ?? '',
      runId: params.runId ?? '',
    }),
    [params.namespace, params.workflowId, params.runId],
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const runKey = `${workflowRef.namespace}\0${workflowRef.workflowId}\0${workflowRef.runId}`;
  const data = useWorkflowData(workflowRef, entityRef, autoRefresh);
  const { workflow, graph } = data;
  // The raw events load when they are opened and when the user reloads, not
  // when the page updates itself.
  const [historyReload, setHistoryReload] = useState(0);
  const { reload } = data;
  const reloadAll = useCallback(() => {
    reload();
    setHistoryReload(n => n + 1);
  }, [reload]);
  const refresh = useRefreshLock(reloadAll, data.refreshing);

  // The list this page was opened from, and links to other runs next to it.
  const rootPath = useResolvedPath('../../../../../..', {
    relative: 'path',
  }).pathname.replace(/\/+$/, '');
  const workflowHref = useCallback(
    (ref: WorkflowRef) => `${rootPath}/${workflowLink(ref)}`,
    [rootPath],
  );
  const nodes = data.graph?.nodes;
  const eventGroups = data.graph?.eventGroups;
  const {
    searchParams,
    graphRef,
    selectedNode,
    drawerPlace,
    showMarkers,
    setShowMarkers,
    groupViews,
    setGroupView,
    focusGroup,
    groupDisplay,
    showGroupDisplay,
    setTab,
    selectFromGraph,
    selectFromTimeline,
    selectFromTab,
    selectInGraph,
    showGroup,
  } = useDetailSelection({ runKey, nodes, eventGroups });

  // Back to the list with its filters and page, as it was left.
  const back = (
    <Link
      href={`${rootPath || '/'}${savedListSearch(rootPath || '/')}`}
      variant="body-medium"
      data-testid="back-to-list"
    >
      ← Workflow executions
    </Link>
  );

  if (data.loading && !workflow) {
    return (
      <Flex direction="column" gap="4">
        {back}
        <Loading rows={5} label="Loading workflow" />
      </Flex>
    );
  }
  if (!workflow) {
    return (
      <Flex direction="column" gap="4">
        <Flex align="center" justify="between" gap="2">
          {back}
          <Button
            variant="secondary"
            iconStart={<RiRefreshLine />}
            isPending={refresh.locked || data.refreshing}
            onPress={refresh.refresh}
          >
            Refresh
          </Button>
        </Flex>
        <ErrorAlert error={data.error ?? new Error('Workflow not found')} />
      </Flex>
    );
  }

  const graphTabFallback = data.graphError ? (
    <ErrorAlert error={data.graphError} />
  ) : (
    <Loading />
  );

  const extensionProps = {
    workflow,
    entity,
    reload: reloadAll,
    workflowHref,
  };
  const actions = workflowActions.filter(a => !a.filter || a.filter(workflow));
  const sections = workflowSections.filter(
    s => !s.filter || s.filter(workflow),
  );
  const availableTabs = new Set<string>([
    ...STATIC_DETAIL_TABS,
    ...(graph && eventGroups && eventGroups.length > 0
      ? [EVENT_GROUPS_TAB]
      : []),
    ...sections.map(s => `section-${s.id}`),
  ]);
  const tab = resolveDetailTab(searchParams, availableTabs);
  const drawerIn = drawerPlace ?? (tab === 'timeline' ? 'timeline' : 'graph');
  const showTimelineDrawer = tab === 'timeline' && drawerIn === 'timeline';
  const showGraphDrawer = !showTimelineDrawer;
  const running = workflow.status === 'Running';
  const historyRef = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };

  return (
    <Flex direction="column" gap="4">
      {back}
      <WorkflowHeader
        workflow={workflow}
        graph={graph}
        entityRef={entityRef}
        actions={actions}
        extensionProps={extensionProps}
        workflowHref={workflowHref}
        refresh={refresh}
        refreshing={data.refreshing}
        error={data.error}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
      />

      <div ref={graphRef}>
        <GraphCard
          graph={graph}
          graphError={data.graphError}
          selected={showGraphDrawer ? selectedNode : undefined}
          showDrawer={showGraphDrawer}
          onSelect={selectFromGraph}
          onSelectStep={selectInGraph}
          workflowRef={historyRef}
          entityRef={entityRef}
          workflowHref={workflowHref}
          showMarkers={showMarkers}
          onShowMarkersChange={setShowMarkers}
          groupViews={groupViews}
          onGroupViewChange={setGroupView}
          focusGroup={focusGroup}
          onGroupDisplay={showGroupDisplay}
        />
      </div>

      <Card>
        <CardBody>
          <Tabs
            selectedKey={tab}
            onSelectionChange={key => setTab(String(key))}
          >
            <TabList aria-label="Workflow details">
              <Tab id="steps">Steps</Tab>
              <Tab id="timeline">Timeline</Tab>
              {eventGroups && eventGroups.length > 0 ? (
                <Tab id="event-groups">Event Groups</Tab>
              ) : null}
              <Tab id="events">Events</Tab>
              <Tab id="details">Details</Tab>
              {sections.map(s => (
                <Tab key={s.id} id={`section-${s.id}`}>
                  {s.title}
                </Tab>
              ))}
            </TabList>
            <TabPanel id="steps">
              {graph ? (
                <StepsTable steps={graph.nodes} onSelect={selectFromTab} />
              ) : (
                graphTabFallback
              )}
            </TabPanel>
            <TabPanel id="timeline">
              {graph ? (
                <TimelineTab
                  graph={graph}
                  workflow={workflow}
                  showMarkers={showMarkers}
                  live={running && autoRefresh}
                  selected={showTimelineDrawer ? selectedNode : undefined}
                  showDrawer={showTimelineDrawer}
                  onSelect={selectFromTimeline}
                  onSelectStep={selectFromTimeline}
                  workflowRef={historyRef}
                  workflowHref={workflowHref}
                  entityRef={entityRef}
                />
              ) : (
                graphTabFallback
              )}
            </TabPanel>
            {graph && eventGroups && eventGroups.length > 0 ? (
              <TabPanel id="event-groups">
                <EventGroupsTab
                  graph={graph}
                  display={groupDisplay}
                  onShowGroup={showGroup}
                />
              </TabPanel>
            ) : null}
            <TabPanel id="events">
              <WorkflowEvents
                steps={graph?.nodes}
                graphError={data.graphError}
                workflowRef={historyRef}
                entityRef={entityRef}
                reloadKey={historyReload}
                onSelect={selectFromTab}
              />
            </TabPanel>
            <TabPanel id="details">
              <DetailsTab workflow={workflow} />
            </TabPanel>
            {sections.map(({ id, component: Section }) => (
              <TabPanel
                key={id}
                id={`section-${id}`}
                data-testid={`temporal-section-${id}`}
              >
                <Section {...extensionProps} />
              </TabPanel>
            ))}
          </Tabs>
        </CardBody>
      </Card>
    </Flex>
  );
}
