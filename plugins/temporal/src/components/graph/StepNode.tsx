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
import type { WorkflowGraphNode, WorkflowNodeKind } from '../../common';
import {
  RiArrowRightCircleLine,
  RiBookmarkLine,
  RiEditBoxLine,
  RiFlowChart,
  RiHourglassLine,
  RiMailLine,
  RiPlayCircleLine,
  RiSendPlaneLine,
  RiSettings3Line,
  RiStopCircleLine,
  RiTimerLine,
  RiForbidLine,
} from '@remixicon/react';
import {
  isActiveStatus,
  statusLabel,
  statusTone,
} from '../WorkflowStatusLabel';
import { isOpenStep, retryBadge, stepBoxText } from '../steps';
import { tp } from '../styles';

export type StepNodeData = {
  step: WorkflowGraphNode;
  selected: boolean;
  onSelect(id: string): void;
};

export type StepFlowNode = Node<StepNodeData, 'step'>;

function KindIcon(props: { kind: WorkflowNodeKind; ended?: boolean }) {
  const p = { size: 16, className: tp('tp-node-icon'), 'aria-hidden': true };
  switch (props.kind) {
    case 'workflowStarted':
      return <RiPlayCircleLine {...p} />;
    case 'workflowClosed':
      return props.ended ? (
        <RiArrowRightCircleLine {...p} />
      ) : (
        <RiStopCircleLine {...p} />
      );
    case 'timer':
      return <RiTimerLine {...p} />;
    case 'signal':
      return <RiMailLine {...p} />;
    case 'signalSent':
      return <RiSendPlaneLine {...p} />;
    case 'update':
      return <RiEditBoxLine {...p} />;
    case 'childWorkflow':
      return <RiFlowChart {...p} />;
    case 'marker':
      return <RiBookmarkLine {...p} />;
    case 'cancelRequest':
      return <RiForbidLine {...p} />;
    case 'waiting':
      return <RiHourglassLine {...p} />;
    default:
      return <RiSettings3Line {...p} />;
  }
}

/** One step in the graph: a button with name, status and retries. */
export const StepNode = memo(function StepNodeView(
  props: NodeProps<StepFlowNode>,
) {
  const { step, selected, onSelect } = props.data;
  const badge = retryBadge(step);
  const dashed = step.kind === 'waiting' || step.status === 'Waiting';
  const text = stepBoxText(step);
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
        className={tp('tp-node', `tp-tone-${statusTone(step.status)}`)}
        data-selected={selected}
        data-dashed={dashed}
        data-active={isActiveStatus(step.status)}
        data-status={step.status}
        data-testid={`step-${step.id}`}
        aria-label={`${text.title}, ${statusLabel(step.status)}${
          badge ? `, attempt ${step.attempt}` : ''
        }`}
        aria-pressed={selected}
        title={`${text.title}: ${text.subtitle}`}
        onClick={() => onSelect(step.id)}
      >
        <span className={tp('tp-node-title')}>
          <KindIcon kind={step.kind} ended={step.status === 'ContinuedAsNew'} />
          <span>{text.title}</span>
          {badge && <span className={tp('tp-badge')}>{badge}</span>}
        </span>
        <span className={tp('tp-node-sub')}>
          {isOpenStep(step)
            ? text.subtitle
            : [statusLabel(step.status), text.subtitle]
                .filter(Boolean)
                .join(' · ')}
        </span>
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
