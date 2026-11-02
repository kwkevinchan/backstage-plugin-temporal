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
 * frontend system). The new frontend system uses the `./alpha` entry point,
 * which also has the blueprints for workflow actions and sections.
 *
 * The package also exports the frontend extension points (the API ref, the
 * workflow context and the props of actions and sections), the permissions
 * (the same objects as in `@kwkevinchan/backstage-plugin-temporal-backend`)
 * and the response types of the backend API.
 *
 * @packageDocumentation
 */

export {
  temporalPlugin,
  EntityTemporalContent,
  EntityTemporalDefinitionContent,
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
export * from './extensions';
export * from './common/permissions';
export {
  getDependsOnTemporalWorkflowRefs,
  getTemporalWorkflowDefinitionSpec,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
  TEMPORAL_WORKFLOW_API_VERSION,
  TEMPORAL_WORKFLOW_KIND,
  TEMPORAL_NAMESPACE_ANNOTATION,
  TEMPORAL_TASK_QUEUE_ANNOTATION,
  TEMPORAL_WORKFLOW_TYPE_ANNOTATION,
  TEMPORAL_DEFINITION_FORMATS,
  WORKFLOW_STATUSES,
} from './common';
export type {
  ActivityStep,
  DecodedPayload,
  ExternalPayload,
  PendingActivity,
  TemporalDefinitionFormat,
  TemporalWorkflowDefinitionSpec,
  TemporalWorkflowEntityV1alpha1,
  WorkflowDefinitionError,
  WorkflowDefinitionResponse,
  WorkflowDefinitionTask,
  WorkflowControlOperation,
  WorkflowDeadline,
  WorkflowDetail,
  WorkflowFailure,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowHistoryEvent,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowLoopGroup,
  WorkflowLoopMarker,
  WorkflowLoopRound,
  WorkflowLoopRun,
  WorkflowLoopStatus,
  WorkflowLoopStep,
  WorkflowLoopsResponse,
  WorkflowMessageRequest,
  WorkflowMessageResponse,
  WorkflowNodeAttempt,
  WorkflowNodeEvent,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowProgressResponse,
  WorkflowRef,
  WorkflowRerunRequest,
  WorkflowRunChain,
  WorkflowStartRequest,
  WorkflowStartResponse,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowStepsResponse,
  WorkflowSummary,
  WorkflowTerminateRequest,
} from './common';
