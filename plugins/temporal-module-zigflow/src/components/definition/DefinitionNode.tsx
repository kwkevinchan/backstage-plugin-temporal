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
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import {
  RiAlarmWarningLine,
  RiArrowRightCircleLine,
  RiCheckboxMultipleLine,
  RiEditBoxLine,
  RiFlowChart,
  RiGitForkLine,
  RiGitMergeLine,
  RiLoopLeftLine,
  RiMailLine,
  RiPlayCircleLine,
  RiQuestionLine,
  RiRouteLine,
  RiSendPlaneLine,
  RiSettings3Line,
  RiShieldLine,
  RiStopCircleLine,
  RiTerminalBoxLine,
  RiTimerLine,
} from '@remixicon/react';
import {
  isActiveStatus,
  statusLabel,
  statusTone,
} from '@kwkevinchan/backstage-plugin-temporal-frontend/ui';
import { tp } from '../styles';

import type { DefinitionGraphNode, DefinitionNodeKind } from './dslGraph';
import type { TaskRunMark } from './overlay';

export type DefinitionNodeData = {
  node: DefinitionGraphNode;
  mark?: TaskRunMark;
  selected: boolean;
  onSelect(id: string): void;
};

export type DefinitionFlowNode = Node<DefinitionNodeData, 'task'>;

function KindIcon(props: { kind: DefinitionNodeKind; run?: string }) {
  const p = { size: 16, className: tp('tp-node-icon'), 'aria-hidden': true };
  switch (props.kind) {
    case 'start':
      return <RiPlayCircleLine {...p} />;
    case 'end':
      return <RiStopCircleLine {...p} />;
    case 'call':
      return <RiSettings3Line {...p} />;
    case 'run':
      return props.run === 'workflow' ? (
        <RiFlowChart {...p} />
      ) : (
        <RiTerminalBoxLine {...p} />
      );
    case 'do':
      return <RiCheckboxMultipleLine {...p} />;
    case 'for':
      return <RiLoopLeftLine {...p} />;
    case 'fork':
      return <RiGitForkLine {...p} />;
    case 'join':
      return <RiGitMergeLine {...p} />;
    case 'try':
    case 'catch':
      return <RiShieldLine {...p} />;
    case 'switch':
      return <RiRouteLine {...p} />;
    case 'wait':
      return <RiTimerLine {...p} />;
    case 'listen':
      return <RiMailLine {...p} />;
    case 'set':
      return <RiEditBoxLine {...p} />;
    case 'emit':
      return <RiSendPlaneLine {...p} />;
    case 'raise':
      return <RiAlarmWarningLine {...p} />;
    case 'unsupported':
      return <RiQuestionLine {...p} />;
    default:
      return <RiArrowRightCircleLine {...p} />;
  }
}

/** Words for the state of a task in the selected run. */
export function markLabel(mark: TaskRunMark): string {
  if (mark.status === 'NotReached') return 'Not reached';
  if (mark.status === 'Pending') return 'Not yet';
  const label = statusLabel(mark.status);
  return mark.count > 1 ? `${label} · ${mark.count} times` : label;
}

/** One box of the definition graph: a task, or its start, end, join or catch. */
export const DefinitionNode = memo(function DefinitionNodeView(
  props: NodeProps<DefinitionFlowNode>,
) {
  const { node, mark, selected, onSelect } = props.data;
  const unsupported = node.kind === 'unsupported';
  const status =
    mark && mark.status !== 'NotReached' && mark.status !== 'Pending'
      ? mark.status
      : undefined;
  const tone = status ? statusTone(status) : 'neutral';
  const run = node.subtitle.startsWith('Child workflow') ? 'workflow' : '';
  const state = mark ? markLabel(mark) : '';
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className={tp('tp-handle')}
        isConnectable={false}
      />
      <button
        type="button"
        className={tp('tp-node', `tp-tone-${tone}`)}
        data-selected={selected}
        data-dashed={
          unsupported ||
          mark?.status === 'Pending' ||
          mark?.status === 'Waiting'
        }
        data-active={status ? isActiveStatus(status) : false}
        data-kind={node.kind}
        data-mark={mark?.status}
        data-dimmed={mark?.status === 'NotReached'}
        data-testid={`definition-node-${node.id}`}
        aria-label={[
          node.title,
          node.subtitle,
          state,
          unsupported ? 'unsupported' : '',
        ]
          .filter(Boolean)
          .join(', ')}
        aria-pressed={selected}
        title={[node.title, node.subtitle, state].filter(Boolean).join(': ')}
        onClick={() => onSelect(node.id)}
      >
        <span className={tp('tp-node-title')}>
          <KindIcon kind={node.kind} run={run} />
          <span>{node.title}</span>
          {unsupported && (
            <span className={tp('tp-badge', 'tp-badge-unsupported')}>
              unsupported
            </span>
          )}
          {node.badges.map(badge => (
            <span key={badge} className={tp('tp-badge')}>
              {badge}
            </span>
          ))}
        </span>
        <span className={tp('tp-node-sub')}>
          {[state, node.subtitle].filter(Boolean).join(' · ')}
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className={tp('tp-handle')}
        isConnectable={false}
      />
    </>
  );
});
