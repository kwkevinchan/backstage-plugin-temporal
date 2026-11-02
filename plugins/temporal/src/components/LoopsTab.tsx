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

import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { addLlmUsage } from '../common';
import type {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowLlmUsage,
  WorkflowLoopGroup,
  WorkflowLoopRound,
  WorkflowLoopsResponse,
  WorkflowRef,
} from '../common';
import { temporalApiRef } from '../extensions';
import {
  Alert,
  Cell,
  Column,
  Flex,
  Link,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { ErrorAlert, Loading } from './feedback';
import { formatDuration } from './format';
import {
  decisionText,
  loopStatusLabel,
  loopTone,
  roundLabel,
} from './loopText';
import { StatusIcon, WorkflowStatusLabel } from './WorkflowStatusLabel';
import { RiSparkling2Line, RiToolsLine } from '@remixicon/react';
import { tokensText } from './llm/llmText';
import { tp } from './styles';

/** The loops of the open run, when the API cannot read the other runs. */
function fromGraph(
  graph: WorkflowGraphResponse,
  workflow: WorkflowDetail,
): WorkflowLoopsResponse {
  return {
    loops: (graph.loops ?? []).map(loop => ({
      ...loop,
      rounds: loop.rounds.map(r => ({ ...r, runId: workflow.runId })),
    })),
    runs: [{ runId: workflow.runId, segment: 1, status: workflow.status }],
    source: 'history',
    truncated: graph.truncated,
  };
}

/**
 * Loads the loops of a workflow across its continue-as-new runs, again
 * when the graph of the open run is reloaded.
 */
function useLoops(
  workflow: WorkflowDetail,
  graph: WorkflowGraphResponse,
  entityRef: string | undefined,
) {
  const api = useApi(temporalApiRef);
  const [state, setState] = useState<{
    data?: WorkflowLoopsResponse;
    error?: Error;
  }>({});
  useEffect(() => {
    let current = true;
    if (!api.getWorkflowLoops) {
      setState({ data: fromGraph(graph, workflow) });
      return undefined;
    }
    api
      .getWorkflowLoops(
        {
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        },
        { entityRef },
      )
      .then(
        data => current && setState({ data }),
        error => current && setState(s => ({ data: s.data, error })),
      );
    return () => {
      current = false;
    };
  }, [api, workflow, graph, entityRef]);
  return state;
}

function StepsCell(props: { round: WorkflowLoopRound }) {
  const steps = props.round.steps;
  if (steps.length === 0) {
    return (
      <Text variant="body-small" color="secondary">
        No steps yet
      </Text>
    );
  }
  return (
    <span className={tp('tp-loop-steps')}>
      {steps.map(step => (
        <span
          key={step.nodeId}
          className={tp('tp-loop-step', `tp-tone-${toneOf(step.status)}`)}
          title={`${step.name}: ${step.status}${
            step.usage ? ` · ${tokensText(step.usage)}` : ''
          }`}
          data-llm={step.llm}
        >
          <StatusIcon status={step.status} size={14} />
          {step.llm === 'llm' && (
            <RiSparkling2Line
              size={14}
              className={tp('tp-llm-icon')}
              aria-label="Model call"
            />
          )}
          {step.llm === 'tool' && (
            <RiToolsLine
              size={14}
              className={tp('tp-llm-icon')}
              aria-label="Tool call"
            />
          )}
          <Text as="span" variant="body-small">
            {step.name}
          </Text>
        </span>
      ))}
    </span>
  );
}

function toneOf(status: WorkflowLoopRound['status']) {
  switch (status) {
    case 'Completed':
      return 'success';
    case 'Failed':
    case 'TimedOut':
      return 'danger';
    case 'Running':
      return 'info';
    default:
      return 'neutral';
  }
}

function LoopTable(props: {
  loop: WorkflowLoopGroup;
  runId: string;
  multipleRuns: boolean;
  runHref(runId: string, loop: string, iteration: number): string;
  onShowRound(loop: string, iteration: number): void;
}) {
  const { loop, runId, multipleRuns } = props;
  const rounds = [...loop.rounds].reverse();
  const summary = decisionText(loop);
  // Rounds with model calls get a tokens column, and the loop a total.
  const withTokens = loop.rounds.some(r => r.usage);
  const total = loop.rounds.reduce<WorkflowLlmUsage | undefined>(
    (sum, r) => addLlmUsage(sum, r.usage),
    undefined,
  );
  return (
    <section
      className={tp('tp-section')}
      data-testid={`loop-table-${loop.name}`}
      aria-label={`Loop ${loop.name}`}
    >
      <Flex align="baseline" gap="3" style={{ flexWrap: 'wrap' }}>
        <Text as="h3" variant="title-x-small" style={{ margin: 0 }}>
          {loop.name}
        </Text>
        <span
          className={tp('tp-status', `tp-tone-${loopTone(loop.status)}`)}
          data-testid="loop-status"
        >
          <span className={tp('tp-status-text')}>
            {loopStatusLabel(loop.status)}
          </span>
        </span>
        <Text variant="body-small" color="secondary">
          {roundLabel(loop.iteration, loop)}
          {summary && ` · last ${summary}`}
        </Text>
        {total && (
          <Text
            variant="body-small"
            color="secondary"
            data-testid="loop-tokens-total"
          >
            Tokens: {tokensText(total)}
          </Text>
        )}
      </Flex>
      <TableRoot
        aria-label={`Rounds of ${loop.name}`}
        onRowAction={key => {
          const round = loop.rounds.find(r => `round-${r.iteration}` === key);
          if (round && (!round.runId || round.runId === runId)) {
            props.onShowRound(loop.name, round.iteration);
          }
        }}
      >
        <TableHeader>
          <Column isRowHeader>Round</Column>
          {multipleRuns ? <Column>Run</Column> : null}
          <Column>Status</Column>
          <Column>Steps</Column>
          <Column>Duration</Column>
          {withTokens ? <Column>Tokens</Column> : null}
          <Column>Decision</Column>
          <Column>Score</Column>
        </TableHeader>
        <TableBody
          renderEmptyState={() => <Text color="secondary">No rounds</Text>}
        >
          {rounds.map(round => {
            const elsewhere = round.runId && round.runId !== runId;
            return (
              <Row key={round.iteration} id={`round-${round.iteration}`}>
                <Cell>
                  <Text variant="body-small" weight="bold">
                    {round.iteration}
                  </Text>
                </Cell>
                {multipleRuns ? (
                  <Cell>
                    {elsewhere ? (
                      <Link
                        href={props.runHref(
                          round.runId!,
                          loop.name,
                          round.iteration,
                        )}
                        variant="body-small"
                      >
                        Run {round.segment}
                      </Link>
                    ) : (
                      <Text variant="body-small">
                        Run {round.segment} (this run)
                      </Text>
                    )}
                  </Cell>
                ) : null}
                <Cell>
                  <WorkflowStatusLabel status={round.status} />
                </Cell>
                <Cell>
                  <StepsCell round={round} />
                </Cell>
                <Cell>
                  <Text variant="body-small">
                    {formatDuration(round.startTime, round.endTime)}
                  </Text>
                </Cell>
                {withTokens ? (
                  <Cell>
                    <Text
                      variant="body-small"
                      data-testid={`round-tokens-${round.iteration}`}
                      title={
                        round.llmCalls
                          ? `${round.llmCalls} model call${
                              round.llmCalls === 1 ? '' : 's'
                            }`
                          : undefined
                      }
                    >
                      {tokensText(round.usage)}
                    </Text>
                  </Cell>
                ) : null}
                <Cell>
                  <Text variant="body-small">{round.decision ?? ''}</Text>
                </Cell>
                <Cell>
                  <Text variant="body-small">
                    {round.score !== undefined ? String(round.score) : ''}
                  </Text>
                </Cell>
              </Row>
            );
          })}
        </TableBody>
      </TableRoot>
    </section>
  );
}

/**
 * The Loops tab: one table per loop with its rounds, newest first, across
 * the runs the workflow continued as new. Pressing a round of this run
 * shows it in the graph; rounds of other runs link to that run.
 */
export function LoopsTab(props: {
  workflow: WorkflowDetail;
  graph: WorkflowGraphResponse;
  entityRef?: string;
  workflowHref(ref: WorkflowRef): string;
  onShowRound(loop: string, iteration: number): void;
}) {
  const { workflow, graph } = props;
  const { data, error } = useLoops(workflow, graph, props.entityRef);
  if (!data) {
    return error ? (
      <ErrorAlert error={error} />
    ) : (
      <Loading label="Loading loops" />
    );
  }
  const runHref = (runId: string, loop: string, iteration: number) =>
    `${props.workflowHref({
      namespace: workflow.namespace,
      workflowId: workflow.workflowId,
      runId,
    })}?${new URLSearchParams({ loop, round: String(iteration) })}`;
  return (
    <Flex direction="column" gap="4" data-testid="workflow-loops">
      {error && (
        <ErrorAlert title="Could not refresh the loops" error={error} />
      )}
      {data.truncated && (
        <Alert
          status="info"
          icon
          title="Not every run or event was read; some rounds may be missing."
        />
      )}
      <Text variant="body-small" color="secondary">
        {data.runs.length > 1
          ? `${data.runs.length} runs (continue as new). `
          : ''}
        {data.source === 'query'
          ? 'State from the running workflow.'
          : 'State from the history.'}
      </Text>
      {data.loops.length === 0 && (
        <Text color="secondary">No loops in this workflow.</Text>
      )}
      {data.loops.map(loop => (
        <LoopTable
          key={loop.name}
          loop={loop}
          runId={workflow.runId}
          multipleRuns={data.runs.length > 1}
          runHref={runHref}
          onShowRound={props.onShowRound}
        />
      ))}
    </Flex>
  );
}
