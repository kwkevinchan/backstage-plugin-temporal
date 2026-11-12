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

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import type {
  WorkflowHistoryEvent,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '../extensions';
import {
  Button,
  Cell,
  Column,
  Flex,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { formatTime } from './format';
import { ErrorAlert } from './feedback';
import { JsonView } from './PayloadView';

const PAGE_SIZE = 50;

interface HistoryState {
  /** The workflow and entity the state belongs to. */
  key: string;
  events: WorkflowHistoryEvent[];
  nextPageToken?: string;
  loading: boolean;
  error?: Error;
  done: boolean;
}

function emptyState(key: string): HistoryState {
  return { key, events: [], loading: true, done: false };
}

/**
 * Raw event history, loaded one page at a time. It starts again from the
 * first page when the workflow or the entity changes, not when the parent
 * renders with an equal `workflowRef`. A response that is not for the
 * current workflow and the current load is dropped.
 */
export function WorkflowHistory(props: {
  workflowRef: WorkflowRef;
  entityRef?: string;
}) {
  const { namespace, workflowId, runId } = props.workflowRef;
  const { entityRef } = props;
  const temporalApi = useApi(temporalApiRef);
  const key = JSON.stringify([namespace, workflowId, runId, entityRef]);
  const [stored, setStored] = useState<HistoryState>(() => emptyState(key));
  // State of another workflow is not shown while the first page is loading.
  const { events, nextPageToken, loading, error, done } =
    stored.key === key ? stored : emptyState(key);
  // `generation` counts the loads; a response is current only if no load
  // started since.
  const [loads] = useState({ generation: 0, pageInFlight: false });

  const load = useCallback(
    async (pageToken?: string) => {
      if (pageToken && loads.pageInFlight) return;
      const mine = ++loads.generation;
      loads.pageInFlight = true;
      const update = (change: (prev: HistoryState) => HistoryState) =>
        setStored(prev => change(prev.key === key ? prev : emptyState(key)));
      update(prev => ({ ...prev, loading: true, error: undefined }));
      try {
        const page = await temporalApi.getWorkflowHistory(
          { namespace, workflowId, runId },
          { entityRef, pageSize: PAGE_SIZE, pageToken },
        );
        if (mine !== loads.generation) return;
        update(prev => ({
          ...prev,
          events: pageToken ? [...prev.events, ...page.events] : page.events,
          nextPageToken: page.nextPageToken,
          done: !page.nextPageToken,
        }));
      } catch (e) {
        if (mine !== loads.generation) return;
        update(prev => ({ ...prev, error: e as Error }));
      } finally {
        if (mine === loads.generation) {
          loads.pageInFlight = false;
          update(prev => ({ ...prev, loading: false }));
        }
      }
    },
    [temporalApi, loads, namespace, workflowId, runId, entityRef, key],
  );

  useEffect(() => {
    load(undefined);
    return () => {
      // Drops the responses of loads that are still running.
      loads.generation++;
      loads.pageInFlight = false;
    };
  }, [load, loads]);

  if (error && events.length === 0) {
    return <ErrorAlert error={error} />;
  }

  return (
    <div>
      <TableRoot
        aria-label="Event history"
        isPending={loading && events.length === 0}
      >
        <TableHeader>
          <Column isRowHeader>ID</Column>
          <Column>Time</Column>
          <Column>Event</Column>
          <Column>Details</Column>
        </TableHeader>
        <TableBody>
          {events.map(event => (
            <Row key={event.eventId} id={event.eventId}>
              <Cell>
                <Text variant="body-small">{event.eventId}</Text>
              </Cell>
              <Cell>
                <Text variant="body-small" style={{ whiteSpace: 'nowrap' }}>
                  {formatTime(event.eventTime)}
                </Text>
              </Cell>
              <Cell>
                <Text variant="body-small">{event.eventType}</Text>
              </Cell>
              <Cell>
                {event.attributes ? (
                  <JsonView value={event.attributes} />
                ) : null}
              </Cell>
            </Row>
          ))}
        </TableBody>
      </TableRoot>
      {error && <ErrorAlert error={error} />}
      <Flex justify="end" mt="2">
        <Button
          variant="secondary"
          size="small"
          isDisabled={loading || done}
          isPending={loading}
          onPress={() => load(nextPageToken)}
        >
          {done ? 'All events loaded' : 'Load more events'}
        </Button>
      </Flex>
    </div>
  );
}
