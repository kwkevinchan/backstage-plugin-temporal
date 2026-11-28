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

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowGraphResponse, WorkflowStatus } from '../../common';
import { Button, Flex, Text } from '@backstage/ui';
import { groupHues } from '../graph/eventGroups';
import { tp } from '../styles';
import {
  buildTimeline,
  formatOffset,
  placeSpan,
  placeTime,
  TimelineEventGroup,
  TimelineItem,
  TimelineRow,
  timeTicks,
} from './timeline';
import { TimelineLegend } from './TimelineLegend';
import { Bar, EventGroupHeader, RowLabel } from './TimelineRows';
import { TimelineTooltip } from './TimelineTooltip';
import { useTimelineWindow } from './useTimelineWindow';

interface WorkflowTimelineProps {
  graph: WorkflowGraphResponse;
  workflow: {
    runId?: string;
    status: WorkflowStatus;
    startTime?: string;
    closeTime?: string;
  };
  showMarkers?: boolean;
  selectedId?: string;
  onSelect(id: string | undefined): void;
  /** Bars of open steps grow with the clock (a running workflow). */
  live?: boolean;
  /** The current time; for tests. */
  now?: number;
}

/** The current time, every second while `live`. */
function useNow(live: boolean, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) {
      setNow(fixed);
      return undefined;
    }
    setNow(Date.now());
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, fixed]);
  return now;
}

/**
 * The steps of a run on a time axis: one bar per step with the time it
 * waited for a worker (queued) and the time it ran, dashed bars for timers
 * and waits, and points for signals and updates. Temporal event groups are
 * grouped and can be collapsed; a group inside another one is indented
 * under it. Drag across the chart, or scroll with Ctrl
 * held, to zoom.
 */
export function WorkflowTimeline(props: WorkflowTimelineProps) {
  const { graph, workflow, selectedId, onSelect } = props;
  const now = useNow(Boolean(props.live), props.now);
  const model = useMemo(
    () =>
      buildTimeline(graph, workflow, now, { showMarkers: props.showMarkers }),
    [graph, workflow, now, props.showMarkers],
  );
  const hues = useMemo(() => groupHues(graph.eventGroups), [graph.eventGroups]);
  const range = model.range;
  const {
    win,
    zoomed,
    zoomBy,
    showWholeRun,
    drag,
    dragged,
    hover,
    showHover,
    hideHover,
    chartRef,
    axisRef,
    width,
    chartEvents,
  } = useTimelineWindow(range);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const select = useCallback(
    (id: string) => {
      if (dragged.current) return;
      onSelect(id === selectedId ? undefined : id);
    },
    [dragged, onSelect, selectedId],
  );

  // Event groups, at any depth.
  const eventGroups: TimelineEventGroup[] = [];
  const collect = (items: TimelineItem[]) => {
    for (const i of items) {
      if (i.type !== 'eventGroup') continue;
      eventGroups.push(i.group);
      collect(i.group.items);
    }
  };
  collect(model.items);
  const isGroupExpanded = (group: TimelineEventGroup) =>
    expanded[group.key] ?? group.expanded;
  const setAllGroups = (value: boolean) =>
    setExpanded(e => ({
      ...e,
      ...Object.fromEntries(eventGroups.map(g => [g.key, value])),
    }));

  const ticks = timeTicks(
    win,
    range.start,
    Math.max(2, Math.min(10, Math.floor((width || 600) / 110))),
  );
  const nowAt = model.open ? placeTime(now, win) : undefined;
  const dragBox =
    drag &&
    placeSpan(
      {
        start: Math.min(drag.from, drag.to),
        end: Math.max(drag.from, drag.to),
      },
      { start: 0, end: 1 },
    );

  const renderRow = (row: TimelineRow, nested: boolean, depth = 0) => (
    <div
      key={row.id}
      className={tp('tp-tl-row')}
      data-selected={row.id === selectedId}
    >
      <RowLabel row={row} nested={nested} depth={depth} onSelect={select} />
      <div className={tp('tp-tl-track')}>
        <Bar
          row={row}
          win={win}
          selected={row.id === selectedId}
          onSelect={select}
          onHover={showHover}
          onLeave={hideHover}
        />
      </div>
    </div>
  );

  const renderEventGroup = (group: TimelineEventGroup): ReactNode => {
    const open = isGroupExpanded(group);
    return (
      <div key={group.key} role="group" aria-label={group.group.name}>
        <EventGroupHeader
          group={group}
          hue={hues.get(group.group.key)}
          expanded={open}
          win={win}
          onToggle={() => setExpanded(e => ({ ...e, [group.key]: !open }))}
        />
        {open &&
          group.items.map(item => {
            if (item.type === 'eventGroup') return renderEventGroup(item.group);
            if (item.type === 'row') {
              return renderRow(item.row, true, group.depth);
            }
            return null;
          })}
      </div>
    );
  };

  return (
    <div className={tp('tp-timeline')} data-testid="workflow-timeline">
      <Flex
        align="center"
        justify="between"
        gap="2"
        className={tp('tp-graph-toolbar')}
      >
        <Text variant="body-small" color="secondary">
          Drag across the chart to zoom in; Ctrl + scroll zooms, Shift + scroll
          pans.
        </Text>
        <Flex align="center" gap="2" className={tp('tp-graph-toolbar')}>
          {eventGroups.length > 1 && (
            <>
              <Button
                size="small"
                variant="secondary"
                onPress={() => setAllGroups(true)}
              >
                Expand groups
              </Button>
              <Button
                size="small"
                variant="secondary"
                onPress={() => setAllGroups(false)}
              >
                Collapse groups
              </Button>
            </>
          )}
          <Button size="small" variant="secondary" onPress={() => zoomBy(0.5)}>
            Zoom in
          </Button>
          <Button
            size="small"
            variant="secondary"
            isDisabled={!zoomed}
            onPress={() => zoomBy(2)}
          >
            Zoom out
          </Button>
          <Button
            size="small"
            variant="secondary"
            isDisabled={!zoomed}
            onPress={showWholeRun}
          >
            Whole run
          </Button>
        </Flex>
      </Flex>
      <TimelineLegend groups={eventGroups.length > 0} />
      <div
        ref={chartRef}
        className={tp('tp-tl-chart')}
        data-dragging={Boolean(drag)}
        {...chartEvents}
        role="group"
        aria-label="Workflow timeline"
      >
        <div className={tp('tp-tl-row', 'tp-tl-axis-row')}>
          <div className={tp('tp-tl-label', 'tp-muted')}>
            {zoomed
              ? `${formatOffset(win.start - range.start)} – ${formatOffset(
                  win.end - range.start,
                )}`
              : 'Step'}
          </div>
          <div
            ref={axisRef}
            className={tp('tp-tl-track', 'tp-tl-axis')}
            data-testid="timeline-axis"
          >
            {ticks.map(t => (
              <span
                key={t.at}
                className={tp('tp-tl-tick')}
                style={{ left: `${placeTime(t.at, win) ?? 0}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className={tp('tp-tl-body')}>
          <div className={tp('tp-tl-overlay')} aria-hidden>
            {ticks.map(t => (
              <span
                key={t.at}
                className={tp('tp-tl-grid')}
                style={{ left: `${placeTime(t.at, win) ?? 0}%` }}
              />
            ))}
            {nowAt !== undefined && (
              <span
                className={tp('tp-tl-now')}
                style={{ left: `${nowAt}%` }}
                data-testid="timeline-now"
              />
            )}
            {dragBox && (
              <span
                className={tp('tp-tl-selection')}
                style={{ left: `${dragBox.left}%`, width: `${dragBox.width}%` }}
              />
            )}
          </div>
          {model.items.map(item => {
            if (item.type === 'row') return renderRow(item.row, false);
            return renderEventGroup(item.group);
          })}
        </div>
        {hover && <TimelineTooltip {...hover} />}
      </div>
    </div>
  );
}
