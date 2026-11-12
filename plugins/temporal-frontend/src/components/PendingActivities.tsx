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

import type { PendingActivity } from '../common';
import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { formatTime } from './format';

/** Activities that are scheduled, running or waiting for a retry. */
export function PendingActivities(props: { activities: PendingActivity[] }) {
  return (
    <TableRoot aria-label="Pending activities">
      <TableHeader>
        <Column isRowHeader>Activity ID</Column>
        <Column>Type</Column>
        <Column>State</Column>
        <Column>Attempt</Column>
        <Column>Scheduled</Column>
        <Column>Last failure</Column>
      </TableHeader>
      <TableBody>
        {props.activities.map(a => (
          <Row key={a.activityId} id={a.activityId}>
            <Cell>
              <Text variant="body-small">{a.activityId}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small">{a.activityType}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small">{a.state}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small">
                {a.attempt ?? ''}
                {a.maximumAttempts ? ` / ${a.maximumAttempts}` : ''}
              </Text>
            </Cell>
            <Cell>
              <Text variant="body-small">{formatTime(a.scheduledTime)}</Text>
            </Cell>
            <Cell>
              <Text variant="body-small" style={{ wordBreak: 'break-word' }}>
                {a.lastFailure?.message ?? ''}
              </Text>
            </Cell>
          </Row>
        ))}
      </TableBody>
    </TableRoot>
  );
}
