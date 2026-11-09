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
import type {
  WorkflowGraphNode,
  WorkflowNodeKind,
} from '@kwkevinchan/backstage-plugin-temporal-common';
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
  RiSparkling2Line,
  RiToolsLine,
} from '@remixicon/react';
import {
  formatCallDuration,
  llmStatsText,
  modelText,
  toolName,
} from '../llm/llmText';
import {
  isActiveStatus,
  statusLabel,
  statusTone,
} from '../WorkflowStatusLabel';
import { isOpenStep, retryBadge, stepBoxText, stepSubtitle } from '../steps';
import { tp } from '../styles';

export type StepNodeData = {
  step: WorkflowGraphNode;
  selected: boolean;
  onSelect(id: string): void;
  /** Number of the next run, for the end of a run that continued as new. */
  nextRun?: number;
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

/** Status and duration of a tool box, or what it waits for. */
function toolSubtitle(step: WorkflowGraphNode): string {
  if (isOpenStep(step)) return stepSubtitle(step) || statusLabel(step.status);
  const ms =
    step.startTime && step.endTime
      ? Date.parse(step.endTime) - Date.parse(step.startTime)
      : undefined;
  return [
    statusLabel(step.status),
    step.kind === 'marker' ? 'Local activity' : '',
    step.kind !== 'marker' && ms !== undefined ? formatCallDuration(ms) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The lines of a model call box: name, model and status, numbers. */
function LlmLines(props: { step: WorkflowGraphNode; badge?: string }) {
  const { step, badge } = props;
  const llm = step.llm!;
  const status = step.status === 'Completed' ? '' : statusLabel(step.status);
  return (
    <>
      <span className={tp('tp-node-title')}>
        <RiSparkling2Line
          size={16}
          className={tp('tp-node-icon', 'tp-llm-icon')}
          aria-hidden
        />
        <span>{step.name}</span>
        {badge && <span className={tp('tp-badge')}>{badge}</span>}
      </span>
      <span className={tp('tp-node-sub', 'tp-llm-model')}>
        {[modelText(llm), status].filter(Boolean).join(' · ')}
      </span>
      <span className={tp('tp-node-sub')} data-testid="llm-stats">
        {llmStatsText(llm) || (llm.reasoning ? 'Reasoning' : '')}
      </span>
    </>
  );
}

/** One step in the graph: a button with name, status and retries. */
export const StepNode = memo(function StepNodeView(
  props: NodeProps<StepFlowNode>,
) {
  const { step, selected, onSelect } = props.data;
  const badge = retryBadge(step);
  if (step.llm || step.tool) {
    const text = step.llm
      ? `Model call ${step.name}, ${modelText(step.llm)}, ${llmStatsText(
          step.llm,
        )}`
      : `Tool call ${toolName(step)}`;
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
          className={tp(
            'tp-node',
            'tp-llm',
            `tp-tone-${statusTone(step.status)}`,
          )}
          data-llm={step.llm ? 'call' : 'tool'}
          data-selected={selected}
          data-dashed={step.status === 'Waiting'}
          data-active={isActiveStatus(step.status)}
          data-status={step.status}
          data-testid={`step-${step.id}`}
          aria-label={`${text}, ${statusLabel(step.status)}${
            badge ? `, attempt ${step.attempt}` : ''
          }`}
          aria-pressed={selected}
          title={text}
          onClick={() => onSelect(step.id)}
        >
          {step.llm ? (
            <LlmLines step={step} badge={badge} />
          ) : (
            <>
              <span className={tp('tp-node-title')}>
                <RiToolsLine
                  size={14}
                  className={tp('tp-node-icon', 'tp-llm-icon')}
                  aria-hidden
                />
                <span>{toolName(step)}</span>
                {badge && <span className={tp('tp-badge')}>{badge}</span>}
              </span>
              <span className={tp('tp-node-sub')}>{toolSubtitle(step)}</span>
            </>
          )}
        </button>
        <Handle
          type="source"
          position={Position.Right}
          className={tp('tp-handle')}
          isConnectable={false}
        />
      </>
    );
  }
  const dashed = step.kind === 'waiting' || step.status === 'Waiting';
  const text = stepBoxText(step, Date.now(), { nextRun: props.data.nextRun });
  // "Continued as new" is the title already.
  const status =
    statusLabel(step.status) === text.title ? '' : statusLabel(step.status);
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
            : [status, text.subtitle].filter(Boolean).join(' · ')}
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
