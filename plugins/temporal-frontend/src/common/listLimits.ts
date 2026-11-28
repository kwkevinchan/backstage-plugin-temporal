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

// Copy of plugins/temporal-backend/src/common/listLimits.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

/*
 * Limits of the lists that the backend applies and the frontend's lists and
 * their texts follow. Not exported from the package: the frontend has a copy
 * of this folder.
 */

/** Default and largest page size of a list of runs. */
export const LIST_PAGE_SIZE = { default: 20, max: 100 } as const;

/** Most schedules a list reads. */
export const MAX_SCHEDULES = 500;

/** Days that the completed and failed counts of the overview cover. */
export const OVERVIEW_WINDOW_DAYS = 7;

/** How long the overview numbers of one entity are kept, in milliseconds. */
export const OVERVIEW_CACHE_TTL_MS = 60_000;
