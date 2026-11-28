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

import type { WorkflowEventGroupKind, WorkflowNodeKind } from '../../common';
import { endpointKindTint, groupKindTint } from './edgeKind';

const nodes: Array<{ id: string; kind: WorkflowNodeKind }> = [
  { id: 'start', kind: 'workflowStarted' },
  { id: 'end', kind: 'workflowClosed' },
  { id: 'wait', kind: 'waiting' },
  { id: 'act', kind: 'activity' },
  { id: 'tmr', kind: 'timer' },
  { id: 'sig', kind: 'signal' },
  { id: 'sent', kind: 'signalSent' },
  { id: 'upd', kind: 'update' },
  { id: 'child', kind: 'childWorkflow' },
  { id: 'mark', kind: 'marker' },
  { id: 'task', kind: 'workflowTask' },
];

const boxes = new Map<string, { group: { kind: WorkflowEventGroupKind } }>([
  ['group:loop', { group: { kind: 'label' } }],
  ['group:hint', { group: { kind: 'event' } }],
  ['group:upd', { group: { kind: 'update' } }],
]);

describe('endpointKindTint', () => {
  it('maps each step kind the same way as kindTint', () => {
    expect(endpointKindTint('act', nodes)).toBe('activity');
    expect(endpointKindTint('tmr', nodes)).toBe('timer');
    expect(endpointKindTint('sig', nodes)).toBe('message');
    expect(endpointKindTint('sent', nodes)).toBe('message');
    expect(endpointKindTint('upd', nodes)).toBe('message');
    expect(endpointKindTint('child', nodes)).toBe('child');
    expect(endpointKindTint('mark', nodes)).toBe('marker');
  });

  it('leaves start, end, wait and other neutral kinds uncolored', () => {
    expect(endpointKindTint('start', nodes)).toBeUndefined();
    expect(endpointKindTint('end', nodes)).toBeUndefined();
    expect(endpointKindTint('wait', nodes)).toBeUndefined();
    expect(endpointKindTint('task', nodes)).toBeUndefined();
  });

  it('treats a signal or update group as a message, and a label group as gray', () => {
    expect(groupKindTint('event')).toBe('message');
    expect(groupKindTint('update')).toBe('message');
    expect(groupKindTint('label')).toBeUndefined();
    expect(endpointKindTint('group:hint', nodes, boxes)).toBe('message');
    expect(endpointKindTint('group:upd', nodes, boxes)).toBe('message');
    expect(endpointKindTint('group:loop', nodes, boxes)).toBeUndefined();
  });

  it('colors an edge by the step or group it leads to', () => {
    expect(endpointKindTint('act', nodes, boxes)).toBe('activity');
    expect(endpointKindTint('sig', nodes, boxes)).toBe('message');
    expect(endpointKindTint('start', nodes, boxes)).toBeUndefined();
    expect(endpointKindTint('end', nodes, boxes)).toBeUndefined();
    expect(endpointKindTint('group:hint', nodes, boxes)).toBe('message');
    expect(endpointKindTint('group:upd', nodes, boxes)).toBe('message');
    expect(endpointKindTint('group:loop', nodes, boxes)).toBeUndefined();
  });
});
