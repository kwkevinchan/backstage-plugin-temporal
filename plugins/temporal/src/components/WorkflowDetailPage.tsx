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
import { useParams, useResolvedPath, useSearchParams } from 'react-router-dom';
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
} from '../extensions';
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
import { QueryButton } from './messages/QueryButton';
import { ErrorAlert, Loading } from './feedback';
import { FailureView } from './FailureView';
import { deadlineText, formatDuration, formatTime } from './format';
import {
  GraphFullscreenContext,
  useGraphFullscreenState,
} from './graph/GraphCanvas';
import { WorkflowGraph } from './graph/WorkflowGraph';
import { loopOfStep, LoopView, LoopViews } from './graph/loops';
import { savedListSearch } from './listState';
import { LoopsTab } from './LoopsTab';
import { JsonView } from './PayloadView';
import { PendingActivities } from './PendingActivities';
import { RunHelp } from './RunHelp';
import { DefinitionList, StepDrawer } from './StepDrawer';
import { isMarkerStep } from './steps';
import { StepsTable } from './StepsTable';
import { WorkflowTimeline } from './timeline/WorkflowTimeline';
import { useRefreshLock } from './useRefreshLock';
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

/**
 * One field of the header: the label above, the value below. A wide field
 * (long text, links) spans two columns when there is room.
 */
function SummaryItem(props: {
  label: string;
  /** Shown after the label: an explanation of the field. */
  help?: React.ReactNode;
  wide?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={tp('tp-summary-item')}
      data-wide={props.wide || undefined}
      data-testid={props.testId}
    >
      <span className={tp('tp-summary-label')}>
        <Text as="span" variant="body-small" color="secondary">
          {props.label}
        </Text>
        {props.help}
      </span>
      <Text as="span" variant="body-medium" className={tp('tp-summary-value')}>
        {props.children}
      </Text>
    </div>
  );
}

function detailItems(workflow: WorkflowDetail): [string, React.ReactNode][] {
  return [
    ['Workflow ID', workflow.workflowId],
    ['Run ID', workflow.runId],
    ['Workflow type', workflow.workflowType],
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

/** Links to the run before and after this one: "← Run 2", "Run 4 →". */
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
  const index = chain.index;
  return (
    <span className={tp('tp-run-chain')}>
      {chain.previousRunId && (
        <Link href={href(chain.previousRunId)} variant="body-medium">
          {index && index > 1 ? `← Run ${index - 1}` : '← Previous run'}
        </Link>
      )}
      {chain.nextRunId && (
        <Link href={href(chain.nextRunId)} variant="body-medium">
          {index ? `Run ${index + 1} →` : 'Next run →'}
        </Link>
      )}
      {!chain.previousRunId && !chain.nextRunId && (
        <span className={tp('tp-muted')}>—</span>
      )}
    </span>
  );
}

/** Label of the run chain field: which run of the chain this is. */
function runChainLabel(chain: WorkflowRunChain): string {
  return chain.index && chain.total
    ? `Run ${chain.index} of ${chain.total}`
    : 'One of several runs';
}

function currentLabel(workflow: WorkflowDetail) {
  if (workflow.status === 'Running') return 'Now';
  if (['Failed', 'TimedOut', 'Terminated'].includes(workflow.status)) {
    return 'Stopped at';
  }
  return 'Result';
}

function GraphCard(props: {
  graph?: WorkflowGraphResponse;
  graphError?: Error;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  /** Selects a step from the step panel (a tool call of a model call). */
  onSelectStep(id: string): void;
  workflowRef: WorkflowRef;
  entityRef?: string;
  workflowHref(ref: WorkflowRef): string;
  showMarkers: boolean;
  onShowMarkersChange(show: boolean): void;
  loopViews: LoopViews;
  onLoopViewChange(name: string, view: LoopView): void;
}) {
  const { graph, graphError, selectedId, onSelect } = props;
  const selected = graph?.nodes.find(n => n.id === selectedId);
  const fullscreen = useGraphFullscreenState();
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
          <GraphFullscreenContext.Provider value={fullscreen}>
            <div
              className={tp('tp-graph-layout')}
              data-testid="workflow-graph-layout"
              data-fullscreen={fullscreen.fullscreen}
            >
              <WorkflowGraph
                graph={graph}
                selectedId={selectedId}
                onSelect={onSelect}
                showMarkers={props.showMarkers}
                onShowMarkersChange={props.onShowMarkersChange}
                loopViews={props.loopViews}
                onLoopViewChange={props.onLoopViewChange}
                panelOpen={Boolean(selected)}
              />
              {selected && (
                <StepDrawer
                  step={selected}
                  payloadsHidden={graph.payloadsHidden}
                  workflowHref={props.workflowHref}
                  onClose={() => onSelect(undefined)}
                  nodes={graph.nodes}
                  workflowRef={props.workflowRef}
                  entityRef={props.entityRef}
                  onSelectStep={props.onSelectStep}
                />
              )}
            </div>
          </GraphFullscreenContext.Provider>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The Timeline tab: the steps on a time axis, with the step panel of the
 * graph next to it for the selected bar.
 */
function TimelineTab(props: {
  graph: WorkflowGraphResponse;
  workflow: WorkflowDetail;
  showMarkers: boolean;
  live: boolean;
  workflowHref(ref: WorkflowRef): string;
  entityRef?: string;
}) {
  const { graph } = props;
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = graph.nodes.find(n => n.id === selectedId);
  return (
    <div className={tp('tp-graph-layout')}>
      <div className={tp('tp-graph-column')}>
        {graph.truncated && (
          <Alert
            status="info"
            icon
            title="The history is long; the timeline shows its first events."
          />
        )}
        <WorkflowTimeline
          graph={graph}
          workflow={props.workflow}
          showMarkers={props.showMarkers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          live={props.live}
        />
      </div>
      {selected && (
        <StepDrawer
          step={selected}
          payloadsHidden={graph.payloadsHidden}
          workflowHref={props.workflowHref}
          onClose={() => setSelectedId(undefined)}
          nodes={graph.nodes}
          workflowRef={{
            namespace: props.workflow.namespace,
            workflowId: props.workflow.workflowId,
            runId: props.workflow.runId,
          }}
          entityRef={props.entityRef}
          onSelectStep={setSelectedId}
        />
      )}
    </div>
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
  // A link from the Loops tab of another run opens a round: ?loop=&round=.
  const [searchParams] = useSearchParams();
  const linkedLoop = searchParams.get('loop');
  const linkedRound = Number(searchParams.get('round'));
  const [loopViews, setLoopViews] = useState<LoopViews>(() =>
    linkedLoop
      ? {
          [linkedLoop]: {
            expanded: true,
            iteration: Number.isInteger(linkedRound) ? linkedRound : undefined,
          },
        }
      : {},
  );
  // A link to another run of the same page: the component stays mounted.
  useEffect(() => {
    if (!linkedLoop) return;
    setLoopViews(views => ({
      ...views,
      [linkedLoop]: {
        expanded: true,
        iteration: Number.isInteger(linkedRound) ? linkedRound : undefined,
      },
    }));
  }, [linkedLoop, linkedRound, workflowRef]);
  const setLoopView = useCallback(
    (name: string, view: LoopView) =>
      setLoopViews(views => ({ ...views, [name]: view })),
    [],
  );
  const graphRef = useRef<HTMLDivElement>(null);
  const data = useWorkflowData(workflowRef, entityRef, autoRefresh);
  const { workflow, graph } = data;
  const refresh = useRefreshLock(data.reload, data.refreshing);

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
  const loops = data.graph?.loops;
  const scrollToGraph = useCallback(
    () =>
      graphRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      }),
    [],
  );
  const selectFromTab = useCallback(
    (id: string) => {
      // A marker picked in the events is shown in the graph.
      const node = nodes?.find(n => n.id === id);
      if (node && isMarkerStep(node)) setShowMarkers(true);
      // A step of a loop is shown in its round.
      const inLoop = loopOfStep(loops, id);
      if (inLoop) {
        setLoopView(inLoop.loop.name, {
          expanded: true,
          iteration: inLoop.round.iteration,
        });
      }
      setSelectedId(id);
      scrollToGraph();
    },
    [nodes, loops, setLoopView, scrollToGraph],
  );
  // A step picked in the step panel: shown in its loop round, selected.
  const selectInGraph = useCallback(
    (id: string) => {
      const inLoop = loopOfStep(loops, id);
      if (inLoop) {
        setLoopView(inLoop.loop.name, {
          expanded: true,
          iteration: inLoop.round.iteration,
        });
      }
      setSelectedId(id);
    },
    [loops, setLoopView],
  );
  const showRound = useCallback(
    (loop: string, iteration: number) => {
      setLoopView(loop, { expanded: true, iteration });
      setSelectedId(undefined);
      scrollToGraph();
    },
    [setLoopView, scrollToGraph],
  );

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
        {back}
        <ErrorAlert error={data.error ?? new Error('Workflow not found')} />
      </Flex>
    );
  }

  const extensionProps = {
    workflow,
    entity,
    reload: data.reload,
    workflowHref,
  };
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
          <CardBody className={tp('tp-header')}>
            <div className={tp('tp-header-top')}>
              <div className={tp('tp-header-title')}>
                <Text
                  as="h2"
                  variant="title-medium"
                  className={tp('tp-header-id')}
                >
                  {workflow.workflowId}
                </Text>
                <Text
                  variant="body-small"
                  color="secondary"
                  className={tp('tp-header-run')}
                >
                  Run ID {workflow.runId}
                </Text>
              </div>
              <div
                className={tp('tp-summary-actions')}
                data-testid="workflow-actions"
              >
                {actions.map(({ id, component: Action }) => (
                  <div
                    key={id}
                    className={tp('tp-summary-action')}
                    data-testid={`temporal-action-${id}`}
                  >
                    <Action {...extensionProps} />
                  </div>
                ))}
                <QueryButton workflow={workflow} entityRef={entityRef} />
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
                  isPending={refresh.locked || (data.refreshing && !running)}
                  onPress={refresh.refresh}
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
            <hr className={tp('tp-header-divider')} />
            <div className={tp('tp-summary')} data-testid="workflow-summary">
              <SummaryItem
                label="Status"
                help={
                  workflow.status === 'ContinuedAsNew' ? <RunHelp /> : undefined
                }
              >
                <WorkflowStatusLabel status={workflow.status} />
              </SummaryItem>
              {graph?.current && (
                <SummaryItem
                  label={currentLabel(workflow)}
                  // Long text (what a run waits for, with its time limit)
                  // gets two columns.
                  wide={
                    Boolean(graph.currentDeadline) || graph.current.length > 32
                  }
                >
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
                <SummaryItem
                  label={runChainLabel(graph.runChain)}
                  help={<RunHelp />}
                  wide
                  testId="workflow-run-chain"
                >
                  <RunChainLinks
                    chain={graph.runChain}
                    workflow={workflow}
                    workflowHref={workflowHref}
                  />
                </SummaryItem>
              )}
              <SummaryItem label="Workflow type">
                {workflow.workflowType}
              </SummaryItem>
              <SummaryItem label="Duration">
                {formatDuration(workflow.startTime, workflow.closeTime) || '—'}
              </SummaryItem>
              <SummaryItem label="Started">
                {formatTime(workflow.startTime) || '—'}
              </SummaryItem>
            </div>
            {data.error && (
              <ErrorAlert title="Could not refresh" error={data.error} />
            )}
          </CardBody>
        </Card>

        <div ref={graphRef}>
          <GraphCard
            graph={graph}
            graphError={data.graphError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSelectStep={selectInGraph}
            workflowRef={historyRef}
            entityRef={entityRef}
            workflowHref={workflowHref}
            showMarkers={showMarkers}
            onShowMarkersChange={setShowMarkers}
            loopViews={loopViews}
            onLoopViewChange={setLoopView}
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
                {loops && loops.length > 0 ? <Tab id="loops">Loops</Tab> : null}
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
              <TabPanel id="timeline">
                {graph ? (
                  <TimelineTab
                    graph={graph}
                    workflow={workflow}
                    showMarkers={showMarkers}
                    live={running && autoRefresh}
                    workflowHref={workflowHref}
                    entityRef={entityRef}
                  />
                ) : (
                  <Loading />
                )}
              </TabPanel>
              {graph && loops && loops.length > 0 ? (
                <TabPanel id="loops">
                  <LoopsTab
                    workflow={workflow}
                    graph={graph}
                    entityRef={entityRef}
                    workflowHref={workflowHref}
                    onShowRound={showRound}
                  />
                </TabPanel>
              ) : null}
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
