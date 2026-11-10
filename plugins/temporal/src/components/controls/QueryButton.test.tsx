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

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '../../extensions';
import { failedWorkflow, mockTemporalApi } from '../../testData';
import { QueryButton } from './QueryButton';

// usePermission caches results across tests; this one answers from `denied`.
let denied: string[] = [];
jest.mock('@backstage/plugin-permission-react', () => ({
  usePermission: (input: { permission: { name: string } }) => ({
    loading: false,
    allowed: !denied.includes(input.permission.name),
  }),
}));

const running: WorkflowDetail = { ...failedWorkflow, status: 'Running' };
const ref = {
  namespace: running.namespace,
  workflowId: running.workflowId,
  runId: running.runId,
};
const entityRef = 'component:default/orders';

function render(deny: string[] = []) {
  const api = mockTemporalApi();
  denied = deny;
  renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <QueryButton workflow={running} entityRef={entityRef} />
    </TestApiProvider>,
  );
  return api;
}

describe('QueryButton', () => {
  it('runs a query named by the workflow and shows its result', async () => {
    const api = render();
    api.queryWorkflow.mockResolvedValueOnce({ result: { notes: ['hi'] } });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Query…' }),
    );
    const name = await screen.findByRole('combobox', { name: /Query name/ });
    await waitFor(() => expect(name).toHaveValue('notes'));
    expect(api.getWorkflowHandlers).toHaveBeenCalledWith(ref, { entityRef });
    await userEvent.click(screen.getByRole('button', { name: 'Run query' }));
    expect(
      await screen.findByTestId('workflow-query-result'),
    ).toHaveTextContent('hi');
    expect(api.queryWorkflow).toHaveBeenCalledWith(
      ref,
      { name: 'notes', args: [] },
      { entityRef },
    );
  });

  it('asks for a name when the backend cannot list the handlers', async () => {
    const api = render();
    (api.getWorkflowHandlers as jest.Mock).mockRejectedValueOnce(
      new Error('no worker'),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Query…' }),
    );
    const name = await screen.findByRole('combobox', { name: /Query name/ });
    expect(name).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Run query' })).toBeDisabled();
  });

  it('is disabled without the query permission', async () => {
    render(['temporal.workflow.query']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Query…' })).toBeDisabled(),
    );
    expect(
      screen.getByTitle(/You do not have permission to query/),
    ).toBeInTheDocument();
  });
});
