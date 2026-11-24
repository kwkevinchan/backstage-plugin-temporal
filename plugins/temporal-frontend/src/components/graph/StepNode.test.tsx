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

import { act, render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import type { WorkflowGraphNode } from '../../common';
import { StepNode, type StepFlowNode } from './StepNode';

jest.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
}));

function makeNodeProps(step: WorkflowGraphNode): NodeProps<StepFlowNode> {
  return {
    id: step.id,
    type: 'step',
    data: {
      step,
      selected: false,
      onSelect: jest.fn(),
    },
    selected: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    deletable: false,
    selectable: false,
    draggable: false,
  };
}

describe('StepNode', () => {
  it('refreshes open deadline countdown text every 10 seconds and clears its timer on unmount', () => {
    jest.useFakeTimers();
    const base = Date.parse('2026-01-01T00:00:00Z');
    jest.setSystemTime(base);
    try {
      const step: WorkflowGraphNode = {
        id: 'timer-5',
        kind: 'timer',
        name: 'Timer 50s',
        status: 'Waiting',
        events: [],
        deadline: {
          time: new Date(base + 50_000).toISOString(),
          kind: 'fires',
        },
      };
      const { unmount } = render(<StepNode {...makeNodeProps(step)} />);
      expect(screen.getByText('Fires in 50s')).toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(1);

      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      expect(screen.getByText('Fires in 40s')).toBeInTheDocument();

      unmount();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not start a countdown timer for closed steps', () => {
    jest.useFakeTimers();
    try {
      const step: WorkflowGraphNode = {
        id: 'timer-5',
        kind: 'timer',
        name: 'Timer 50s',
        status: 'Completed',
        events: [],
        deadline: {
          time: '2026-01-01T00:00:50Z',
          kind: 'fires',
        },
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:50Z',
      };
      render(<StepNode {...makeNodeProps(step)} />);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
