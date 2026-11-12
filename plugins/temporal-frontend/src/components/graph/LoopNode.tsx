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
import type { WorkflowLoopGroup, WorkflowLoopRound } from '../../common';
import type { LoopBox } from './loops';
import {
  decisionText,
  loopStatusLabel,
  loopStatusShort,
  loopTone,
  roundBadge,
  roundLabel,
  roundsText,
} from '../loopText';
import { statusLabel, statusTone } from '../WorkflowStatusLabel';
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
 * The box of a loop. Collapsed it stands for every round; expanded it is
 * the header above the round frames. Pressing it expands or collapses.
 */
export const LoopNode = memo(function LoopNodeView(
  props: NodeProps<LoopFlowNode>,
) {
  const { box, active, selected, onToggle } = props.data;
  const { loop, expanded } = box;
  const status = loopStatusLabel(loop.status);
  const short = loopStatusShort(loop.status);
  const sub = expanded
    ? [
        roundsText(
          box.frames.map(f => f.round),
          loop,
        ),
        short,
      ].join(' · ')
    : [roundLabel(loop.iteration, loop), short].join(' · ');
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
          loop.iteration,
          loop,
        ).toLocaleLowerCase('en-US')}, ${status.toLocaleLowerCase('en-US')}${
          expanded ? ', expanded' : ''
        }`}
        title={`${loop.name}: ${[
          expanded
            ? roundsText(
                box.frames.map(f => f.round),
                loop,
              )
            : roundLabel(loop.iteration, loop),
          status,
        ].join(' · ')}. ${expanded ? 'Collapse' : 'Expand'}`}
        onClick={() => onToggle(loop.name)}
      >
        <span className={tp('tp-node-title')}>
          <RiRepeatLine size={16} className={tp('tp-node-icon')} aria-hidden />
          <span>{loop.name}</span>
          <span className={tp('tp-badge')}>
            {roundBadge(loop.iteration, loop)}
          </span>
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

export type RoundFrameData = {
  loop: WorkflowLoopGroup;
  round: WorkflowLoopRound;
  /** True for the frame the view was moved to. */
  focused: boolean;
  /** True while the round runs in a running workflow: the frame pulses. */
  active: boolean;
  /** No step of the round is shown (markers hidden). */
  empty: boolean;
};

export type RoundFrameFlowNode = Node<RoundFrameData, 'round'>;

/** Title of a round frame: round, decision and score. */
export function roundTitle(round: WorkflowLoopRound): string {
  return [`Round ${round.iteration}`, decisionText(round)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The frame of one round of an expanded loop, drawn under its steps: a
 * title bar with the round, its decision and score, and its status when
 * it runs or failed. Arrows come in on the left (the first round) or the
 * top, and go out at the bottom or on the right (the last round).
 */
export const RoundFrameNode = memo(function RoundFrameView(
  props: NodeProps<RoundFrameFlowNode>,
) {
  const { loop, round, focused, active, empty } = props.data;
  const title = roundTitle(round);
  const tone =
    round.status === 'Completed' ? 'neutral' : statusTone(round.status);
  const showStatus = round.status !== 'Completed';
  return (
    <div
      className={tp('tp-round', `tp-tone-${tone}`)}
      role="group"
      aria-label={`${loop.name}, ${title}, ${statusLabel(round.status)}`}
      data-testid={`loop-round-${loop.name}-${round.iteration}`}
      data-status={round.status}
      data-focused={focused}
      data-active={active}
    >
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        className={tp('tp-handle')}
        isConnectable={false}
      />
      <Handle
        type="target"
        id="top"
        position={Position.Top}
        className={tp('tp-handle')}
        isConnectable={false}
      />
      <div className={tp('tp-round-title')}>
        <span className={tp('tp-round-name')}>{title}</span>
        {showStatus && (
          <span className={tp('tp-badge')}>{statusLabel(round.status)}</span>
        )}
      </div>
      {empty && <div className={tp('tp-round-empty')}>No steps shown</div>}
      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        className={tp('tp-handle')}
        isConnectable={false}
      />
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className={tp('tp-handle')}
        isConnectable={false}
      />
    </div>
  );
});

export type LoopNoteData = { text: string; testId: string };
export type LoopNoteFlowNode = Node<LoopNoteData, 'loopNote'>;

/** A line above the first round frame or below the last one. */
export const LoopNoteNode = memo(function LoopNoteView(
  props: NodeProps<LoopNoteFlowNode>,
) {
  return (
    <div className={tp('tp-round-note')} data-testid={props.data.testId}>
      {props.data.text}
    </div>
  );
});
