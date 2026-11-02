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
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { temporalApiRef } from '../extensions';
import { Button, Grid, Text } from '@backstage/ui';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { ErrorAlert, Loading } from './feedback';
import { formatMilliseconds } from './format';
import { PanelCard } from './PanelCard';

/** Props of the recent runs card. */
export interface TemporalWorkflowStatsCardProps {
  /** Number of most recent runs to count; default 50, at most 100. */
  limit?: number;
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <div role="group" aria-label={props.label} style={{ textAlign: 'center' }}>
      <Text as="p" variant="title-large" style={{ margin: 0 }}>
        {props.value}
      </Text>
      <Text as="p" variant="body-small" color="secondary" style={{ margin: 0 }}>
        {props.label}
      </Text>
    </div>
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
    body = <Loading />;
  } else if (error || !value) {
    body = <ErrorAlert error={error ?? new Error('No statistics')} />;
  } else {
    body = (
      <Grid.Root columns={{ initial: '2', sm: '4' }} gap="4">
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
      </Grid.Root>
    );
  }

  return (
    <PanelCard
      title="Recent runs"
      subtitle={
        value
          ? `Last ${value.sampleSize} run${
              value.sampleSize === 1 ? '' : 's'
            } (at most ${value.limit})`
          : undefined
      }
      actions={
        <Button variant="secondary" size="small" onPress={retry}>
          Refresh
        </Button>
      }
    >
      {body}
    </PanelCard>
  );
}
