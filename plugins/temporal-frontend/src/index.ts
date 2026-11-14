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
 * workflow hook with its provider for tests, and the props of actions, list actions and sections) and
 * the conditions for entity pages. The permissions, annotations and response
 * types of the backend API are in `./common`.
 *
 * @packageDocumentation
 */

export {
  temporalPlugin,
  EntityTemporalContent,
  TemporalPage,
  EntityTemporalWorkflowSummaryCard,
  EntityTemporalRelatedWorkflowsCard,
} from './plugin';
export type {
  EntityTemporalContentProps,
  TemporalPageProps,
} from './components';
export { TemporalClient } from './api';
export { createTemporalControlActionDef } from './control';
export type { TemporalControlActionButtonOptions } from './control';
export {
  temporalApiRef,
  useTemporalWorkflow,
  TemporalWorkflowProvider,
} from './extensions';
export type {
  TemporalWorkflowProviderProps,
  TemporalApi,
  TemporalWorkflowExtensionProps,
  TemporalWorkflowActionDef,
  TemporalWorkflowListActionProps,
  TemporalWorkflowListActionDef,
  TemporalScheduleActionProps,
  TemporalScheduleActionDef,
  TemporalWorkflowSectionDef,
} from './extensions';
// Conditions for the EntitySwitch of a legacy entity page; the rest of the
// shared definitions is imported from `./common`.
export {
  getDependsOnTemporalWorkflowRefs,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
} from './common';
