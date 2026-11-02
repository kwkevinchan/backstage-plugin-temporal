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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import {
  ANNOTATION_SOURCE_LOCATION,
  ANNOTATION_VIEW_URL,
  Entity,
  parseLocationRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Alert, ButtonLink, Flex, Link, Select, Text } from '@backstage/ui';
import { RiExternalLinkLine } from '@remixicon/react';
import {
  getTemporalWorkflowDefinitionSpec,
  isTemporalWorkflowEntity,
  WorkflowDefinitionError,
  WorkflowDefinitionResponse,
  WorkflowSummary,
} from '../../common';
import { temporalApiRef } from '../../extensions';
import { ErrorAlert, Loading } from '../feedback';
import { PanelCard } from '../PanelCard';
import { DefinitionList } from '../StepDrawer';
import { statusLabel } from '../WorkflowStatusLabel';
import { workflowLink } from '../WorkflowRunsTable';
import { tp } from '../styles';
import { DefinitionGraph } from './DefinitionGraph';
import { markLabel } from './DefinitionNode';
import { buildDefinitionGraph, DefinitionGraph as Graph } from './dslGraph';
import { pointerOfNode, taskAtLine } from './lines';
import { DefinitionOverlay, overlayRun } from './overlay';
import { YamlView } from './YamlView';

/** Time between reloads of a running run. */
const RUN_REFRESH_MS = 5000;
const NO_RUN = 'none';

/** A link from a location annotation (`url:https://...`), or the URL itself. */
function locationUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const location = parseLocationRef(value);
    return location.type === 'url' ? location.target : undefined;
  } catch {
    return /^https?:\/\//.test(value) ? value : undefined;
  }
}

/** Links to the source of a workflow written in code. */
function SourceLinks(props: { entity: Entity }) {
  const annotations = props.entity.metadata.annotations ?? {};
  const source = locationUrl(annotations[ANNOTATION_SOURCE_LOCATION]);
  const view = annotations[ANNOTATION_VIEW_URL];
  const links = [
    ...(source ? [{ label: 'Source code', href: source }] : []),
    ...(view && view !== source
      ? [{ label: 'View the file', href: view }]
      : []),
  ];
  // In a block of its own, so the card is as tall as its content.
  return (
    <div>
      <PanelCard
        title="Definition"
        subtitle="This workflow is written in code. Its source:"
        testId="definition-source-links"
      >
        {links.length > 0 ? (
          <Flex gap="2" style={{ flexWrap: 'wrap' }}>
            {links.map(link => (
              <ButtonLink
                key={link.href}
                variant="secondary"
                size="small"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                iconEnd={<RiExternalLinkLine />}
              >
                {link.label}
              </ButtonLink>
            ))}
          </Flex>
        ) : (
          <Text as="p" variant="body-medium" color="secondary">
            The entity has no {ANNOTATION_SOURCE_LOCATION} or{' '}
            {ANNOTATION_VIEW_URL} annotation. Add one to link the code here, or
            add spec.definition for a workflow written in YAML.
          </Text>
        )}
      </PanelCard>
    </div>
  );
}

function runKey(run: { workflowId: string; runId?: string }) {
  return `${run.workflowId}\u0000${run.runId ?? ''}`;
}

/** The run picker: recent runs of the entity. */
function RunSelect(props: {
  runs: WorkflowSummary[];
  value?: { workflowId: string; runId?: string };
  onChange(run: WorkflowSummary | undefined): void;
}) {
  const { runs, value } = props;
  const options = [
    { id: NO_RUN, label: 'No run' },
    ...runs.map(run => ({
      id: runKey(run),
      label: `${statusLabel(run.status)} · ${run.workflowId}`,
    })),
  ];
  const selected = value ? runKey(value) : NO_RUN;
  return (
    <Select
      label="Show a run"
      size="small"
      style={{ minWidth: 260, maxWidth: 420 }}
      options={
        options.some(o => o.id === selected)
          ? options
          : [...options, { id: selected, label: value?.workflowId ?? '' }]
      }
      selectedKey={selected}
      onSelectionChange={key =>
        props.onChange(runs.find(run => runKey(run) === String(key)))
      }
      data-testid="definition-run-select"
    />
  );
}

/** What the colors of a run mean. */
function Legend(props: { overlay: DefinitionOverlay }) {
  const items: [string, string][] = [
    ['success', 'Done'],
    ['info', 'Running'],
    ['danger', 'Failed'],
    ['dimmed', 'Not reached'],
  ];
  return (
    <Flex
      className={tp('tp-def-legend')}
      align="center"
      gap="3"
      data-testid="definition-legend"
    >
      {items.map(([tone, label]) => (
        <span key={tone} className={tp('tp-def-legend-item')}>
          <span
            className={tp('tp-def-legend-swatch', `tp-def-swatch-${tone}`)}
            aria-hidden
          />
          {label}
        </span>
      ))}
      <Text as="span" variant="body-small" color="secondary">
        Tasks without an event in the history (set, switch, wait, raise) are not
        marked.
        {props.overlay.unmatched > 0 &&
          ` ${props.overlay.unmatched} steps of the run match no task.`}
      </Text>
    </Flex>
  );
}

function errorTitle(error: WorkflowDefinitionError): string {
  switch (error.kind) {
    case 'parse':
      return `The definition is not valid YAML${
        error.line ? ` (line ${error.line})` : ''
      }`;
    case 'tooLarge':
      return 'The definition file is too large';
    case 'format':
      return 'The definition may not be a Serverless Workflow';
    default:
      return 'The definition could not be read';
  }
}

/** The definition, the graph and the selected run. */
function DefinitionView(props: {
  entityRef: string;
  definition: WorkflowDefinitionResponse;
}) {
  const { entityRef, definition } = props;
  const api = useApi(temporalApiRef);
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const graph: Graph | undefined = useMemo(
    () =>
      definition.document && Array.isArray(definition.document.do)
        ? buildDefinitionGraph(definition.document)
        : undefined,
    [definition.document],
  );
  const [selectedNode, setSelectedNode] = useState<string>();
  const [cursorLine, setCursorLine] = useState<number>();
  const [scrollKey, setScrollKey] = useState<number>();
  const tasks = definition.tasks;
  const selectedPointer = selectedNode
    ? pointerOfNode(selectedNode)
    : undefined;
  const selectedTask = tasks.find(t => t.pointer === selectedPointer);

  // The run to show: `?workflowId=...&runId=...`.
  const workflowId = search.get('workflowId') ?? undefined;
  const runId = search.get('runId') ?? undefined;
  const runs = useAsync(
    async () =>
      (await api.listEntityWorkflows(entityRef, { pageSize: 20 })).items,
    [api, entityRef],
  );
  const namespace =
    runs.value?.find(r => r.workflowId === workflowId)?.namespace ??
    runs.value?.[0]?.namespace ??
    'default';
  const run = useAsyncRetry(async () => {
    if (!workflowId) return undefined;
    return api.getWorkflowGraph(
      { namespace, workflowId, runId },
      { entityRef },
    );
  }, [api, entityRef, namespace, workflowId, runId]);
  const running = run.value?.status === 'Running';
  const { retry } = run;
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(retry, RUN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [running, retry]);
  const overlay = useMemo(
    () =>
      run.value && definition.document
        ? overlayRun(definition.document, run.value)
        : undefined,
    [run.value, definition.document],
  );

  const selectNode = useCallback(
    (id: string | undefined) => {
      setSelectedNode(id);
      const pointer = id ? pointerOfNode(id) : undefined;
      const task = tasks.find(t => t.pointer === pointer);
      setCursorLine(task?.startLine);
      setScrollKey(key => (key ?? 0) + 1);
    },
    [tasks],
  );
  const selectLine = useCallback(
    (line: number) => {
      setCursorLine(line);
      const task = taskAtLine(tasks, line);
      setSelectedNode(task?.pointer);
    },
    [tasks],
  );

  const mark = selectedPointer
    ? overlay?.marks.get(selectedPointer)
    : undefined;
  const node = graph?.nodes.find(n => n.id === selectedNode);
  const temporalTab = location.pathname.replace(/\/[^/]*\/?$/, '/temporal');
  const runLink =
    workflowId && run.value
      ? `${temporalTab}/${workflowLink({ namespace, workflowId, runId })}`
      : undefined;

  const error = definition.error;
  return (
    <Flex direction="column" gap="4">
      {error && (
        <Alert
          status={error.kind === 'format' ? 'warning' : 'danger'}
          icon
          title={errorTitle(error)}
          description={error.message}
          data-testid="definition-error"
        />
      )}
      <Flex align="end" justify="between" gap="3" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Text as="p" variant="body-small" color="secondary">
            {definition.url ? (
              <Link
                href={definition.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="body-small"
              >
                {definition.target}
              </Link>
            ) : (
              definition.target
            )}
            {definition.size !== undefined && ` · ${definition.size} bytes`}
            {` · ${tasks.length} tasks`}
          </Text>
        </div>
        <Flex align="end" gap="2">
          {runs.error ? (
            <Text as="span" variant="body-small" color="secondary">
              Runs could not be loaded
            </Text>
          ) : (
            <RunSelect
              runs={runs.value ?? []}
              value={workflowId ? { workflowId, runId } : undefined}
              onChange={next => {
                setSearch(
                  current => {
                    const params = new URLSearchParams(current);
                    params.delete('workflowId');
                    params.delete('runId');
                    if (next) {
                      params.set('workflowId', next.workflowId);
                      if (next.runId) params.set('runId', next.runId);
                    }
                    return params;
                  },
                  { replace: true },
                );
              }}
            />
          )}
          {runLink && (
            <ButtonLink variant="secondary" size="small" href={runLink}>
              Open the run
            </ButtonLink>
          )}
        </Flex>
      </Flex>
      {run.error && (
        <ErrorAlert title="The run could not be loaded" error={run.error} />
      )}
      {overlay && <Legend overlay={overlay} />}
      <div className={tp('tp-def-layout')}>
        <div className={tp('tp-def-source')}>
          {definition.content !== undefined ? (
            <YamlView
              content={definition.content}
              highlight={selectedTask}
              cursorLine={cursorLine}
              scrollKey={scrollKey}
              onLineSelect={selectLine}
              errorLine={error?.kind === 'parse' ? error.line : undefined}
            />
          ) : (
            <Text as="p" variant="body-medium" color="secondary">
              No file to show.
            </Text>
          )}
        </div>
        <div className={tp('tp-def-diagram')}>
          {graph ? (
            <DefinitionGraph
              graph={graph}
              overlay={overlay}
              selectedId={selectedNode}
              onSelect={selectNode}
            />
          ) : (
            <Text as="p" variant="body-medium" color="secondary">
              No graph: the file has no task list.
            </Text>
          )}
        </div>
      </div>
      {node && selectedTask && (
        <PanelCard
          title={node.title}
          subtitle={node.subtitle}
          testId="definition-task"
        >
          <DefinitionList
            items={[
              ['Kind', node.kind === 'unsupported' ? 'unsupported' : node.kind],
              ['Lines', `${selectedTask.startLine}–${selectedTask.endLine}`],
              ['Pointer', selectedTask.pointer],
              ...(overlay
                ? [
                    [
                      'In this run',
                      mark
                        ? markLabel(mark)
                        : 'Not marked: no event in the history names this task',
                    ] as [string, string],
                  ]
                : []),
            ]}
          />
        </PanelCard>
      )}
    </Flex>
  );
}

/** Loads and shows the definition of a `TemporalWorkflow` entity. */
function LoadedDefinition(props: { entity: Entity }) {
  const api = useApi(temporalApiRef);
  const entityRef = stringifyEntityRef(props.entity);
  const state = useAsync(
    () => api.getEntityDefinition(entityRef),
    [api, entityRef],
  );
  if (state.loading) return <Loading rows={6} label="Loading the definition" />;
  if (state.error) {
    return (
      <ErrorAlert
        title="The definition could not be loaded"
        error={state.error}
      />
    );
  }
  return <DefinitionView entityRef={entityRef} definition={state.value!} />;
}

/**
 * Definition tab of a `TemporalWorkflow` entity: the YAML of a workflow
 * written in the Serverless Workflow DSL next to its graph, with an
 * optional run on top. Workflows written in code get links to their source.
 */
export function EntityTemporalDefinitionContentPage() {
  const { entity } = useEntity();
  if (!isTemporalWorkflowEntity(entity)) {
    return (
      <Alert
        status="warning"
        icon
        title="Not a TemporalWorkflow entity"
        description="The Definition tab only works on entities of kind TemporalWorkflow."
      />
    );
  }
  let spec;
  try {
    spec = getTemporalWorkflowDefinitionSpec(entity);
  } catch (error) {
    return (
      <ErrorAlert title="Invalid spec.definition" error={error as Error} />
    );
  }
  if (!spec) return <SourceLinks entity={entity} />;
  return <LoadedDefinition entity={entity} />;
}
