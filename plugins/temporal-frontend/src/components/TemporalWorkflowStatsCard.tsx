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
import { useRef } from 'react';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import { ErrorAlert, Loading } from './feedback';
import { formatMilliseconds } from './format';
import { PanelCard } from './PanelCard';
import { useRefreshLock } from './useRefreshLock';

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

/**
 * Running, completed and failed counts and mean duration of a
 * `TemporalWorkflow` entity. The numbers are the ones of the Workflows tab of
 * the Temporal page. The Refresh button reads them again from Temporal
 * instead of using the ones the backend kept for a minute.
 */
export function TemporalWorkflowStatsCard() {
  const { entity } = useEntity();
  const temporalApi = useApi(temporalApiRef);
  const entityRef = stringifyEntityRef(entity);
  const refreshNext = useRef(false);
  const { value, loading, error, retry } = useAsyncRetry(async () => {
    const refresh = refreshNext.current;
    refreshNext.current = false;
    const response = await temporalApi.getWorkflowTypeOverview(
      [entityRef],
      refresh ? { refresh } : undefined,
    );
    return response.items.find(item => item.entityRef === entityRef);
  }, [temporalApi, entityRef]);
  const refresh = useRefreshLock(() => {
    refreshNext.current = true;
    retry();
  }, loading);

  let body;
  if (loading && !value) {
    body = <Loading />;
  } else if (error || !value) {
    body = <ErrorAlert error={error ?? new Error('No statistics')} />;
  } else if (value.error) {
    body = <ErrorAlert error={new Error(value.error.message)} />;
  } else {
    body = (
      <Grid.Root columns={{ initial: '2', sm: '4' }} gap="4">
        <Stat label="Running" value={value.running} />
        <Stat label="Completed" value={value.completed} />
        <Stat label="Failed" value={value.failed} />
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
      title="Run statistics"
      subtitle={
        value && !value.error
          ? `Completed and failed in the last ${
              value.windowDays
            } days; average of the last ${value.sampleSize} run${
              value.sampleSize === 1 ? '' : 's'
            }`
          : undefined
      }
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
      {body}
    </PanelCard>
  );
}
