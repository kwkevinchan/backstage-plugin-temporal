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

import type { ComponentType } from 'react';
import type { Entity } from '@backstage/catalog-model';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * Props of components shown on the workflow details page.
 *
 * @public
 */
export interface TemporalWorkflowExtensionProps {
  workflow: WorkflowDetail;
  /** The entity the workflow is shown for, if any. */
  entity?: Entity;
  /** Reloads the workflow details. */
  reload(): void;
}

/**
 * A button or other control in the action bar of the workflow details page.
 * Used directly by the legacy frontend system (`workflowActions` prop of
 * `EntityTemporalContent`); the new frontend system uses
 * `TemporalWorkflowActionBlueprint`.
 *
 * @public
 */
export interface TemporalWorkflowActionDef {
  id: string;
  component: ComponentType<TemporalWorkflowExtensionProps>;
  /** Show the action only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}

/**
 * A card on the workflow details page, below the summary.
 * Used directly by the legacy frontend system (`workflowSections` prop of
 * `EntityTemporalContent`); the new frontend system uses
 * `TemporalWorkflowSectionBlueprint`.
 *
 * @public
 */
export interface TemporalWorkflowSectionDef {
  id: string;
  title?: string;
  component: ComponentType<TemporalWorkflowExtensionProps>;
  /** Show the section only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}
