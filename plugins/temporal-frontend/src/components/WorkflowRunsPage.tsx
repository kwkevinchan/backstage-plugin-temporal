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
import { useNavigate, useParams, useResolvedPath } from 'react-router-dom';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Button, Flex, Link, Text } from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import type { WorkflowSummary } from '../common';
import { temporalApiRef } from '../extensions';
import { ErrorAlert } from './feedback';
import { savedListSearch } from './listState';
import { PanelCard } from './PanelCard';
import { useRefreshLock } from './useRefreshLock';
import { Pager, workflowLink, WorkflowRunsTable } from './WorkflowRunsTable';

/** Runs on one page of the run list. */
const RUNS_PAGE_SIZE = 20;

/** The run list of a workflow ID, inside the entity tab. */
export function EntityWorkflowRunsPage() {
  const { entity } = useEntity();
  return <WorkflowRunsPage entity={entity} />;
}

/**
 * The runs of one workflow ID, for a link without a run (an old link, or a
 * child workflow that has not started yet). A workflow ID with one run
 * opens that run; with several, they are listed, the latest first. With an
 * entity, only the runs that are its workflows are listed.
 */
export function WorkflowRunsPage(props: { entity?: Entity }) {
  const params = useParams();
  const namespace = params.namespace ?? '';
  const workflowId = params.workflowId ?? '';
  const entityRef = props.entity ? stringifyEntityRef(props.entity) : undefined;
  const temporalApi = useApi(temporalApiRef);
  const navigate = useNavigate();
  // The tokens of the pages before this one; the first page has none.
  const [tokens, setTokens] = useState<(string | undefined)[]>([]);
  const pageToken = tokens[tokens.length - 1];

  const { value, loading, error, retry } = useAsyncRetry(
    () =>
      temporalApi.listWorkflowRuns(
        { namespace, workflowId },
        { entityRef, pageSize: RUNS_PAGE_SIZE, pageToken },
      ),
    [temporalApi, namespace, workflowId, entityRef, pageToken],
  );
  const refresh = useRefreshLock(retry, loading);

  // The list this page was opened from.
  const rootPath = useResolvedPath('../../../..', {
    relative: 'path',
  }).pathname.replace(/\/+$/, '');
  const runHref = (item: Pick<WorkflowSummary, 'runId'>) =>
    `${rootPath}/${workflowLink({
      namespace,
      workflowId,
      runId: item.runId,
    })}`;

  // A workflow ID with one run: that run, in place of this page.
  const only =
    tokens.length === 0 && value?.items.length === 1 && !value.nextPageToken
      ? value.items[0]
      : undefined;
  useEffect(() => {
    if (only) navigate(runHref(only), { replace: true });
    // runHref only changes with the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only, navigate]);

  const back = (
    <Link
      href={`${rootPath || '/'}${savedListSearch(rootPath || '/')}`}
      variant="body-medium"
      data-testid="back-to-list"
    >
      ← Workflow executions
    </Link>
  );

  return (
    <Flex direction="column" gap="4">
      {back}
      <PanelCard
        title={workflowId}
        subtitle={`Runs of this workflow ID · Namespace: ${namespace}`}
        testId="workflow-runs"
        actions={
          <Button
            variant="secondary"
            size="small"
            isPending={refresh.locked}
            onPress={refresh.refresh}
          >
            Refresh
          </Button>
        }
      >
        <Text
          as="p"
          variant="body-small"
          color="secondary"
          style={{ marginTop: 0 }}
        >
          One workflow ID can have several runs: a run that continues as new, a
          reset or a later start with the same ID. The latest run is listed
          first.
        </Text>
        {error ? (
          <ErrorAlert error={error} />
        ) : (
          <WorkflowRunsTable
            label="Runs of the workflow ID"
            items={only ? [] : value?.items ?? []}
            entityRef={entityRef}
            refreshToken={refresh.count}
            showTaskQueue
            pending={loading || Boolean(only)}
            byRun
            latestRunId={
              tokens.length === 0 ? value?.items[0]?.runId : undefined
            }
            workflowHref={runHref}
            emptyText={
              loading || only
                ? 'Loading runs…'
                : 'No runs of this workflow ID can be shown. The workflow may not exist, its runs may be past the retention period, or you may not have access to them.'
            }
          />
        )}
        <Pager
          page={tokens.length + 1}
          hasPrevious={tokens.length > 0}
          hasNext={Boolean(value?.nextPageToken)}
          disabled={loading}
          onPrevious={() => setTokens(t => t.slice(0, -1))}
          onNext={() =>
            value?.nextPageToken && setTokens(t => [...t, value.nextPageToken])
          }
        />
      </PanelCard>
    </Flex>
  );
}
