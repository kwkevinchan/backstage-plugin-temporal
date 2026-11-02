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
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
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
 * A button on the workflow details page that runs a custom action of the
 * backend (`POST .../actions/:actionId`, added with
 * `temporalExtensionPoint.addControlAction()`). The page shows the result or
 * the error and reloads the workflow.
 *
 * @public
 */
export interface TemporalControlActionButton {
  /** ID of the backend action. */
  actionId: string;
  /** Button label. */
  label: string;
  /** When set, the page asks for confirmation with this text first. */
  confirm?: string;
  /** The JSON body sent to the action. Defaults to no body. */
  body?: (workflow: WorkflowDetail) => JsonValue | undefined;
  /**
   * The permission of the backend action. When set, the button is disabled
   * for users who do not have it on the workflow's entity.
   */
  permission?: ResourcePermission<'catalog-entity'>;
}

/**
 * Makes a {@link TemporalWorkflowActionDef} with a button that runs a custom
 * action of the backend, for the legacy frontend system.
 *
 * @public
 */
export function createTemporalControlActionDef(
  options: TemporalControlActionButton & {
    /** Defaults to the action ID. */
    id?: string;
    filter?: (workflow: WorkflowDetail) => boolean;
  },
): TemporalWorkflowActionDef {
  const { id, filter, ...controlAction } = options;
  return { id: id ?? controlAction.actionId, controlAction, filter };
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
  /** The control to show. Without it, `controlAction` is shown as a button. */
  component?: ComponentType<TemporalWorkflowExtensionProps>;
  /** A button that runs a custom action of the backend. */
  controlAction?: TemporalControlActionButton;
  /** Show the action only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}

/**
 * A tab on the workflow details page, next to Steps, Events and Details.
 * Used directly by the legacy frontend system (`workflowSections` prop of
 * `EntityTemporalContent`); the new frontend system uses
 * `TemporalWorkflowSectionBlueprint`.
 *
 * @public
 */
export interface TemporalWorkflowSectionDef {
  id: string;
  /** Tab label; defaults to the extension ID. */
  title?: string;
  component: ComponentType<TemporalWorkflowExtensionProps>;
  /** Show the section only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}

/**
 * Workflow actions and sections contributed by other plugins in the new
 * frontend system. The entity tab and the Workflows page both read it, so
 * blueprint extensions show on every workflow details page.
 *
 * @public
 */
export interface TemporalWorkflowExtensionsApi {
  getActions(): TemporalWorkflowActionDef[];
  getSections(): TemporalWorkflowSectionDef[];
}
