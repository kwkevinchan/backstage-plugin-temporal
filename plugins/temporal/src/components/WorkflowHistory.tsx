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
import { Progress, ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import type {
  WorkflowHistoryEvent,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Typography from '@material-ui/core/Typography';
import { formatTime } from './format';

const PAGE_SIZE = 50;

/** Event history, loaded one page at a time. */
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
    return <ResponseErrorPanel error={error} />;
  }

  return (
    <Box>
      <Table size="small" aria-label="Event history">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Time</TableCell>
            <TableCell>Event</TableCell>
            <TableCell>Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map(event => (
            <TableRow key={event.eventId}>
              <TableCell>{event.eventId}</TableCell>
              <TableCell style={{ whiteSpace: 'nowrap' }}>
                {formatTime(event.eventTime)}
              </TableCell>
              <TableCell>{event.eventType}</TableCell>
              <TableCell>
                {event.attributes && (
                  <details>
                    <summary>
                      <Typography variant="caption" component="span">
                        Attributes
                      </Typography>
                    </summary>
                    <pre
                      style={{
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(event.attributes, null, 2)}
                    </pre>
                  </details>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {loading && <Progress />}
      {error && <ResponseErrorPanel error={error} />}
      <Box display="flex" justifyContent="flex-end" mt={1}>
        <Button disabled={loading || done} onClick={() => load(nextPageToken)}>
          {done ? 'All events loaded' : 'Load more events'}
        </Button>
      </Box>
    </Box>
  );
}
