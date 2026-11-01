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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useResolvedPath } from 'react-router-dom';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApiHolder } from '@backstage/core-plugin-api';
import { EntityRefLink, useEntity } from '@backstage/plugin-catalog-react';
import type {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRef,
  WorkflowRunChain,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalWorkflowActionDef,
  TemporalWorkflowProvider,
  TemporalWorkflowSectionDef,
  temporalWorkflowExtensionsApiRef,
} from '@kwkevinchan/backstage-plugin-temporal-react';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Flex,
  Link,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from '@backstage/ui';
import { RiExternalLinkLine, RiRefreshLine } from '@remixicon/react';
import { ErrorAlert, Loading } from './feedback';
import { FailureView } from './FailureView';
import { deadlineText, formatDuration, formatTime } from './format';
import { WorkflowGraph } from './graph/WorkflowGraph';
import { JsonView } from './PayloadView';
import { PendingActivities } from './PendingActivities';
import { DefinitionList, StepDrawer } from './StepDrawer';
import { isMarkerStep } from './steps';
import { StepsTable } from './StepsTable';
import { useWorkflowData } from './useWorkflowData';
import { WorkflowEvents } from './WorkflowEvents';
import { workflowLink } from './WorkflowList';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';
import { tp } from './styles';

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
  const apis = useApiHolder();
  const shared = apis.get(temporalWorkflowExtensionsApiRef);
  return useMemo(() => {
    const unique = <T extends { id: string }>(items: T[]) =>
      items.filter((item, i) => items.findIndex(o => o.id === item.id) === i);
    return {
      actions: unique([
        ...(props.workflowActions ?? []),
        ...(shared?.getActions() ?? []),
      ]),
      sections: unique([
        ...(props.workflowSections ?? []),
        ...(shared?.getSections() ?? []),
      ]),
    };
  }, [props.workflowActions, props.workflowSections, shared]);
}

function SummaryItem(props: { label: string; children: React.ReactNode }) {
  return (
    <div className={tp('tp-summary-item')}>
      <Text as="span" variant="body-x-small" color="secondary">
        {props.label}
      </Text>
      <Text as="span" variant="body-medium">
        {props.children}
      </Text>
    </div>
  );
}

function detailItems(workflow: WorkflowDetail): [string, React.ReactNode][] {
  return [
    ['Workflow ID', workflow.workflowId],
    ['Run ID', workflow.runId],
    ['Type', workflow.workflowType],
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
function DetailsTab(props: { workflow: WorkflowDetail }) {
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
          <JsonView value={workflow.memo} />
        </div>
      )}
    </Flex>
  );
}

/** "Run 3 of 5", with links to the run before and after this one. */
function RunChainLinks(props: {
  chain: WorkflowRunChain;
  workflow: WorkflowDetail;
  workflowHref(ref: WorkflowRef): string;
}) {
  const { chain, workflow, workflowHref } = props;
  const href = (runId: string) =>
    workflowHref({
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId,
    });
  return (
    <span className={tp('tp-run-chain')} data-testid="workflow-run-chain">
      <span>
        {chain.index && chain.total
          ? `Run ${chain.index} of ${chain.total}`
          : 'One of several runs'}
      </span>
      {chain.previousRunId && (
        <Link href={href(chain.previousRunId)} variant="body-medium">
          ← Previous run
        </Link>
      )}
      {chain.nextRunId && (
        <Link href={href(chain.nextRunId)} variant="body-medium">
          Next run →
        </Link>
      )}
    </span>
  );
}

function currentLabel(workflow: WorkflowDetail) {
  if (workflow.status === 'Running') return 'Now';
  if (['Failed', 'TimedOut', 'Terminated'].includes(workflow.status)) {
    return 'Stopped at';
  }
  return 'Result';
}

/** A ref callback and the width of its element, followed as it changes. */
function useWidth(): [(element: HTMLElement | null) => void, number?] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    if (!element) return undefined;
    const update = () => setWidth(element.clientWidth || undefined);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

function GraphCard(props: {
  graph?: WorkflowGraphResponse;
  graphError?: Error;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  workflowHref(ref: WorkflowRef): string;
  showMarkers: boolean;
  onShowMarkersChange(show: boolean): void;
}) {
  const { graph, graphError, selectedId, onSelect } = props;
  const selected = graph?.nodes.find(n => n.id === selectedId);
  // The graph is laid out for the whole width, so opening the step panel
  // does not move the steps.
  const [layoutRef, layoutWidth] = useWidth();
  return (
    <Card>
      <CardHeader>
        <Flex align="center" justify="between" gap="2">
          <Text as="h3" variant="title-small" style={{ margin: 0 }}>
            Steps
          </Text>
          {graph && graph.totalSteps > 0 && (
            <Text variant="body-small" color="secondary">
              {graph.completedSteps} of {graph.totalSteps} steps done
            </Text>
          )}
        </Flex>
      </CardHeader>
      <CardBody>
        {graphError && <ErrorAlert error={graphError} />}
        {!graph && !graphError && <Loading label="Loading graph" />}
        {graph?.truncated && (
          <Alert
            status="info"
            icon
            title="The history is long; the graph shows its first events."
            style={{ marginBottom: 12 }}
          />
        )}
        {graph && (
          <div className={tp('tp-graph-layout')} ref={layoutRef}>
            <WorkflowGraph
              graph={graph}
              selectedId={selectedId}
              onSelect={onSelect}
              layoutWidth={layoutWidth}
              showMarkers={props.showMarkers}
              onShowMarkersChange={props.onShowMarkersChange}
            />
            {selected && (
              <StepDrawer
                step={selected}
                payloadsHidden={graph.payloadsHidden}
                workflowHref={props.workflowHref}
                onClose={() => onSelect(undefined)}
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Details of one workflow execution: a summary line, the step graph with a
 * panel for the selected step, and tabs with the steps, the events and the
 * details. With an entity, the backend checks the permission on that
 * entity; without one (the Workflows page), it checks
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
      runId: params.runId,
    }),
    [params.namespace, params.workflowId, params.runId],
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [tab, setTab] = useState<string>('steps');
  const [showMarkers, setShowMarkers] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);
  const data = useWorkflowData(workflowRef, entityRef, autoRefresh);
  const { workflow, graph } = data;

  // The list this page was opened from, and links to other runs next to it.
  const rootPath = useResolvedPath(
    params.runId ? '../../../../../..' : '../../../..',
    { relative: 'path' },
  ).pathname.replace(/\/+$/, '');
  const workflowHref = useCallback(
    (ref: WorkflowRef) => `${rootPath}/${workflowLink(ref)}`,
    [rootPath],
  );
  const nodes = data.graph?.nodes;
  const selectFromTab = useCallback(
    (id: string) => {
      // A marker picked in the events is shown in the graph.
      const node = nodes?.find(n => n.id === id);
      if (node && isMarkerStep(node)) setShowMarkers(true);
      setSelectedId(id);
      graphRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    },
    [nodes],
  );

  const back = (
    <Link href={rootPath || '/'} variant="body-medium">
      ← All workflows
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
        {back}
        <ErrorAlert error={data.error ?? new Error('Workflow not found')} />
      </Flex>
    );
  }

  const extensionProps = { workflow, entity, reload: data.reload };
  const actions = workflowActions.filter(a => !a.filter || a.filter(workflow));
  const sections = workflowSections.filter(
    s => !s.filter || s.filter(workflow),
  );
  const running = workflow.status === 'Running';
  const historyRef = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };

  return (
    <TemporalWorkflowProvider value={extensionProps}>
      <Flex direction="column" gap="4">
        {back}
        <Card>
          <CardBody>
            <Flex direction="column" gap="3">
              <Flex align="baseline" gap="3" style={{ flexWrap: 'wrap' }}>
                <Text
                  as="h2"
                  variant="title-medium"
                  style={{ margin: 0, wordBreak: 'break-all' }}
                >
                  {workflow.workflowId}
                </Text>
                <Text variant="body-small" color="secondary">
                  Run {workflow.runId}
                </Text>
              </Flex>
              <div className={tp('tp-summary')} data-testid="workflow-summary">
                <SummaryItem label="Status">
                  <WorkflowStatusLabel status={workflow.status} />
                </SummaryItem>
                {graph?.current && (
                  <SummaryItem label={currentLabel(workflow)}>
                    <span data-testid="workflow-current">
                      {graph.current}
                      {graph.currentDeadline && (
                        <span
                          title={formatTime(graph.currentDeadline.time)}
                          data-testid="workflow-deadline"
                        >
                          {' · '}
                          {deadlineText(graph.currentDeadline)}
                        </span>
                      )}
                    </span>
                  </SummaryItem>
                )}
                {graph?.runChain && (
                  <SummaryItem label="Continue as new">
                    <RunChainLinks
                      chain={graph.runChain}
                      workflow={workflow}
                      workflowHref={workflowHref}
                    />
                  </SummaryItem>
                )}
                <SummaryItem label="Type">{workflow.workflowType}</SummaryItem>
                <SummaryItem label="Duration">
                  {formatDuration(workflow.startTime, workflow.closeTime) ||
                    '—'}
                </SummaryItem>
                <SummaryItem label="Started">
                  {formatTime(workflow.startTime) || '—'}
                </SummaryItem>
                <div className={tp('tp-summary-actions')}>
                  {actions.map(({ id, component: Action }) => (
                    <div key={id} data-testid={`temporal-action-${id}`}>
                      <Action {...extensionProps} />
                    </div>
                  ))}
                  {workflow.webUiUrl && (
                    <ButtonLink
                      variant="secondary"
                      href={workflow.webUiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      iconEnd={<RiExternalLinkLine />}
                    >
                      Open in Temporal UI
                    </ButtonLink>
                  )}
                  <Button
                    variant="secondary"
                    iconStart={<RiRefreshLine />}
                    isPending={data.refreshing && !running}
                    onPress={data.reload}
                  >
                    Refresh
                  </Button>
                  {running && (
                    <Switch
                      label="Auto refresh"
                      isSelected={autoRefresh}
                      onChange={setAutoRefresh}
                    />
                  )}
                </div>
              </div>
              {data.error && (
                <ErrorAlert title="Could not refresh" error={data.error} />
              )}
            </Flex>
          </CardBody>
        </Card>

        <div ref={graphRef}>
          <GraphCard
            graph={graph}
            graphError={data.graphError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            workflowHref={workflowHref}
            showMarkers={showMarkers}
            onShowMarkersChange={setShowMarkers}
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
                <Tab id="events">Events</Tab>
                <Tab id="details">Details</Tab>
                {sections.map(s => (
                  <Tab key={s.id} id={`section-${s.id}`}>
                    {s.title ?? s.id}
                  </Tab>
                ))}
              </TabList>
              <TabPanel id="steps">
                {graph ? (
                  <StepsTable steps={graph.nodes} onSelect={selectFromTab} />
                ) : (
                  <Loading />
                )}
              </TabPanel>
              <TabPanel id="events">
                {graph ? (
                  <WorkflowEvents
                    steps={graph.nodes}
                    workflowRef={historyRef}
                    entityRef={entityRef}
                    payloadsHidden={graph.payloadsHidden}
                    onSelect={selectFromTab}
                  />
                ) : (
                  <Loading />
                )}
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
    </TemporalWorkflowProvider>
  );
}
