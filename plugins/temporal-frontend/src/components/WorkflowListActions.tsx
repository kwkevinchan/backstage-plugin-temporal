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

import type { Entity } from '@backstage/catalog-model';
import type { WorkflowRef } from '../common';
import type { TemporalWorkflowListActionDef } from '../extensions';
import { tp } from './styles';
import { sharedExtensions, useSharedExtensions } from './useSharedExtensions';

/**
 * The list actions (such as "Start workflow") from the props (legacy
 * frontend system) and from the shared workflow extensions API (new
 * frontend system) that apply to the list of `entity`, or to the Workflows
 * page without one.
 */
export function WorkflowListActions(props: {
  actions?: TemporalWorkflowListActionDef[];
  entity?: Entity;
  workflowHref(ref: WorkflowRef): string;
}) {
  const { entity, workflowHref } = props;
  const actions = useSharedExtensions(
    sharedExtensions.listActions,
    props.actions,
  );
  return (
    <>
      {actions
        .filter(action => !action.filter || action.filter({ entity }))
        .map(({ id, component: Action }) => (
          <div
            key={id}
            className={tp('tp-summary-action')}
            data-testid={`temporal-list-action-${id}`}
          >
            <Action entity={entity} workflowHref={workflowHref} />
          </div>
        ))}
    </>
  );
}
