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

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  InfoCard,
  Link,
  Progress,
  ResponseErrorPanel,
  StructuredMetadataTable,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  temporalApiRef,
  TemporalWorkflowActionDef,
  TemporalWorkflowProvider,
  TemporalWorkflowSectionDef,
} from '@kwkevinchan/backstage-plugin-temporal-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { FailureView } from './FailureView';
import { formatDuration, formatTime } from './format';
import { PendingActivities } from './PendingActivities';
import { WorkflowHistory } from './WorkflowHistory';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';
import { WorkflowSteps } from './WorkflowSteps';

function summaryMetadata(workflow: WorkflowDetail) {
  const metadata: Record<string, unknown> = {
    'Workflow ID': workflow.workflowId,
    'Run ID': workflow.runId,
    Type: workflow.workflowType,
    'Task queue': workflow.taskQueue ?? '',
    Namespace: workflow.namespace,
    Status: <WorkflowStatusLabel status={workflow.status} />,
    Started: formatTime(workflow.startTime),
    Ended: formatTime(workflow.closeTime),
    Duration: formatDuration(workflow.startTime, workflow.closeTime),
    'History events': workflow.historyLength ?? '',
  };
  if (workflow.parent) {
    metadata['Parent workflow'] = workflow.parent.workflowId;
  }
  return metadata;
}

/** Details of one workflow execution, inside the entity tab. */
export function WorkflowDetailPage(props: {
  workflowActions?: TemporalWorkflowActionDef[];
  workflowSections?: TemporalWorkflowSectionDef[];
}) {
  const { workflowActions = [], workflowSections = [] } = props;
  const params = useParams();
  const { entity } = useEntity();
  const entityRef = stringifyEntityRef(entity);
  const temporalApi = useApi(temporalApiRef);
  const workflowRef = useMemo(
    () => ({
      namespace: params.namespace ?? '',
      workflowId: params.workflowId ?? '',
      runId: params.runId,
    }),
    [params.namespace, params.workflowId, params.runId],
  );

  const {
    value: workflow,
    loading,
    error,
    retry,
  } = useAsyncRetry(
    () => temporalApi.getWorkflow(workflowRef, { entityRef }),
    [temporalApi, workflowRef, entityRef],
  );

  // History of the run that was loaded, also when the URL has no run ID.
  const historyRef = useMemo(
    () =>
      workflow
        ? {
            namespace: workflow.namespace,
            workflowId: workflow.workflowId,
            runId: workflow.runId,
          }
        : undefined,
    [workflow],
  );

  const back = (
    <Box mb={2}>
      <Link
        to={params.runId ? '../../../../../..' : '../../../..'}
        relative="path"
      >
        ← All workflows
      </Link>
    </Box>
  );

  if (loading && !workflow) {
    return (
      <>
        {back}
        <Progress />
      </>
    );
  }
  if (error || !workflow) {
    return (
      <>
        {back}
        <ResponseErrorPanel error={error ?? new Error('Workflow not found')} />
      </>
    );
  }

  const extensionProps = { workflow, entity, reload: retry };
  const actions = workflowActions.filter(a => !a.filter || a.filter(workflow));
  const sections = workflowSections.filter(
    s => !s.filter || s.filter(workflow),
  );

  return (
    <TemporalWorkflowProvider value={extensionProps}>
      {back}
      <Box display="flex" alignItems="center" flexWrap="wrap" mb={2}>
        <Typography variant="h5" component="h2" style={{ marginRight: 16 }}>
          {workflow.workflowId}
        </Typography>
        <WorkflowStatusLabel status={workflow.status} />
        <Box flexGrow={1} />
        <Box display="flex" alignItems="center" flexWrap="wrap">
          {actions.map(({ id, component: Action }) => (
            <Box key={id} ml={1} data-testid={`temporal-action-${id}`}>
              <Action {...extensionProps} />
            </Box>
          ))}
          {workflow.webUiUrl && (
            <Box ml={1}>
              <Button
                variant="outlined"
                color="primary"
                href={workflow.webUiUrl}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<OpenInNewIcon />}
              >
                Open in Temporal UI
              </Button>
            </Box>
          )}
          <Box ml={1}>
            <Button onClick={retry}>Refresh</Button>
          </Box>
        </Box>
      </Box>
      <Grid container spacing={3}>
        <Grid item xs={12} md={workflow.failure ? 6 : 12}>
          <InfoCard title="Summary">
            <StructuredMetadataTable metadata={summaryMetadata(workflow)} />
          </InfoCard>
        </Grid>
        {workflow.failure && (
          <Grid item xs={12} md={6}>
            <InfoCard title="Failure">
              <FailureView failure={workflow.failure} />
            </InfoCard>
          </Grid>
        )}
        {workflow.pendingActivities.length > 0 && (
          <Grid item xs={12}>
            <InfoCard title="Pending activities">
              <PendingActivities activities={workflow.pendingActivities} />
            </InfoCard>
          </Grid>
        )}
        <Grid item xs={12}>
          <InfoCard title="Inputs and outputs">
            {historyRef && (
              <WorkflowSteps workflowRef={historyRef} entityRef={entityRef} />
            )}
          </InfoCard>
        </Grid>
        {sections.map(({ id, title, component: Section }) => (
          <Grid item xs={12} key={id} data-testid={`temporal-section-${id}`}>
            {title ? (
              <InfoCard title={title}>
                <Section {...extensionProps} />
              </InfoCard>
            ) : (
              <Section {...extensionProps} />
            )}
          </Grid>
        ))}
        <Grid item xs={12}>
          <InfoCard title="Event history">
            {historyRef && (
              <WorkflowHistory workflowRef={historyRef} entityRef={entityRef} />
            )}
          </InfoCard>
        </Grid>
      </Grid>
    </TemporalWorkflowProvider>
  );
}
