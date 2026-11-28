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

import { kindLabel } from '../steps';
import { statusLabel } from '../status';
import { formatOffset, Span, TimelineRow } from './timeline';

export function duration(span?: Span): string {
  return span ? formatOffset(span.end - span.start) : '';
}

export function retryText(retries: number): string {
  return retries === 1 ? '1 retry' : `${retries} retries`;
}

/** Name of a row: the step, or `Run` for the row of the whole run. */
export function rowName(row: TimelineRow): string {
  if (row.node.kind === 'workflowStarted') return 'Run';
  if (row.node.tool?.name) return row.node.tool.name;
  return row.node.name || kindLabel(row.node.kind);
}

/** Text of a row for screen readers and the bar's label. */
export function rowLabel(row: TimelineRow): string {
  const { node } = row;
  const parts = [rowName(row), statusLabel(node.status)];
  if (row.queued) parts.push(`queued ${duration(row.queued)}`);
  if (row.run && row.shape === 'bar') {
    parts.push(
      `${row.dashed ? 'waited' : 'ran'} ${duration(row.run)}${
        row.open ? ' so far' : ''
      }`,
    );
  }
  if (row.retries) parts.push(retryText(row.retries));
  return parts.join(', ');
}
