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

import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  InfoCard,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { formatMilliseconds } from './format';

/** Props of the recent runs card. */
export interface TemporalWorkflowStatsCardProps {
  /** Number of most recent runs to count; default 50, at most 100. */
  limit?: number;
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <Grid item xs={6} sm={3}>
      <Box role="group" aria-label={props.label} textAlign="center">
        <Typography variant="h4" component="p">
          {props.value}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {props.label}
        </Typography>
      </Box>
    </Grid>
  );
}

/** Succeeded, failed and running counts and mean duration of recent runs. */
export function TemporalWorkflowStatsCard(
  props: TemporalWorkflowStatsCardProps,
) {
  const { entity } = useEntity();
  const temporalApi = useApi(temporalApiRef);
  const entityRef = stringifyEntityRef(entity);
  const limit = props.limit ?? 50;
  const { value, loading, error, retry } = useAsyncRetry(
    () => temporalApi.getEntityWorkflowStats(entityRef, { limit }),
    [temporalApi, entityRef, limit],
  );

  let body;
  if (loading && !value) {
    body = <Progress />;
  } else if (error || !value) {
    body = <ResponseErrorPanel error={error ?? new Error('No statistics')} />;
  } else {
    body = (
      <Grid container spacing={2}>
        <Stat label="Succeeded" value={value.succeeded} />
        <Stat label="Failed" value={value.failed} />
        <Stat label="Running" value={value.running} />
        <Stat
          label="Average duration"
          value={
            value.averageDurationMs === undefined
              ? '—'
              : formatMilliseconds(value.averageDurationMs)
          }
        />
      </Grid>
    );
  }

  return (
    <InfoCard
      title="Recent runs"
      subheader={
        value
          ? `Last ${value.sampleSize} run${
              value.sampleSize === 1 ? '' : 's'
            } (at most ${value.limit})`
          : undefined
      }
      action={
        <Box mt={1} mr={1}>
          <Button onClick={retry}>Refresh</Button>
        </Box>
      }
    >
      {body}
    </InfoCard>
  );
}
