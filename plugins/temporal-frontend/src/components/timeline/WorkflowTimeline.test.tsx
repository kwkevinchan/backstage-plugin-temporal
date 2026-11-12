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
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowGraphResponse } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  loopGraphResponse,
  timelineNodes,
  TIMELINE_T0 as T0,
} from '../../testData';
import { WorkflowTimeline } from './WorkflowTimeline';

const graph: WorkflowGraphResponse = {
  status: 'Running',
  nodes: timelineNodes,
  edges: [],
  completedSteps: 3,
  totalSteps: 5,
  truncated: false,
  payloadsHidden: false,
};
const workflow = {
  runId: 'run-1',
  status: 'Running' as const,
  startTime: new Date(T0).toISOString(),
};
const now = T0 + 40_000;

function Harness(props: { graph?: WorkflowGraphResponse; now?: number }) {
  const [selected, setSelected] = useState<string | undefined>();
  return (
    <>
      <WorkflowTimeline
        graph={props.graph ?? graph}
        workflow={workflow}
        now={props.now ?? now}
        selectedId={selected}
        onSelect={setSelected}
      />
      <span data-testid="selected">{selected ?? 'none'}</span>
    </>
  );
}

/** The time axis is 1000px wide, from x = 300. */
function mockAxis() {
  const axis = screen.getByTestId('timeline-axis');
  axis.getBoundingClientRect = () =>
    ({
      left: 300,
      right: 1300,
      width: 1000,
      top: 0,
      bottom: 28,
      height: 28,
      x: 300,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
}

describe('WorkflowTimeline', () => {
  it('draws one bar per step with queued and running parts', () => {
    render(<Harness />);
    const chart = screen.getByRole('group', { name: 'Workflow timeline' });
    expect(
      within(chart).getByRole('button', {
        name: 'reserveStock, Completed, queued 1s, ran 2s',
      }),
    ).toBeInTheDocument();
    expect(
      within(chart).getByRole('button', {
        name: 'chargeCard, Failed, queued 10s, ran 5s, 2 retries',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('timeline-retries-activity-9')).toHaveTextContent(
      '2 retries',
    );
    // Timers are dashed, signals are points, open steps end at now.
    expect(screen.getByTestId('timeline-bar-timer-12')).toHaveAttribute(
      'data-dashed',
      'true',
    );
    expect(screen.getByTestId('timeline-bar-signal-14')).toHaveAttribute(
      'data-shape',
      'point',
    );
    expect(screen.getByTestId('timeline-bar-activity-16')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(
      screen.getByRole('button', {
        name: /^ship, Running, queued 2s, ran 6s so far/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('timeline-now')).toBeInTheDocument();
    // The failed step is red.
    expect(screen.getByTestId('timeline-bar-activity-9')).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  it('grows open bars as the time passes', () => {
    const { rerender } = render(<Harness />);
    const width = () =>
      parseFloat(screen.getByTestId('timeline-bar-activity-9').style.width);
    const before = width();
    rerender(<Harness now={now + 40_000} />);
    // The range is twice as long, so a closed bar is half as wide.
    expect(width()).toBeCloseTo(before / 2, 1);
    expect(
      screen.getByRole('button', {
        name: /^ship, Running, queued 2s, ran 46s/,
      }),
    ).toBeInTheDocument();
  });

  it('selects a step on click and shows details on hover', () => {
    render(<Harness />);
    const bar = screen.getByTestId('timeline-bar-activity-9');
    fireEvent.click(bar);
    expect(screen.getByTestId('selected')).toHaveTextContent('activity-9');
    expect(bar).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(bar);
    expect(screen.getByTestId('selected')).toHaveTextContent('none');

    fireEvent.mouseEnter(bar, { clientX: 500, clientY: 100 });
    const tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip).toHaveTextContent('chargeCard');
    expect(tooltip).toHaveTextContent('Attempt3 of 3 (2 retries)');
    expect(tooltip).toHaveTextContent('Queued10s');
    fireEvent.mouseLeave(bar);
    expect(screen.queryByTestId('timeline-tooltip')).not.toBeInTheDocument();
  });

  it('zooms with the buttons and back to the whole run', () => {
    render(<Harness />);
    const chart = screen.getByRole('group', { name: 'Workflow timeline' });
    const wholeRun = screen.getByRole('button', { name: 'Whole run' });
    expect(wholeRun).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    // The middle half of the 40 seconds.
    expect(chart).toHaveTextContent('10s – 30s');
    expect(screen.queryByTestId('timeline-bar-activity-5')).toBeNull();
    expect(wholeRun).toBeEnabled();
    fireEvent.click(wholeRun);
    expect(chart).not.toHaveTextContent('10s – 30s');
    expect(screen.getByTestId('timeline-bar-activity-5')).toBeInTheDocument();
  });

  it('zooms to a range dragged across the chart', () => {
    render(<Harness />);
    mockAxis();
    const chart = screen.getByRole('group', { name: 'Workflow timeline' });
    // From 25% to 50% of 40 seconds: 10s to 20s.
    fireEvent.pointerDown(chart, { clientX: 550, button: 0, pointerId: 1 });
    fireEvent.pointerMove(chart, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(chart, { clientX: 800, pointerId: 1 });
    fireEvent.pointerUp(chart, { clientX: 800, pointerId: 1 });
    // chargeCard (5s to 20s) fills the window from 10s.
    const bar = screen.getByTestId('timeline-bar-activity-9');
    expect(parseFloat(bar.style.left)).toBeCloseTo(0, 5);
    expect(parseFloat(bar.style.width)).toBeCloseTo(100, 5);
    // Steps outside the window have no bar.
    expect(screen.queryByTestId('timeline-bar-activity-5')).toBeNull();
    expect(screen.getByRole('button', { name: 'Whole run' })).toBeEnabled();
  });

  it('zooms with Ctrl and the scroll wheel around the pointer', () => {
    render(<Harness />);
    mockAxis();
    const chart = screen.getByRole('group', { name: 'Workflow timeline' });
    const width = () =>
      parseFloat(screen.getByTestId('timeline-bar-activity-9').style.width);
    const before = width();
    fireEvent.wheel(chart, { clientX: 800, deltaY: -100, ctrlKey: true });
    expect(width()).toBeCloseTo(before / 0.8, 1);
    // Without Ctrl the page scrolls.
    fireEvent.wheel(chart, { clientX: 800, deltaY: -100 });
    expect(width()).toBeCloseTo(before / 0.8, 1);
  });

  it('groups loop rounds, the latest round open', () => {
    const loopGraph = { ...loopGraphResponse, status: 'Completed' as const };
    render(
      <WorkflowTimeline
        graph={loopGraph}
        workflow={{
          status: 'Completed',
          startTime: new Date(Date.UTC(2026, 0, 1, 11, 0, 0)).toISOString(),
          closeTime: new Date(Date.UTC(2026, 0, 1, 11, 0, 10)).toISOString(),
        }}
        onSelect={() => {}}
      />,
    );
    const round1 = screen.getByTestId('timeline-round-draft-review/1');
    const toggle1 = within(round1).getByRole('button', {
      name: /draft-review · Round 1 of 5/,
    });
    expect(toggle1).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('timeline-bar-activity-5')).toBeNull();
    expect(screen.getByTestId('timeline-bar-activity-12')).toBeInTheDocument();
    fireEvent.click(toggle1);
    expect(toggle1).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('timeline-bar-activity-5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse rounds' }));
    expect(screen.queryByTestId('timeline-bar-activity-12')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand rounds' }));
    expect(screen.getByTestId('timeline-bar-activity-5')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bar-activity-12')).toBeInTheDocument();
  });
});
