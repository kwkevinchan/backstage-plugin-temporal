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
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiEditBoxLine,
  RiFocus3Line,
  RiLockLine,
  RiMailLine,
  RiPriceTag3Line,
  RiStackLine,
} from '@remixicon/react';
import type { WorkflowEventGroup } from '../../common';
import type { GroupBox, GroupHue } from './eventGroups';
import {
  groupCountBadge,
  groupDuration,
  groupTokens,
  stepsText,
  UNREADABLE_LABEL_TEXT,
} from '../groupText';
import { statusLabel, statusTone } from '../WorkflowStatusLabel';
import { tp } from '../styles';

/** The icon of a group: signal and update groups have their own. */
function GroupIcon(props: { group: WorkflowEventGroup }) {
  const p = {
    size: 14,
    className: tp('tp-node-icon', 'tp-group-icon'),
    'aria-hidden': true,
  };
  if (props.group.kind === 'event') return <RiMailLine {...p} />;
  if (props.group.kind === 'update') return <RiEditBoxLine {...p} />;
  return <RiStackLine {...p} />;
}

/** The name of a group, with a note when its label cannot be read. */
function GroupName(props: { group: WorkflowEventGroup }) {
  const { group } = props;
  return (
    <>
      <span className={tp('tp-group-name')}>{group.name}</span>
      {group.labelUnreadable && (
        <span
          className={tp('tp-group-unreadable')}
          title={UNREADABLE_LABEL_TEXT}
          aria-label={UNREADABLE_LABEL_TEXT}
          role="img"
          data-testid="group-label-unreadable"
        >
          <RiLockLine size={12} aria-hidden />
        </span>
      )}
    </>
  );
}

/** Status, duration, steps and tokens of a group, as a list of texts. */
function groupFacts(box: GroupBox, withSteps: boolean): string[] {
  const { group } = box;
  return [
    statusLabel(group.status),
    groupDuration(group),
    withSteps ? stepsText(box.stepIds.length) : '',
    groupTokens(group),
  ].filter(Boolean);
}

/** Text of a group for screen readers. */
function groupAria(box: GroupBox): string {
  const kind =
    box.group.kind === 'label'
      ? 'Event group'
      : `Event group of ${
          box.group.kind === 'update' ? 'an update' : 'a signal'
        }`;
  const count = groupCountBadge(box.group);
  return [
    `${kind} ${box.group.name}`,
    count ? `${box.group.children.length} groups` : '',
    ...groupFacts(box, true).map(t => t.toLocaleLowerCase('en-US')),
    box.expanded ? 'expanded' : 'collapsed',
  ]
    .filter(Boolean)
    .join(', ');
}

export type GroupFrameData = {
  box: GroupBox;
  /** True for the frame the view was moved to. */
  focused: boolean;
  /** True while the group runs in a running workflow: the frame pulses. */
  active: boolean;
  onToggle(key: string): void;
  /** Selects the signal or update that started the group. */
  onSelectSource?(id: string): void;
};

export type GroupFrameFlowNode = Node<GroupFrameData, 'groupFrame'>;

/**
 * The frame of an expanded event group, drawn under its steps: a title bar
 * with a button that collapses it, the name, how many groups are inside
 * (×3), the status, the duration and the tokens of its model calls.
 */
export const GroupFrameNode = memo(function GroupFrameView(
  props: NodeProps<GroupFrameFlowNode>,
) {
  const { box, focused, active, onToggle, onSelectSource } = props.data;
  const { group } = box;
  const count = groupCountBadge(group);
  const tone =
    group.status === 'Completed' ? 'neutral' : statusTone(group.status);
  const facts = groupFacts(box, false);
  const sourceText = `Show the ${
    group.kind === 'update' ? 'update' : 'signal'
  } that started this group`;
  return (
    <div
      className={tp('tp-group-frame', 'tp-hue', `tp-tone-${tone}`)}
      role="group"
      aria-label={`Event group ${group.name}`}
      data-testid={`group-frame-${group.key}`}
      data-kind={group.kind}
      data-status={group.status}
      data-focused={focused}
      data-active={active}
      data-depth={box.depth}
      data-hue={box.hue}
    >
      <div className={tp('tp-group-title')}>
        <button
          type="button"
          className={tp('tp-group-toggle')}
          aria-expanded
          aria-label={`Collapse ${groupAria(box)}`}
          title="Collapse"
          onClick={() => onToggle(group.key)}
        >
          <RiArrowDownSLine size={16} aria-hidden />
          <GroupIcon group={group} />
          <GroupName group={group} />
          {count && (
            <span className={tp('tp-badge', 'tp-group-count')}>{count}</span>
          )}
        </button>
        {/* The status stays; the other facts go first in a narrow frame. */}
        <span
          className={tp('tp-group-facts')}
          data-testid="group-facts"
          title={facts.join(' · ')}
        >
          <span className={tp('tp-group-status')}>{facts[0]}</span>
          {facts.length > 1 && (
            <span className={tp('tp-group-extra')}>
              {/* A space at the start of a flex item is dropped. */}
              {`\u00a0· ${facts.slice(1).join(' · ')}`}
            </span>
          )}
        </span>
        {group.sourceNodeId && onSelectSource && (
          <button
            type="button"
            className={tp('tp-group-source')}
            onClick={() => onSelectSource(group.sourceNodeId!)}
            aria-label={sourceText}
            title={sourceText}
          >
            <RiFocus3Line size={14} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
});

export type GroupNodeData = {
  box: GroupBox;
  /** True while the group runs in a running workflow: the box pulses. */
  active: boolean;
  /** Picked in the Event Groups tab. */
  focused: boolean;
  /** The selected step is in this collapsed group. */
  selected?: boolean;
  onToggle(key: string): void;
};

export type GroupFlowNode = Node<GroupNodeData, 'eventGroup'>;

/**
 * A collapsed event group: one box with the title bar's facts and the
 * number of steps in it. Pressing it expands it.
 */
export const GroupNode = memo(function GroupNodeView(
  props: NodeProps<GroupFlowNode>,
) {
  const { box, active, focused, selected, onToggle } = props.data;
  const { group } = box;
  const count = groupCountBadge(group);
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
          'tp-hue',
          `tp-tone-${statusTone(group.status)}`,
        )}
        data-group={group.kind}
        data-hue={box.hue}
        data-depth={box.depth}
        data-nested={group.children.length > 0}
        data-expanded="false"
        data-active={active}
        data-selected={focused || Boolean(selected)}
        data-status={group.status}
        data-testid={`group-${group.key}`}
        aria-expanded={false}
        aria-label={`${groupAria(box)}${
          selected ? ', has the selected step' : ''
        }`}
        title={`${group.name}: ${groupFacts(box, true).join(' · ')}. Expand`}
        onClick={() => onToggle(group.key)}
      >
        <span className={tp('tp-node-title')}>
          <RiArrowRightSLine
            size={16}
            className={tp('tp-node-icon')}
            aria-hidden
          />
          <GroupIcon group={group} />
          <GroupName group={group} />
          {count && <span className={tp('tp-badge')}>{count}</span>}
        </span>
        <span className={tp('tp-node-sub')}>
          {groupFacts(box, true).join(' · ')}
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

export type GroupTagData = {
  groups: WorkflowEventGroup[];
  /** Color of the label: that of the first group. */
  hue: GroupHue;
};
export type GroupTagFlowNode = Node<GroupTagData, 'groupTag'>;

/** Height of the label of the groups of a step without their own box. */
export const GROUP_TAG_HEIGHT = 16;

/**
 * The groups of a step that have no box of their own (their steps are not
 * next to each other in the graph, or they share steps with another box),
 * as a label on the top edge of the step.
 */
export const GroupTagNode = memo(function GroupTagView(
  props: NodeProps<GroupTagFlowNode>,
) {
  const names = props.data.groups.map(g => g.name);
  return (
    <div className={tp('tp-group-tag-row')}>
      <span
        className={tp('tp-group-tag', 'tp-hue')}
        data-hue={props.data.hue}
        title={`Event groups: ${names.join(', ')}`}
        data-testid={`group-tag-${props.id}`}
      >
        <RiPriceTag3Line size={11} aria-hidden />
        <span>{names.join(', ')}</span>
      </span>
    </div>
  );
});
