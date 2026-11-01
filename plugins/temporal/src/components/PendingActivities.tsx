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

import type { PendingActivity } from '@kwkevinchan/backstage-plugin-temporal-common';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import { formatTime } from './format';

/** Activities that are scheduled, running or waiting for a retry. */
export function PendingActivities(props: { activities: PendingActivity[] }) {
  return (
    <Table size="small" aria-label="Pending activities">
      <TableHead>
        <TableRow>
          <TableCell>Activity ID</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>State</TableCell>
          <TableCell>Attempt</TableCell>
          <TableCell>Scheduled</TableCell>
          <TableCell>Last failure</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {props.activities.map(a => (
          <TableRow key={a.activityId}>
            <TableCell>{a.activityId}</TableCell>
            <TableCell>{a.activityType}</TableCell>
            <TableCell>{a.state}</TableCell>
            <TableCell>
              {a.attempt ?? ''}
              {a.maximumAttempts ? ` / ${a.maximumAttempts}` : ''}
            </TableCell>
            <TableCell>{formatTime(a.scheduledTime)}</TableCell>
            <TableCell style={{ wordBreak: 'break-word' }}>
              {a.lastFailure?.message ?? ''}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
