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
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

  it('shows a retry button after a failure and loads again when it is pressed', async () => {
    const api = mockTemporalApi();
    api.getWorkflowProgress.mockRejectedValueOnce(new Error('boom'));
    api.getWorkflowProgress.mockResolvedValue({
      status: 'Running',
      completedSteps: 2,
      totalSteps: 2,
      truncated: false,
    });
    await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={baseWorkflow} />
      </TestApiProvider>,
    );
    await screen.findByText('—');
    fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
    expect(await screen.findByText('2 steps done')).toBeInTheDocument();
    expect(api.getWorkflowProgress).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('loads again when the refresh token changes and keeps the old text meanwhile', async () => {
    const api = mockTemporalApi();
    api.getWorkflowProgress
      .mockResolvedValueOnce({
        status: 'Running',
        completedSteps: 1,
        totalSteps: 1,
        truncated: false,
      })
      .mockResolvedValueOnce({
        status: 'Running',
        completedSteps: 3,
        totalSteps: 3,
        truncated: false,
      });
    const view = await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={baseWorkflow} refreshToken={0} />
      </TestApiProvider>,
    );
    expect(await screen.findByText('1 step done')).toBeInTheDocument();
    view.rerender(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={baseWorkflow} refreshToken={1} />
      </TestApiProvider>,
    );
    expect(await screen.findByText('3 steps done')).toBeInTheDocument();
    expect(api.getWorkflowProgress).toHaveBeenCalledTimes(2);
  });

  it('shows nothing of the old run when the run changes', async () => {
    const api = mockTemporalApi();
    let release: (value: WorkflowProgressResponse) => void = () => undefined;
    api.getWorkflowProgress
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(
        () =>
          new Promise<WorkflowProgressResponse>(resolve => {
            release = resolve;
          }),
      );
    const view = await renderInTestApp(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={baseWorkflow} />
      </TestApiProvider>,
    );
    await screen.findByText('—');
    view.rerender(
      <TestApiProvider apis={[[temporalApiRef, api]]}>
        <WorkflowProgress workflow={{ ...baseWorkflow, runId: 'run-2' }} />
      </TestApiProvider>,
    );
    // The failure of run-1 is gone while run-2 loads.
    await waitFor(() =>
      expect(api.getWorkflowProgress).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    await act(async () =>
      release({
        status: 'Running',
        completedSteps: 4,
        totalSteps: 4,
        truncated: false,
      }),
    );
    expect(await screen.findByText('4 steps done')).toBeInTheDocument();
  });

  it('drops queued progress requests when a row unmounts before starting', async () => {
    const deferred = new Map<
      string,
      { resolve: (value: WorkflowProgressResponse) => void }
    >();
    const requested: string[] = [];
    const api = {
      getWorkflowProgress: jest.fn((ref: { workflowId: string }) => {
        requested.push(ref.workflowId);
        return new Promise<WorkflowProgressResponse>(resolve => {
          deferred.set(ref.workflowId, { resolve });
        });
      }),
    };

    function QueueList() {
      const [ids, setIds] = useState(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
      return (
        <TestApiProvider apis={[[temporalApiRef, api]]}>
          <button
            type="button"
            onClick={() => setIds(current => current.filter(id => id !== 'w5'))}
          >
            Unmount w5
          </button>
          {ids.map(id => (
            <WorkflowProgress
              key={id}
              workflow={{
                ...baseWorkflow,
                workflowId: id,
                runId: `run-${id}`,
              }}
            />
          ))}
        </TestApiProvider>
      );
    }

    await renderInTestApp(<QueueList />);
    await waitFor(() => expect(requested).toEqual(['w1', 'w2', 'w3', 'w4']));

    // Unmount w5 while queued behind the 4 active requests.
    fireEvent.click(screen.getByRole('button', { name: 'Unmount w5' }));

    // Draining the active batch should run w6 without ever requesting w5.
    await act(async () => {
      for (const id of ['w1', 'w2', 'w3', 'w4']) {
        deferred.get(id)!.resolve({
          status: 'Running',
          completedSteps: 1,
          totalSteps: 1,
          truncated: false,
        });
      }
    });
    await waitFor(() =>
      expect(requested).toEqual(['w1', 'w2', 'w3', 'w4', 'w6']),
    );
    expect(requested).not.toContain('w5');

    // Finish w6 so module-level concurrency state returns to idle.
    await act(async () => {
      deferred.get('w6')!.resolve({
        status: 'Running',
        completedSteps: 6,
        totalSteps: 6,
        truncated: false,
      });
    });
    expect(await screen.findByText('6 steps done')).toBeInTheDocument();
  });
});
