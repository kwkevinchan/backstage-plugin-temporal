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

import type { WorkflowTypeOverview } from '../../common';

/** A request of numbers that failed as a whole, for each row it asked for. */
export interface RowFailure {
  failure: { error: Error; at: number };
}

/**
 * The numbers of a row: loading, read (maybe with an error of that row),
 * not readable, or the whole request failed.
 */
export type RowNumbers =
  | WorkflowTypeOverview
  | RowFailure
  | 'loading'
  | 'missing';

export function isOverview(
  n: RowNumbers | undefined,
): n is WorkflowTypeOverview {
  return typeof n === 'object' && 'entityRef' in n;
}

export function isFailure(n: RowNumbers | undefined): n is RowFailure {
  return typeof n === 'object' && 'failure' in n;
}

/** When the numbers of a row were read (ms), if they were. */
export function readAt(n: RowNumbers | undefined): number | undefined {
  if (isOverview(n)) return Date.parse(n.updatedAt);
  if (isFailure(n)) return n.failure.at;
  return undefined;
}
