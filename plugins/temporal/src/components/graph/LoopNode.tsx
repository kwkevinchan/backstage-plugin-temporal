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

import { memo } from 'react';
import { Handle, NodeProps, Position, Node } from '@xyflow/react';
import { RiRepeatLine } from '@remixicon/react';
import type { LoopBox } from './loops';
import {
  decisionText,
  loopStatusLabel,
  loopTone,
  roundBadge,
  roundLabel,
} from '../loopText';
import { tp } from '../styles';

export type LoopNodeData = {
  box: LoopBox;
  /** True while the loop runs in a running workflow: the box pulses. */
  active: boolean;
  selected: boolean;
  onToggle(name: string): void;
};

export type LoopFlowNode = Node<LoopNodeData, 'loop'>;

/**
 * A loop in the graph: its name, the round and its state. Collapsed, it
 * stands for all rounds (drawn as a stack); expanded, it leads to the
 * steps of one round. Pressing it collapses or expands the loop.
 */
export const LoopNode = memo(function LoopNodeView(
  props: NodeProps<LoopFlowNode>,
) {
  const { box, active, selected, onToggle } = props.data;
  const { loop, round, expanded } = box;
  const iteration = expanded && round ? round.iteration : loop.iteration;
  const status = loopStatusLabel(loop.status);
  const decision = decisionText(expanded && round ? round : loop);
  const sub = expanded
    ? [roundLabel(iteration, loop), decision].filter(Boolean).join(' · ')
    : [roundLabel(iteration, loop), status].join(' · ');
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className={tp('tp-handle')}
        isConnectable={false}
      />
      <button
        type="button"
        className={tp('tp-node', `tp-tone-${loopTone(loop.status)}`)}
        data-loop="true"
        data-expanded={expanded}
        data-selected={selected}
        data-active={active && !expanded}
        data-testid={`loop-${loop.name}`}
        aria-expanded={expanded}
        aria-label={`Loop ${loop.name}, ${roundLabel(
          iteration,
          loop,
        ).toLocaleLowerCase('en-US')}, ${status.toLocaleLowerCase('en-US')}${
          expanded ? ', expanded' : ''
        }`}
        title={`${loop.name}: ${sub}`}
        onClick={() => onToggle(loop.name)}
      >
        <span className={tp('tp-node-title')}>
          <RiRepeatLine size={16} className={tp('tp-node-icon')} aria-hidden />
          <span>{loop.name}</span>
          <span className={tp('tp-badge')}>{roundBadge(iteration, loop)}</span>
        </span>
        <span className={tp('tp-node-sub')}>{sub}</span>
      </button>
      <Handle
        type="source"
        position={Position.Right}
        className={tp('tp-handle')}
        isConnectable={false}
      />
    </>
  );
});
