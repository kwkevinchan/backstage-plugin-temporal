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

import { BackstageCredentials } from '@backstage/backend-plugin-api';
import { NotAllowedError, NotFoundError } from '@backstage/errors';
import { temporalWorkflowStartPermission } from '../common';
import type { TemporalAccessService } from '../node/alpha';
import type { ScheduleTarget } from '../repositories/TemporalScheduleRepository';
import { EntityWorkflowSources } from './EntityWorkflowSources';
import { scheduleBelongsToSources } from './visibilityQuery';
import { WorkflowCommands } from './WorkflowCommands';

/**
 * Which schedules a caller may operate (pause, unpause, trigger).
 * Schedules start workflows, so operating one needs
 * `temporal.workflow.start`: on an entity, for the schedules that start its
 * workflows, or without conditions for every schedule of a namespace.
 */
export class ScheduleOwnership {
  constructor(
    private readonly access: TemporalAccessService,
    private readonly sources: EntityWorkflowSources,
    private readonly commands: WorkflowCommands,
  ) {}

  /**
   * The schedule to operate, read from Temporal after every check. With
   * `entityRef`, the caller needs the start permission on the entity, and
   * the schedule must be in the entity's namespace and belong to one of its
   * sources (its own and those of its related entities, the same list as
   * the entity's schedule list; see `scheduleBelongsToSources`): a schedule
   * that does not is not found. Without an entity, the caller needs what a
   * start from the Temporal page needs: to list every workflow, and the
   * start permission for every entity.
   *
   * The permission comes first: the namespace and the schedule are only
   * checked for callers that may start workflows, so neither is told to
   * others.
   */
  async operable(request: {
    namespace: string;
    scheduleId: string;
    entityRef?: string;
    credentials: BackstageCredentials;
  }): Promise<ScheduleTarget> {
    const { namespace, scheduleId, entityRef, credentials } = request;
    let entityNamespace: string | undefined;
    let entitySources:
      | { taskQueue?: string; workflowTypes: string[] }[]
      | undefined;
    if (entityRef) {
      const context = await this.access.loadEntity(
        entityRef,
        temporalWorkflowStartPermission,
        credentials,
      );
      entityNamespace = context.namespace;
      entitySources = this.sources.workflowSourcesOf(context);
    } else {
      // A caller who sees only some workflows cannot operate any schedule
      // of the namespace.
      if (!(await this.access.canListAll(credentials))) {
        throw new NotAllowedError();
      }
      await this.access.authorizeOn(
        temporalWorkflowStartPermission,
        undefined,
        credentials,
      );
    }
    this.sources.checkRequestedNamespace(namespace);
    if (entityNamespace && entityNamespace !== namespace) {
      throw new NotFoundError(
        `Schedule ${scheduleId} does not start a workflow of ${entityRef}`,
      );
    }
    const schedule = await this.commands.describeSchedule(
      namespace,
      scheduleId,
    );
    if (entitySources && !scheduleBelongsToSources(schedule, entitySources)) {
      throw new NotFoundError(
        `Schedule ${scheduleId} does not start a workflow of ${entityRef}`,
      );
    }
    return schedule;
  }
}
