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

import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import type { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { Select, Text } from '@backstage/ui';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-frontend';
import type {
  WorkflowStatus,
  WorkflowSummary,
} from '@kwkevinchan/backstage-plugin-temporal-frontend/common';

/**
 * Options of the `TemporalWorkflowPicker` field (`ui:options`). Without
 * `entityRef`, the workflows of the namespace are listed, which needs the
 * `temporal.workflow.list` permission.
 *
 * @public
 */
export type TemporalWorkflowPickerUiOptions = {
  /** The workflows of this entity, by the same rules as its Temporal tab. */
  entityRef?: string;
  /** Without an entity: the workflow type. */
  workflowType?: string;
  /** Without an entity: the namespace; the backend default when left out. */
  namespace?: string;
  /** The status to list; `Running` by default, `any` for every status. */
  status?: WorkflowStatus | 'any';
  /** Only workflows whose Bool search attribute is true, e.g. `ApprovalPending`. */
  searchAttribute?: string;
};

/** How many workflows the field offers, newest first. */
export const PICKER_PAGE_SIZE = 50;

function optionLabel(workflow: WorkflowSummary): string {
  const started = workflow.startTime
    ? new Date(workflow.startTime).toLocaleString()
    : undefined;
  return [workflow.workflowId, workflow.workflowType, started]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Scaffolder form field: picks a workflow, listed with the permissions of
 * the user filling in the form. Its value is the workflow ID, for
 * `temporal:workflow:signal` and `temporal:workflow:wait`.
 */
export function TemporalWorkflowPicker(
  props: FieldExtensionComponentProps<string, TemporalWorkflowPickerUiOptions>,
) {
  const { formData, onChange, schema, uiSchema, required, rawErrors } = props;
  const options = uiSchema['ui:options'] ?? {};
  const { entityRef, workflowType, namespace, searchAttribute } = options;
  const status =
    options.status === 'any' ? undefined : options.status ?? 'Running';
  const api = useApi(temporalApiRef);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    let current = true;
    setWorkflows(undefined);
    setError(undefined);
    const request = entityRef
      ? api.listEntityWorkflows(entityRef, {
          status,
          searchAttribute,
          pageSize: PICKER_PAGE_SIZE,
        })
      : api.listWorkflows({
          namespace,
          workflowType,
          status,
          searchAttribute,
          pageSize: PICKER_PAGE_SIZE,
        });
    request
      .then(response => current && setWorkflows(response.items))
      .catch(e => current && setError(e));
    return () => {
      current = false;
    };
  }, [api, entityRef, workflowType, namespace, status, searchAttribute]);

  // A value that is no longer offered (it closed, or the options changed)
  // is cleared, so the form does not send a workflow the user cannot see.
  useEffect(() => {
    if (
      workflows &&
      formData &&
      !workflows.some(w => w.workflowId === formData)
    ) {
      onChange(undefined);
    }
  }, [workflows, formData, onChange]);

  const label = schema.title ?? 'Workflow';
  let help = schema.description;
  if (error) help = `The workflows could not be listed: ${error.message}`;
  else if (workflows?.length === 0) help = 'No workflow matches.';
  return (
    <div data-testid="temporal-workflow-picker">
      <Select
        label={label}
        isRequired={required}
        isDisabled={!workflows || workflows.length === 0}
        placeholder={workflows ? 'Choose a workflow' : 'Loading workflows…'}
        options={(workflows ?? []).map(w => ({
          id: w.workflowId,
          label: optionLabel(w),
        }))}
        selectedKey={formData ?? null}
        onSelectionChange={key => onChange(key ? String(key) : undefined)}
        description={help}
      />
      {rawErrors?.map(message => (
        <Text key={message} as="p" variant="body-x-small" color="danger">
          {message}
        </Text>
      ))}
    </div>
  );
}
