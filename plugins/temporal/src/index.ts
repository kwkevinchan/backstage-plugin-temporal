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
 * Unofficial Backstage frontend plugin for Temporal workflows (legacy
 * frontend system). The new frontend system uses the `./alpha` entry point.
 *
 * @packageDocumentation
 */

export {
  temporalPlugin,
  EntityTemporalContent,
  TemporalPage,
  EntityTemporalWorkflowSummaryCard,
  EntityTemporalWorkflowStatsCard,
  EntityTemporalRelatedWorkflowsCard,
} from './plugin';
export type {
  EntityTemporalContentProps,
  TemporalPageProps,
  TemporalWorkflowStatsCardProps,
} from './components';
export { TemporalClient } from './api';
export {
  getDependsOnTemporalWorkflowRefs,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
  TEMPORAL_WORKFLOW_API_VERSION,
  TEMPORAL_WORKFLOW_KIND,
  TEMPORAL_NAMESPACE_ANNOTATION,
  TEMPORAL_TASK_QUEUE_ANNOTATION,
  TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
} from '@kwkevinchan/backstage-plugin-temporal-common';
