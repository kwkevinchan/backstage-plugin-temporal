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

import { useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { temporalWorkflowQueryPermission, WorkflowDetail } from '../../common';
import { temporalApiRef } from '../../extensions';
import {
  MessageDialog,
  PermissionButton,
  refOf,
  useWorkflowHandlers,
} from './MessageDialog';
import { SchemaArgsField } from './SchemaArgsField';

/**
 * "Query…" in the action bar of the details page: runs a query on the
 * workflow and shows its result. Needs `temporal.workflow.query`; the
 * names come from the workflow's handlers when its worker tells them. A
 * query with an input schema (`spec.messages`) gets a form for its
 * argument, any other query a JSON field.
 */
export function QueryButton(props: {
  workflow: WorkflowDetail;
  entityRef?: string;
}) {
  const { workflow, entityRef } = props;
  const api = useApi(temporalApiRef);
  const [open, setOpen] = useState(false);
  const ref = refOf(workflow);
  const handlers = useWorkflowHandlers(ref, entityRef, open);
  return (
    <>
      <PermissionButton
        label="Query…"
        permission={temporalWorkflowQueryPermission}
        resourceRef={entityRef ?? workflow.entityRef}
        onPress={() => setOpen(true)}
      />
      {open && (
        <MessageDialog
          kind="query"
          text={{
            label: 'Query name',
            done: 'Query',
            doneSuffix: ' answered',
            title: 'Query the workflow',
            submit: 'Run query',
            help: 'A query reads the state of the workflow without changing it.',
          }}
          handlers={handlers?.queries ?? []}
          allowsCustomValue
          argsField={SchemaArgsField}
          send={request => api.queryWorkflow(ref, request, { entityRef })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
