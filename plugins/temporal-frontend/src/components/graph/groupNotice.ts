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

import type { WorkflowEventGroup } from '../../common';
import { FRAME_LIMIT, GroupedLayout } from './eventGroups';

/*
 * The lines above the graph when event groups are not drawn as the user
 * or the defaults wanted, with the reason.
 */

const ELSEWHERE = 'The Timeline and the Event Groups tab show every group.';

function names(groups: WorkflowEventGroup[]): string {
  const quoted = groups.map(g => `“${g.name}”`);
  return quoted.length > 2
    ? `${quoted.slice(0, 2).join(', ')} and ${quoted.length - 2} more`
    : quoted.join(' and ');
}

/** Why groups of a laid out graph are labels instead of frames. */
export function layoutNotices(groups: GroupedLayout | undefined): string[] {
  if (!groups) return [];
  if (groups.notice === 'failed') {
    return [
      `The frames of the event groups could not be laid out, so every group is shown as labels on its steps. ${ELSEWHERE}`,
    ];
  }
  const lines: string[] = [];
  if (groups.notice === 'tooLarge') {
    lines.push(
      `The graph is too long to lay out with frames, so expanded groups are shown as labels on their steps. ${ELSEWHERE}`,
    );
  }
  if (groups.tooBig.length > 0) {
    lines.push(
      `${names(groups.tooBig)} ${
        groups.tooBig.length === 1 ? 'holds' : 'hold'
      } more than ${FRAME_LIMIT} boxes, so ${
        groups.tooBig.length === 1 ? 'it is' : 'they are'
      } shown as labels on the steps instead of a frame.`,
    );
  }
  return lines;
}

/** Why a group the user expanded stays collapsed. */
export function refusedNotice(group: WorkflowEventGroup): string {
  return `“${group.name}” could not be expanded: the groups you expanded already hold ${FRAME_LIMIT} boxes. Collapse one of them, or see the steps in the Timeline or the Event Groups tab.`;
}
