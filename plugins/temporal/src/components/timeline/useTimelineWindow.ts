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
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  clampWindow,
  isFullWindow,
  panWindow,
  selectWindow,
  Span,
  TimelineRow,
  zoomWindow,
} from './timeline';

/** Drag distance in pixels that selects a range instead of a click. */
const DRAG_PX = 4;

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

/** The bar that the tooltip is for, and where the tooltip is in the chart. */
export type Hover = { row: TimelineRow; x: number; y: number; above: boolean };

/**
 * The part of the run that the chart shows (`win`), and what the pointer
 * does on the chart: the scroll wheel zooms and pans, a drag across the
 * chart selects the part to zoom to, and a bar under the pointer gets a
 * tooltip.
 */
export function useTimelineWindow(range: Span) {
  const [zoom, setZoom] = useState<Span | undefined>();
  const win = zoom ? clampWindow(zoom, range) : range;
  const zoomed = !isFullWindow(win, range);
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
  const zoomBy = (factor: number) =>
    setZoom(zoomWindow(win, range, 0.5, factor));

  return {
    win,
    zoomed,
    zoomBy,
    showWholeRun: () => setZoom(undefined),
    /** The fractions of the time axis that a drag covers so far. */
    drag,
    /** True from the first move of a drag until after the click that ends it. */
    dragged,
    hover,
    showHover,
    hideHover,
    chartRef,
    axisRef,
    /** Width of the time axis in pixels; 0 before it is measured. */
    width,
    chartEvents: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => {
        dragStart.current = undefined;
        dragged.current = false;
        setDrag(undefined);
      },
    },
  };
}
