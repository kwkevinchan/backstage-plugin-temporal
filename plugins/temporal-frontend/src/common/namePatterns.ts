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

// Copy of plugins/temporal-backend/src/common/namePatterns.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

/**
 * Allowed characters for annotation values. Values end up inside a Temporal
 * visibility query, so quotes, backslashes, spaces and brackets are rejected.
 * The same patterns validate the `TemporalWorkflow` spec.
 */
export const NAME_PATTERN_SOURCES = {
  namespace: '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$',
  taskQueue: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$',
  workflowType: '^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,254}$',
} as const;

/**
 * Longest name of a signal, update or query, in `spec.messages` of a
 * `TemporalWorkflow` entity and in a request.
 */
export const MAX_MESSAGE_NAME_LENGTH = 200;

/**
 * `userField` of a message in `spec.messages`: a JavaScript identifier of at
 * most 100 characters.
 */
export const USER_FIELD_PATTERN_SOURCE = '^[A-Za-z_$][A-Za-z0-9_$]{0,99}$';

/** Name of a search attribute in a visibility query or in config. */
export const SEARCH_ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
