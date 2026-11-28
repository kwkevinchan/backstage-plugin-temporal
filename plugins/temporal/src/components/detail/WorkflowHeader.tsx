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
import { useApi } from '@backstage/core-plugin-api';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  Link,
  Switch,
  Text,
} from '@backstage/ui';
import { RiExternalLinkLine, RiRefreshLine } from '@remixicon/react';
import useAsync from 'react-use/esm/useAsync';
import type {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowRef,
  WorkflowRunChain,
} from '../../common';
import { CLOSED_WITH_FAILURE } from '../../common/stepRules';
import {
  temporalApiRef,
  TemporalWorkflowActionDef,
  TemporalWorkflowExtensionProps,
} from '../../extensions';
import { ErrorAlert } from '../feedback';
import { deadlineText, formatDuration, formatTime } from '../format';
import { QueryButton } from '../messages/QueryButton';
import { RunHelp } from '../RunHelp';
import { tp } from '../styles';
import { httpUrl } from '../webUi';
import { WorkflowStatusLabel } from '../WorkflowStatusLabel';

/**
 * One field of the header: the label above, the value below. A wide field
 * (long text, links) spans two columns when there is room.
 */
function SummaryItem(props: {
  label: string;
  /** Shown after the label: an explanation of the field. */
  help?: ReactNode;
  wide?: boolean;
  testId?: string;
  children: ReactNode;
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

/**
 * Notices on a run that is not the one to look at: a run that continued as
 * new, with a link to the run it continued as; a closed run that is not the
 * latest of its workflow ID, with a link to the runs of the ID. Whether it
 * is the latest is read from the run list, which has only the runs the user
 * may see, and only for a closed run.
 */
function RunNotices(props: {
  workflow: WorkflowDetail;
  /** The run this one continued as, from the details or the graph. */
  nextRunId?: string;
  entityRef?: string;
  workflowHref(ref: WorkflowRef): string;
}) {
  const { workflow, nextRunId, entityRef, workflowHref } = props;
  const api = useApi(temporalApiRef);
  const { namespace, workflowId, runId } = workflow;
  const closed = workflow.status !== 'Running';
  const { value: latestRunId } = useAsync(async () => {
    if (!closed || nextRunId) return undefined;
    try {
      const list = await api.listWorkflowRuns(
        { namespace, workflowId },
        { entityRef, pageSize: 1 },
      );
      return list.items[0]?.runId;
    } catch {
      // Without the run list (no list permission), no notice.
      return undefined;
    }
  }, [api, namespace, workflowId, runId, closed, nextRunId, entityRef]);
  if (nextRunId) {
    return (
      <Alert
        status="info"
        icon
        title="This run continued as new."
        data-testid="run-continued-as-new"
        description={
          <Link
            href={workflowHref({ namespace, workflowId, runId: nextRunId })}
            variant="body-medium"
          >
            Open the run it continued as
          </Link>
        }
      />
    );
  }
  if (latestRunId && latestRunId !== runId) {
    return (
      <Alert
        status="info"
        icon
        title="This is not the latest run of this workflow ID."
        data-testid="run-not-latest"
        description={
          <Link
            href={workflowHref({ namespace, workflowId })}
            variant="body-medium"
          >
            See the runs of this workflow ID
          </Link>
        }
      />
    );
  }
  return null;
}

/** Label of the run chain field: which run of the chain this is. */
function runChainLabel(chain: WorkflowRunChain): string {
  return chain.index && chain.total
    ? `Run ${chain.index} of ${chain.total}`
    : 'One of several runs';
}

function currentLabel(workflow: WorkflowDetail) {
  if (workflow.status === 'Running') return 'Now';
  if (CLOSED_WITH_FAILURE.includes(workflow.status)) {
    return 'Stopped at';
  }
  return 'Result';
}

/**
 * The header of the details page: the workflow ID and the run ID, the
 * action bar, the fields of the run and its notices.
 */
export function WorkflowHeader(props: {
  workflow: WorkflowDetail;
  graph?: WorkflowGraphResponse;
  entityRef?: string;
  /** The actions of the action bar that apply to the workflow. */
  actions: TemporalWorkflowActionDef[];
  /** What each action is given. */
  extensionProps: TemporalWorkflowExtensionProps;
  workflowHref(ref: WorkflowRef): string;
  refresh: { locked: boolean; refresh(): void };
  /** True while the page reads the run again. */
  refreshing: boolean;
  /** Why the page could not read the run again. */
  error?: Error;
  autoRefresh: boolean;
  onAutoRefreshChange(autoRefresh: boolean): void;
}) {
  const {
    workflow,
    graph,
    entityRef,
    actions,
    extensionProps,
    workflowHref,
    refresh,
    autoRefresh,
  } = props;
  const webUiUrl = httpUrl(workflow.webUiUrl);
  const running = workflow.status === 'Running';
  return (
    <Card>
      <CardBody className={tp('tp-header')}>
        <div className={tp('tp-header-top')}>
          <div className={tp('tp-header-title')}>
            <Text as="h2" variant="title-medium" className={tp('tp-header-id')}>
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
            {webUiUrl && (
              <ButtonLink
                variant="secondary"
                href={webUiUrl}
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
              isPending={refresh.locked || (props.refreshing && !running)}
              onPress={refresh.refresh}
            >
              Refresh
            </Button>
            {running && (
              <Switch
                label="Auto refresh"
                isSelected={autoRefresh}
                onChange={props.onAutoRefreshChange}
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
              wide={Boolean(graph.currentDeadline) || graph.current.length > 32}
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
        <RunNotices
          workflow={workflow}
          nextRunId={
            workflow.status === 'ContinuedAsNew'
              ? workflow.continuedAsNewRunId ?? graph?.runChain?.nextRunId
              : undefined
          }
          entityRef={entityRef}
          workflowHref={workflowHref}
        />
        {props.error && (
          <ErrorAlert title="Could not refresh" error={props.error} />
        )}
      </CardBody>
    </Card>
  );
}
