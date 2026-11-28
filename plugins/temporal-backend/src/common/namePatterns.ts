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
