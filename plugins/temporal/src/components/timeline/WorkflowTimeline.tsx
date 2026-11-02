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

import {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  WorkflowGraphResponse,
  WorkflowStatus,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { Button, Flex, Text } from '@backstage/ui';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { formatTime } from '../format';
import { decisionText, roundLabel } from '../loopText';
import { kindLabel } from '../steps';
import { statusLabel } from '../WorkflowStatusLabel';
import { tp } from '../styles';
import {
  buildTimeline,
  clampWindow,
  formatOffset,
  isFullWindow,
  panWindow,
  placeSpan,
  placeTime,
  selectWindow,
  Span,
  TimelineGroup,
  TimelineRow,
  timeTicks,
  zoomWindow,
} from './timeline';

export interface WorkflowTimelineProps {
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

/** Drag distance in pixels that selects a range instead of a click. */
const DRAG_PX = 4;

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

/** Width of an element, followed while it changes. */
function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function duration(span?: Span): string {
  return span ? formatOffset(span.end - span.start) : '';
}

function retryText(retries: number): string {
  return retries === 1 ? '1 retry' : `${retries} retries`;
}

/** Name of a row: the step, or `Run` for the row of the whole run. */
function rowName(row: TimelineRow): string {
  if (row.node.kind === 'workflowStarted') return 'Run';
  return row.node.name || kindLabel(row.node.kind);
}

/** Text of a row for screen readers and the bar's label. */
function rowLabel(row: TimelineRow): string {
  const { node } = row;
  const parts = [rowName(row), statusLabel(node.status)];
  if (row.queued) parts.push(`queued ${duration(row.queued)}`);
  if (row.run && row.shape === 'bar') {
    parts.push(
      `${row.dashed ? 'waited' : 'ran'} ${duration(row.run)}${
        row.open ? ' so far' : ''
      }`,
    );
  }
  if (row.retries) parts.push(retryText(row.retries));
  return parts.join(', ');
}

function Tooltip(props: {
  row: TimelineRow;
  x: number;
  y: number;
  above: boolean;
}) {
  const { row } = props;
  const { node } = row;
  const items: [string, ReactNode][] = [
    ['Status', statusLabel(node.status)],
    ['Waiting for', node.waitingFor],
    [
      'Scheduled',
      row.queued
        ? formatTime(new Date(row.queued.start).toISOString())
        : undefined,
    ],
    [
      row.shape === 'point' ? 'At' : 'Started',
      formatTime(
        new Date(row.at ?? row.run?.start ?? row.span.start).toISOString(),
      ),
    ],
    [
      'Ended',
      row.shape === 'bar' && !row.open
        ? formatTime(new Date(row.span.end).toISOString())
        : undefined,
    ],
    ['Queued', row.queued ? duration(row.queued) : undefined],
    [
      row.dashed ? 'Waited' : 'Ran',
      row.shape === 'bar' && row.run
        ? `${duration(row.run)}${row.open ? ' so far' : ''}`
        : undefined,
    ],
    [
      'Attempt',
      node.attempt
        ? `${node.attempt}${
            node.maximumAttempts ? ` of ${node.maximumAttempts}` : ''
          }${row.retries ? ` (${retryText(row.retries)})` : ''}`
        : undefined,
    ],
    ['Error', node.failure?.message],
  ];
  return (
    <div
      className={tp('tp-tl-tooltip')}
      style={
        props.above
          ? { left: props.x, bottom: props.y }
          : { left: props.x, top: props.y }
      }
      role="tooltip"
      data-testid="timeline-tooltip"
    >
      <div className={tp('tp-tl-tooltip-title')}>{rowName(row)}</div>
      <div className={tp('tp-muted')}>{kindLabel(node.kind)}</div>
      <dl className={tp('tp-dl')}>
        {items
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

type Hover = { row: TimelineRow; x: number; y: number; above: boolean };

function Bar(props: {
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

function RowLabel(props: {
  row: TimelineRow;
  nested: boolean;
  onSelect(id: string): void;
}) {
  const { row } = props;
  const name = rowName(row);
  return (
    // The bar is the button; a click on the name selects the step too.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={tp('tp-tl-label')}
      data-nested={props.nested}
      onClick={() => props.onSelect(row.id)}
      title={`${name} · ${kindLabel(row.node.kind)}`}
    >
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

function GroupHeader(props: {
  group: TimelineGroup;
  expanded: boolean;
  win: Span;
  onToggle(): void;
}) {
  const { group, win } = props;
  const place = placeSpan(group.span, win);
  const decision = decisionText(group.round);
  const label = `${group.loop.name} · ${roundLabel(
    group.round.iteration,
    group.loop,
  )}`;
  return (
    <div
      className={tp('tp-tl-row', 'tp-tl-group')}
      data-testid={`timeline-round-${group.key}`}
    >
      <div className={tp('tp-tl-label')}>
        <button
          type="button"
          className={tp('tp-tl-toggle')}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          title={decision || undefined}
        >
          {props.expanded ? (
            <RiArrowDownSLine size={16} aria-hidden />
          ) : (
            <RiArrowRightSLine size={16} aria-hidden />
          )}
          <span className={tp('tp-tl-name')}>{label}</span>
          <span className={tp('tp-muted')}>
            {props.expanded ? '' : ` · ${group.rows.length} steps`}
          </span>
        </button>
      </div>
      <div className={tp('tp-tl-track')}>
        {place && (
          <div
            className={tp('tp-tl-group-bar', `tp-tone-${group.tone}`)}
            data-expanded={props.expanded}
            style={{ left: `${place.left}%`, width: `${place.width}%` }}
            title={[label, statusLabel(group.round.status), decision]
              .filter(Boolean)
              .join(' · ')}
          />
        )}
      </div>
    </div>
  );
}

function Legend() {
  const item = (cls: string, text: string, tone = 'tp-tone-success') => (
    <span className={tp('tp-tl-legend-item')}>
      <span className={tp('tp-tl-legend-swatch', cls, tone)} aria-hidden />
      {text}
    </span>
  );
  return (
    <div className={tp('tp-tl-legend')} aria-label="Legend">
      {item('tp-tl-legend-queued', 'Queued')}
      {item('tp-tl-legend-run', 'Running or done')}
      {item('tp-tl-legend-run', 'Failed', 'tp-tone-danger')}
      {item('tp-tl-legend-wait', 'Timer or wait', 'tp-tone-neutral')}
      {item('tp-tl-legend-point', 'Signal or update', 'tp-tone-info')}
    </div>
  );
}

/**
 * The steps of a run on a time axis: one bar per step with the time it
 * waited for a worker (queued) and the time it ran, dashed bars for timers
 * and waits, and points for signals and updates. Rounds of a loop are
 * grouped and can be collapsed. Drag across the chart, or scroll with Ctrl
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
  const range = model.range;
  const [zoom, setZoom] = useState<Span | undefined>();
  const win = zoom ? clampWindow(zoom, range) : range;
  const zoomed = !isFullWindow(win, range);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<Hover | undefined>();
  const [drag, setDrag] = useState<{ from: number; to: number } | undefined>();

  const chartRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const width = useWidth(axisRef);
  const dragStart = useRef<{ x: number; fraction: number; id: number }>();
  const dragged = useRef(false);
  const latest = useRef({ win, range });
  latest.current = { win, range };

  const fractionAt = useCallback((clientX: number) => {
    const rect = axisRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return undefined;
    return {
      fraction: (clientX - rect.left) / rect.width,
      inside: clientX >= rect.left && clientX <= rect.right,
    };
  }, []);

  // Ctrl or ⌘ + scroll zooms around the pointer; a sideways scroll (or
  // Shift + scroll) pans a zoomed chart. Other scrolling moves the page.
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      const at = fractionAt(e.clientX);
      if (!at) return;
      const { win: w, range: r } = latest.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(zoomWindow(w, r, at.fraction, e.deltaY > 0 ? 1.25 : 0.8));
        return;
      }
      const sideways = e.shiftKey ? e.deltaY : e.deltaX;
      if (sideways && !isFullWindow(w, r)) {
        e.preventDefault();
        const rect = axisRef.current!.getBoundingClientRect();
        setZoom(panWindow(w, r, sideways / rect.width));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fractionAt]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const at = fractionAt(e.clientX);
    if (!at?.inside) return;
    dragStart.current = {
      x: e.clientX,
      fraction: at.fraction,
      id: e.pointerId,
    };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.id !== e.pointerId) return;
    if (!dragged.current && Math.abs(e.clientX - start.x) < DRAG_PX) return;
    if (!dragged.current) {
      dragged.current = true;
      setHover(undefined);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const at = fractionAt(e.clientX);
    if (at) setDrag({ from: start.fraction, to: at.fraction });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = undefined;
    if (!start || !dragged.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const at = fractionAt(e.clientX);
    setDrag(undefined);
    if (at) setZoom(selectWindow(win, range, start.fraction, at.fraction));
    // The click that ends a drag does not select a step.
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  };

  const select = useCallback(
    (id: string) => {
      if (dragged.current) return;
      onSelect(id === selectedId ? undefined : id);
    },
    [onSelect, selectedId],
  );
  const showHover = useCallback(
    (row: TimelineRow, target: Element, event?: ReactMouseEvent) => {
      const chart = chartRef.current?.getBoundingClientRect();
      if (!chart || dragStart.current) return;
      const box = target.getBoundingClientRect();
      const x = (event?.clientX ?? box.left + box.width / 2) - chart.left;
      const y = (event ? event.clientY : box.bottom) - chart.top;
      // Keep the tooltip inside the chart: below the pointer in the upper
      // half, above it in the lower half.
      const above = y > chart.height / 2;
      setHover({
        row,
        x: Math.max(0, Math.min(x + 12, chart.width - 300)),
        y: above ? chart.height - y + 12 : y + 16,
        above,
      });
    },
    [],
  );
  const hideHover = useCallback(() => setHover(undefined), []);

  const isExpanded = (group: TimelineGroup) =>
    expanded[group.key] ?? group.latest;
  const groups = model.items.flatMap(i =>
    i.type === 'group' ? [i.group] : [],
  );
  const setAll = (value: boolean) =>
    setExpanded(Object.fromEntries(groups.map(g => [g.key, value])));

  const zoomBy = (factor: number) =>
    setZoom(zoomWindow(win, range, 0.5, factor));
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

  const renderRow = (row: TimelineRow, nested: boolean) => (
    <div
      key={row.id}
      className={tp('tp-tl-row')}
      data-selected={row.id === selectedId}
    >
      <RowLabel row={row} nested={nested} onSelect={select} />
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
          {groups.length > 1 && (
            <>
              <Button
                size="small"
                variant="secondary"
                onPress={() => setAll(true)}
              >
                Expand rounds
              </Button>
              <Button
                size="small"
                variant="secondary"
                onPress={() => setAll(false)}
              >
                Collapse rounds
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
            onPress={() => setZoom(undefined)}
          >
            Whole run
          </Button>
        </Flex>
      </Flex>
      <Legend />
      <div
        ref={chartRef}
        className={tp('tp-tl-chart')}
        data-dragging={Boolean(drag)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = undefined;
          dragged.current = false;
          setDrag(undefined);
        }}
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
            const { group } = item;
            const open = isExpanded(group);
            return (
              <div key={group.key} role="group" aria-label={group.key}>
                <GroupHeader
                  group={group}
                  expanded={open}
                  win={win}
                  onToggle={() =>
                    setExpanded(e => ({ ...e, [group.key]: !open }))
                  }
                />
                {open && group.rows.map(row => renderRow(row, true))}
              </div>
            );
          })}
        </div>
        {hover && <Tooltip {...hover} />}
      </div>
    </div>
  );
}
