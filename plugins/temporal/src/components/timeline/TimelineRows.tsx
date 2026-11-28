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

import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiSparkling2Line,
  RiToolsLine,
} from '@remixicon/react';
import {
  groupCountBadge,
  groupDuration,
  groupTokens,
  UNREADABLE_LABEL_TEXT,
} from '../groupText';
import type { GroupHue } from '../graph/eventGroups';
import { kindLabel } from '../steps';
import { statusLabel } from '../status';
import { tp } from '../styles';
import {
  placeSpan,
  placeTime,
  Span,
  TimelineEventGroup,
  TimelineRow,
} from './timeline';
import { retryText, rowLabel, rowName } from './timelineText';

/** Indent of each level of event groups in the label column. */
const GROUP_INDENT = 16;

/** `call` for a model call, `tool` for a tool call. */
function llmKind(row: TimelineRow): 'call' | 'tool' | undefined {
  if (row.node.llm) return 'call';
  return row.node.tool ? 'tool' : undefined;
}

/** The bar of a step on its track, or the point of a signal or an update. */
export function Bar(props: {
  row: TimelineRow;
  win: Span;
  selected: boolean;
  onSelect(id: string): void;
  onHover(row: TimelineRow, target: Element, event?: ReactMouseEvent): void;
  onLeave(): void;
}) {
  const { row, win } = props;
  const common = {
    'aria-label': rowLabel(row),
    'aria-pressed': props.selected,
    'data-testid': `timeline-bar-${row.id}`,
    'data-selected': props.selected,
    'data-open': row.open,
    'data-dashed': row.dashed,
    'data-tone': row.tone,
    'data-shape': row.shape,
    'data-llm': llmKind(row),
    onClick: () => props.onSelect(row.id),
    onMouseEnter: (e: ReactMouseEvent) =>
      props.onHover(row, e.currentTarget, e),
    onMouseMove: (e: ReactMouseEvent) => props.onHover(row, e.currentTarget, e),
    onMouseLeave: props.onLeave,
    onFocus: (e: React.FocusEvent) => props.onHover(row, e.currentTarget),
    onBlur: props.onLeave,
  };
  if (row.shape === 'point') {
    const left = placeTime(row.at ?? row.span.start, win);
    if (left === undefined) return null;
    return (
      <button
        type="button"
        className={tp('tp-tl-point', `tp-tone-${row.tone}`)}
        style={{ left: `${left}%` }}
        {...common}
      />
    );
  }
  const place = placeSpan(row.span, win);
  if (!place) return null;
  const clipped = {
    start: Math.max(row.span.start, win.start),
    end: Math.min(row.span.end, win.end),
  };
  const inside = (span?: Span) => {
    const width = clipped.end - clipped.start;
    if (!span || width <= 0) {
      return span ? { left: 0, width: 100 } : undefined;
    }
    const p = placeSpan(span, clipped);
    return p;
  };
  const queued = inside(row.queued);
  const run = inside(row.run);
  return (
    <button
      type="button"
      className={tp('tp-tl-bar', `tp-tone-${row.tone}`)}
      style={{ left: `${place.left}%`, width: `${place.width}%` }}
      {...common}
    >
      {queued && (
        <span
          className={tp('tp-tl-queued')}
          style={{ left: `${queued.left}%`, width: `${queued.width}%` }}
        />
      )}
      {run && (
        <span
          className={tp(row.dashed ? 'tp-tl-wait' : 'tp-tl-run')}
          style={{ left: `${run.left}%`, width: `${run.width}%` }}
        />
      )}
    </button>
  );
}

/** The name of a step in the label column. */
export function RowLabel(props: {
  row: TimelineRow;
  nested: boolean;
  /** Event groups around the row, past the first one. */
  depth?: number;
  onSelect(id: string): void;
}) {
  const { row } = props;
  const name = rowName(row);
  return (
    // The bar is the button; a click on the name selects the step too.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={tp('tp-tl-label')}
      style={
        props.depth
          ? { paddingLeft: 30 + props.depth * GROUP_INDENT }
          : undefined
      }
      data-nested={props.nested}
      onClick={() => props.onSelect(row.id)}
      title={`${name} · ${kindLabel(row.node.kind)}`}
    >
      {row.node.llm && (
        <RiSparkling2Line
          size={14}
          aria-label="Model call"
          className={tp('tp-llm-icon')}
          data-testid={`timeline-llm-${row.id}`}
        />
      )}
      {row.node.tool && (
        <RiToolsLine
          size={14}
          aria-label="Tool call"
          className={tp('tp-llm-icon')}
        />
      )}
      <span className={tp('tp-tl-name')}>{name}</span>
      {row.retries > 0 && (
        <span
          className={tp('tp-tl-badge', 'tp-tone-warning')}
          data-testid={`timeline-retries-${row.id}`}
        >
          {retryText(row.retries)}
        </span>
      )}
    </div>
  );
}

/**
 * The header row of an event group: a button that expands or collapses it,
 * and a bar over the time of its steps.
 */
function GroupRow(props: {
  testId: string;
  label: string;
  /** Title of the button. */
  hint?: string;
  /** Title of the bar. */
  barTitle: string;
  steps: number;
  span: Span;
  tone: string;
  expanded: boolean;
  win: Span;
  onToggle(): void;
  /** Indent of a group inside other groups, in pixels. */
  indent?: number;
  /** Color of an event group, as a dot before its name. */
  hue?: GroupHue;
}) {
  const place = placeSpan(props.span, props.win);
  return (
    <div className={tp('tp-tl-row', 'tp-tl-group')} data-testid={props.testId}>
      <div
        className={tp('tp-tl-label')}
        style={props.indent ? { paddingLeft: props.indent } : undefined}
      >
        <button
          type="button"
          className={tp('tp-tl-toggle')}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          title={props.hint || undefined}
        >
          {props.expanded ? (
            <RiArrowDownSLine size={16} aria-hidden />
          ) : (
            <RiArrowRightSLine size={16} aria-hidden />
          )}
          {props.hue && (
            <span
              className={tp('tp-group-swatch', 'tp-hue')}
              data-hue={props.hue}
              aria-hidden
            />
          )}
          <span className={tp('tp-tl-name')}>{props.label}</span>
          <span className={tp('tp-muted')}>
            {props.expanded ? '' : ` · ${props.steps} steps`}
          </span>
        </button>
      </div>
      <div className={tp('tp-tl-track')}>
        {place && (
          <div
            className={tp('tp-tl-group-bar', `tp-tone-${props.tone}`)}
            data-expanded={props.expanded}
            style={{ left: `${place.left}%`, width: `${place.width}%` }}
            title={props.barTitle}
          />
        )}
      </div>
    </div>
  );
}

/** The header row of a Temporal event group. */
export function EventGroupHeader(props: {
  group: TimelineEventGroup;
  hue?: GroupHue;
  expanded: boolean;
  win: Span;
  onToggle(): void;
}) {
  const { group } = props;
  const count = groupCountBadge(group.group);
  const label = [group.group.name, count].filter(Boolean).join(' ');
  const facts = [
    statusLabel(group.group.status),
    groupDuration(group.group),
    groupTokens(group.group),
  ].filter(Boolean);
  return (
    <GroupRow
      testId={`timeline-group-${group.group.key}`}
      label={label}
      hint={[
        group.group.labelUnreadable ? UNREADABLE_LABEL_TEXT : '',
        facts.join(' · '),
      ]
        .filter(Boolean)
        .join(' ')}
      barTitle={[label, ...facts].join(' · ')}
      steps={group.rows.length}
      span={group.span}
      tone={group.tone}
      expanded={props.expanded}
      win={props.win}
      onToggle={props.onToggle}
      indent={group.depth ? 8 + group.depth * GROUP_INDENT : undefined}
      hue={props.hue}
    />
  );
}
