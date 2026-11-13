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
import type { TemporalSchedule, WorkflowDetail, WorkflowRef } from '../common';

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
  /**
   * Link of the details page of another workflow on the same page (entity
   * tab or Workflows page), for example a run that was just started.
   * Optional, as hosts that render these components themselves may not have
   * one.
   */
  workflowHref?(ref: WorkflowRef): string;
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
  /** The control to show. */
  component: ComponentType<TemporalWorkflowExtensionProps>;
  /** Show the action only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}

/**
 * Props of components shown above a workflow list: the list of an entity
 * (with `entity`) or the Workflows page (without).
 *
 * @public
 */
export interface TemporalWorkflowListActionProps {
  /** The entity whose workflows are listed; absent on the Workflows page. */
  entity?: Entity;
  /** Link of the details page of a workflow, relative to the list. */
  workflowHref(ref: WorkflowRef): string;
}

/**
 * A button or other control above a workflow list, such as "Start
 * workflow". Used directly by the legacy frontend system
 * (`workflowListActions` prop of `EntityTemporalContent` and
 * `TemporalPage`); the new frontend system uses
 * `TemporalWorkflowListActionBlueprint`.
 *
 * @public
 */
export interface TemporalWorkflowListActionDef {
  id: string;
  component: ComponentType<TemporalWorkflowListActionProps>;
  /**
   * Show the action only when this returns true. `entity` is absent on the
   * Workflows page.
   */
  filter?: (context: { entity?: Entity }) => boolean;
}

/**
 * Props of components shown on a row of a schedule list.
 *
 * @public
 */
export interface TemporalScheduleActionProps {
  schedule: TemporalSchedule;
  /** The entity whose schedules are listed; absent on the Workflows page. */
  entity?: Entity;
  /** Reads the schedules again, after a change. */
  reload(): void;
}

/**
 * A button or other control on each schedule, such as "Pause". Used
 * directly by the legacy frontend system (`scheduleActions` prop of
 * `EntityTemporalContent` and `TemporalPage`); the new frontend system uses
 * `TemporalScheduleActionBlueprint`.
 *
 * @public
 */
export interface TemporalScheduleActionDef {
  id: string;
  component: ComponentType<TemporalScheduleActionProps>;
  /** Show the action only when this returns true. */
  filter?: (schedule: TemporalSchedule) => boolean;
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
  /** Tab label. */
  title: string;
  component: ComponentType<TemporalWorkflowExtensionProps>;
  /** Show the section only when this returns true. */
  filter?: (workflow: WorkflowDetail) => boolean;
}

/**
 * Workflow actions, list actions and sections contributed by other plugins
 * in the new frontend system. The entity tab and the Workflows page both
 * read it, so blueprint extensions show on every page.
 *
 * @public
 */
export interface TemporalWorkflowExtensionsApi {
  getActions(): TemporalWorkflowActionDef[];
  getSections(): TemporalWorkflowSectionDef[];
  getListActions(): TemporalWorkflowListActionDef[];
  getScheduleActions(): TemporalScheduleActionDef[];
}
