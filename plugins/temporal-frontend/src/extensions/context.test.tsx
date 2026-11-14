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

import { render, screen } from '@testing-library/react';
import { TemporalWorkflowProvider, useTemporalWorkflow } from './context';

function Probe() {
  const { workflow } = useTemporalWorkflow();
  return <span>{workflow.workflowId}</span>;
}

describe('useTemporalWorkflow', () => {
  it('reads the workflow from the provider', () => {
    render(
      <TemporalWorkflowProvider
        value={{
          workflow: {
            namespace: 'default',
            workflowId: 'wf-1',
            runId: 'r',
            workflowType: 't',
            status: 'Running',
            pendingActivities: [],
          },
          reload: () => {},
          workflowHref: () => '/x',
        }}
      >
        <Probe />
      </TemporalWorkflowProvider>,
    );
    expect(screen.getByText('wf-1')).toBeInTheDocument();
  });

  it('throws outside the details page', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be used inside/);
  });
});
