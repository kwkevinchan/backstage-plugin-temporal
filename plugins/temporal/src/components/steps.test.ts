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

import type { WorkflowGraphNode } from '../common';
import { deadlineText, formatTime } from './format';
import { isMarkerStep, stepBoxText, stepSubtitle } from './steps';

const now = Date.parse('2026-01-01T00:20:00Z');
const timer = (extra: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode => ({
  id: 'timer-5',
  kind: 'timer',
  name: 'Timer 24h',
  status: 'Waiting',
  events: [],
  deadline: { time: '2026-01-02T00:00:00Z', kind: 'fires' },
  ...extra,
});

describe('deadlineText', () => {
  it('says how long until a timer fires or a wait times out', () => {
    const time = '2026-01-02T00:00:00Z';
    expect(deadlineText({ time, kind: 'fires' }, now)).toBe('fires in 23h 40m');
    expect(deadlineText({ time, kind: 'timeout' }, now)).toBe(
      'times out in 23h 40m',
    );
    expect(
      deadlineText({ time: '2026-01-01T00:20:45Z', kind: 'fires' }, now),
    ).toBe('fires in 45s');
    expect(
      deadlineText({ time: '2026-01-01T00:00:00Z', kind: 'timeout' }, now),
    ).toBe('times out now');
    expect(deadlineText({ time: 'soon', kind: 'fires' }, now)).toBe('');
  });

  it('shows times in the local time zone, not as UTC timestamps', () => {
    const text = formatTime('2026-01-02T00:00:00Z');
    expect(text).not.toContain('T00:00:00');
    expect(text).not.toContain('Z');
    expect(text).toBe(new Date('2026-01-02T00:00:00Z').toLocaleString());
  });
});

describe('stepSubtitle', () => {
  it('shows the waiting hint first and the timer as its time limit', () => {
    expect(
      stepSubtitle(
        timer({
          waitingFor: 'Waiting for approval',
          deadline: { time: '2026-01-02T00:00:00Z', kind: 'timeout' },
        }),
        now,
      ),
    ).toBe('Waiting for approval · times out in 23h 40m');
  });

  it('titles the box of a wait with a time limit with what it waits for', () => {
    expect(
      stepBoxText(
        timer({
          waitingFor: 'Waiting for approval',
          deadline: { time: '2026-01-02T00:00:00Z', kind: 'timeout' },
        }),
        now,
      ),
    ).toEqual({
      title: 'Waiting for approval',
      subtitle: 'Times out in 23h 40m · Timer 24h',
    });
    expect(stepBoxText(timer(), now)).toEqual({
      title: 'Timer 24h',
      subtitle: 'Fires in 23h 40m',
    });
  });

  it('shows when a plain timer fires', () => {
    expect(stepSubtitle(timer(), now)).toBe('Fires in 23h 40m');
    expect(
      stepSubtitle(timer({ status: 'Completed', deadline: undefined }), now),
    ).toBe('Timer');
  });
});

describe('the end of a run that continued as new', () => {
  const end: WorkflowGraphNode = {
    id: 'end',
    kind: 'workflowClosed',
    name: 'Continued as new',
    status: 'ContinuedAsNew',
    workflow: { namespace: 'default', workflowId: 'wf', runId: 'run-3' },
    events: [],
  };
  it('names the run it continues in', () => {
    expect(stepSubtitle(end, now, { nextRun: 3 })).toBe('Continues in run 3');
    expect(stepSubtitle(end, now)).toBe('Continues in a new run');
    expect(
      stepSubtitle({ ...end, status: 'Completed', name: 'End' }, now),
    ).toBe('');
  });
});

describe('isMarkerStep', () => {
  const marker = (markerName: string): WorkflowGraphNode => ({
    id: 'marker-7',
    kind: 'marker',
    name: markerName,
    status: 'Completed',
    events: [],
    details: { markerName },
  });

  it('counts side effects, versions and patches as markers', () => {
    for (const name of ['SideEffect', 'MutableSideEffect', 'Version']) {
      expect(isMarkerStep(marker(name))).toBe(true);
    }
    expect(isMarkerStep(marker('core_patch'))).toBe(true);
  });

  it('keeps local activities and other steps', () => {
    expect(isMarkerStep(marker('LocalActivity'))).toBe(false);
    expect(isMarkerStep(marker('core_local_activity'))).toBe(false);
    expect(isMarkerStep(timer())).toBe(false);
  });
});
