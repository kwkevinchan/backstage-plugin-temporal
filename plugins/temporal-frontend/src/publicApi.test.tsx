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
import {
  TemporalWorkflowProvider,
  useTemporalWorkflow,
} from '@kwkevinchan/backstage-plugin-temporal-frontend';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal-frontend';

// Uses the package by name, as an extension author's tests do.

function WorkflowId() {
  const { workflow } = useTemporalWorkflow();
  return <span>{workflow.workflowId}</span>;
}

const value: TemporalWorkflowExtensionProps = {
  workflow: {
    namespace: 'default',
    workflowId: 'wf-1',
    runId: 'run-1',
    workflowType: 'Example',
    status: 'Running',
    pendingActivities: [],
  },
  reload: () => {},
  workflowHref: () => '/x',
};

describe('useTemporalWorkflow from the public entry point', () => {
  it('returns the value of the TemporalWorkflowProvider around it', () => {
    render(
      <TemporalWorkflowProvider value={value}>
        <WorkflowId />
      </TemporalWorkflowProvider>,
    );
    expect(screen.getByText('wf-1')).toBeInTheDocument();
  });

  it('throws without the provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<WorkflowId />)).toThrow(
      'useTemporalWorkflow must be used inside the Temporal workflow details page',
    );
  });
});
