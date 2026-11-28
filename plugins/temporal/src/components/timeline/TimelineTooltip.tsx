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

import type { ReactNode } from 'react';
import { formatTime } from '../format';
import { kindLabel } from '../steps';
import { statusLabel } from '../status';
import { tp } from '../styles';
import type { TimelineRow } from './timeline';
import { duration, retryText, rowName } from './timelineText';

/** The details of the bar under the pointer, or of the bar with the focus. */
export function TimelineTooltip(props: {
  row: TimelineRow;
  x: number;
  y: number;
  above: boolean;
}) {
  const { row } = props;
  const { node } = row;
  const items: [string, ReactNode][] = [
    ['Status', statusLabel(node.status)],
    ['Waiting for', node.waitingFor],
    [
      'Scheduled',
      row.queued
        ? formatTime(new Date(row.queued.start).toISOString())
        : undefined,
    ],
    [
      row.shape === 'point' ? 'At' : 'Started',
      formatTime(
        new Date(row.at ?? row.run?.start ?? row.span.start).toISOString(),
      ),
    ],
    [
      'Ended',
      row.shape === 'bar' && !row.open
        ? formatTime(new Date(row.span.end).toISOString())
        : undefined,
    ],
    ['Queued', row.queued ? duration(row.queued) : undefined],
    [
      row.dashed ? 'Waited' : 'Ran',
      row.shape === 'bar' && row.run
        ? `${duration(row.run)}${row.open ? ' so far' : ''}`
        : undefined,
    ],
    [
      'Attempt',
      node.attempt
        ? `${node.attempt}${
            node.maximumAttempts ? ` of ${node.maximumAttempts}` : ''
          }${row.retries ? ` (${retryText(row.retries)})` : ''}`
        : undefined,
    ],
    ['Error', node.failure?.message],
  ];
  return (
    <div
      className={tp('tp-tl-tooltip')}
      style={
        props.above
          ? { left: props.x, bottom: props.y }
          : { left: props.x, top: props.y }
      }
      role="tooltip"
      data-testid="timeline-tooltip"
    >
      <div className={tp('tp-tl-tooltip-title')}>{rowName(row)}</div>
      <div className={tp('tp-muted')}>{kindLabel(node.kind)}</div>
      <dl className={tp('tp-dl')}>
        {items
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
