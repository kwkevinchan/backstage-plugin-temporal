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
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import type { WorkflowProgressResponse, WorkflowSummary } from '../common';
import { temporalApiRef } from '../extensions';
import { mockTemporalApi } from '../testData';
import {
  progressText,
  stepsDoneText,
  WorkflowProgress,
} from './WorkflowProgress';

const NOW_MS = Date.UTC(2026, 0, 1, 10, 0, 0);

const baseWorkflow: WorkflowSummary = {
  namespace: 'default',
  workflowId: 'order-1',
  runId: 'run-1',
  workflowType: 'orderWorkflow',
  status: 'Running',
  startTime: '2026-01-01T10:00:00.000Z',
};

async function renderProgress(progress: WorkflowProgressResponse) {
  const api = mockTemporalApi();
  api.getWorkflowProgress.mockResolvedValue(progress);
  await renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <WorkflowProgress
        workflow={{ ...baseWorkflow, status: progress.status }}
      />
    </TestApiProvider>,
  );
  return api;
}

describe('WorkflowProgress', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats completed steps without implying a known total', () => {
    expect(stepsDoneText(0)).toBe('0 steps done');
    expect(stepsDoneText(1)).toBe('1 step done');
    expect(stepsDoneText(3)).toBe('3 steps done');
  });

  it('renders running workflows without a proportional progress bar or total', async () => {
    await renderProgress({
      status: 'Running',
      completedSteps: 3,
      totalSteps: 4,
      current: 'charge',
      truncated: false,
    });

    const text = await screen.findByText('3 steps done · charge');
    expect(text).toBeInTheDocument();
    expect(text.textContent).not.toMatch(/\d+\/\d+|\bof\b/i);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-progress-truncated'),
    ).not.toBeInTheDocument();
  });

  it('uses singular step text and keeps deadlines for running workflows', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    await renderProgress({
      status: 'Running',
      completedSteps: 1,
      totalSteps: 2,
      current: 'waitForUpstream: Retrying…',
      truncated: false,
    });
    expect(
      await screen.findByText('1 step done · waitForUpstream: Retrying…'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    expect(
      progressText({
        status: 'Running',
        completedSteps: 0,
        totalSteps: 1,
        current: 'Waiting for approval',
        currentDeadline: {
          time: '2026-01-02T09:58:00.000Z',
          kind: 'timeout',
        },
        truncated: false,
      }),
    ).toBe('0 steps done · Waiting for approval · times out in 23h 58m');

    expect(
      progressText({
        status: 'Running',
        completedSteps: 0,
        totalSteps: 0,
        truncated: false,
      }),
    ).toBe('0 steps done');
  });

  it('keeps the X/Y label and proportional progressbar for closed workflows', async () => {
    await renderProgress({
      status: 'Failed',
      completedSteps: 1,
      totalSteps: 2,
      current: 'Failed at chargeCard',
      truncated: false,
    });

    expect(
      await screen.findByText('1/2 steps · Failed at chargeCard'),
    ).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Steps done' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '2');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar.firstElementChild).toHaveStyle({ width: '50%' });
    expect(
      screen.queryByTestId('workflow-progress-truncated'),
    ).not.toBeInTheDocument();
  });

  it('handles zero-step and completed closed workflows', async () => {
    const api = mockTemporalApi();
    api.getWorkflowProgress
      .mockResolvedValueOnce({
        status: 'Completed',
        completedSteps: 5,
        totalSteps: 5,
        truncated: false,
      })
      .mockResolvedValueOnce({
        status: 'Completed',
        completedSteps: 0,
        totalSteps: 0,
        truncated: false,
      })
      .mockResolvedValueOnce({
        status: 'Canceled',
        completedSteps: 0,
        totalSteps: 0,
        truncated: false,
      });

    const { unmount } = await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={{ ...baseWorkflow, status: 'Completed' }} />
      </TestApiProvider>,
    );
    expect(await screen.findByText('5/5 steps')).toBeInTheDocument();
    let bar = screen.getByRole('progressbar', { name: 'Steps done' });
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuenow', '5');
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
    unmount();

    const completedEmpty = await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress
          workflow={{ ...baseWorkflow, status: 'Completed', runId: 'run-2' }}
        />
      </TestApiProvider>,
    );
    expect(await screen.findByText('No steps')).toBeInTheDocument();
    bar = screen.getByRole('progressbar', { name: 'Steps done' });
    expect(bar).toHaveAttribute('aria-valuemax', '0');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
    completedEmpty.unmount();

    await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress
          workflow={{ ...baseWorkflow, status: 'Canceled', runId: 'run-3' }}
        />
      </TestApiProvider>,
    );
    expect(await screen.findByText('No steps')).toBeInTheDocument();
    bar = screen.getByRole('progressbar', { name: 'Steps done' });
    expect(bar.firstElementChild).toHaveStyle({ width: '0%' });
  });

  it('marks truncated history on running workflows without adding a progressbar', async () => {
    await renderProgress({
      status: 'Running',
      completedSteps: 120,
      totalSteps: 121,
      current: 'charge',
      truncated: true,
    });

    expect(
      await screen.findByText('120 steps done · charge'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByTestId('workflow-progress')).not.toHaveTextContent(
      /120\/121/,
    );
    const notice = screen.getByTestId('workflow-progress-truncated');
    expect(notice).toHaveTextContent('Partial count · first events only');
    expect(notice).toHaveAttribute(
      'title',
      'The history is long; only its first events were read, so the step count is incomplete.',
    );
  });

  it('marks truncated history on closed workflows while keeping the progressbar', async () => {
    await renderProgress({
      status: 'Completed',
      completedSteps: 120,
      totalSteps: 120,
      truncated: true,
    });

    expect(await screen.findByText('120/120 steps')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Steps done' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '120');
    expect(bar).toHaveAttribute('aria-valuenow', '120');
    const notice = screen.getByTestId('workflow-progress-truncated');
    expect(notice).toHaveTextContent('Partial count · first events only');
    expect(notice).toHaveAttribute(
      'title',
      'The history is long; only its first events were read, so the step count is incomplete.',
    );
  });

  it('renders a dash when progress fails to load', async () => {
    const api = mockTemporalApi();
    api.getWorkflowProgress.mockRejectedValue(new Error('boom'));
    await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={baseWorkflow} />
      </TestApiProvider>,
    );
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
