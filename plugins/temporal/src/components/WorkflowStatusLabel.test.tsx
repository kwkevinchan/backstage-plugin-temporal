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

import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';

describe('WorkflowStatusLabel', () => {
  it('shows a turning spinner for running workflows', async () => {
    await renderInTestApp(<WorkflowStatusLabel status="Running" />);
    expect(screen.getByTestId('workflow-status-running')).toHaveTextContent(
      'Running',
    );
    const spinner = screen.getByTestId('workflow-status-running-spinner');
    // The spinner class carries the turning animation.
    expect(spinner).toHaveClass('tp-spinner');
  });

  it('uses the status icons for other statuses', async () => {
    await renderInTestApp(<WorkflowStatusLabel status="Completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Completed').parentElement).toHaveClass(
      'tp-tone-success',
    );
    expect(
      screen.queryByTestId('workflow-status-running'),
    ).not.toBeInTheDocument();
  });
});
