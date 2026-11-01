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
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
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

/** Raw event history, loaded one page at a time. */
export function WorkflowHistory(props: {
  workflowRef: WorkflowRef;
  entityRef?: string;
}) {
  const { workflowRef, entityRef } = props;
  const temporalApi = useApi(temporalApiRef);
  const [events, setEvents] = useState<WorkflowHistoryEvent[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [done, setDone] = useState(false);

  const load = useCallback(
    async (pageToken?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await temporalApi.getWorkflowHistory(workflowRef, {
          entityRef,
          pageSize: PAGE_SIZE,
          pageToken,
        });
        setEvents(prev =>
          pageToken ? [...prev, ...page.events] : page.events,
        );
        setNextPageToken(page.nextPageToken);
        setDone(!page.nextPageToken);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    },
    [temporalApi, workflowRef, entityRef],
  );

  useEffect(() => {
    load(undefined);
  }, [load]);

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
