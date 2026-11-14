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
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  Edge,
  EdgeProps,
  EdgeTypes,
  getSmoothStepPath,
  Node,
  NodeTypes,
  ReactFlow,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@backstage/ui';
import {
  boxSize,
  initialViewport,
  keepInGraph,
  panIntoView,
  StepLayout,
} from './layout';

/*
 * The canvas shared by the step graph of a run and the graph of a workflow
 * definition: boxes laid out by `layoutSteps`, the view they open with
 * (readable zoom, the selected box moved into view), and the view buttons.
 */

/** Zoom limits for zooming by hand; the views the graph opens with stay readable. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2;
/**
 * Time the graph area keeps its width before the graph is laid out again
 * for it, so resizing the window or the step panel does not re-layout on
 * every frame.
 *
 * @alpha
 */
export const RELAYOUT_DELAY_MS = 150;

/**
 * An arrow into a later row of a wrapped graph. A plain smooth step turns
 * halfway between its two ends, which can run along the boxes of a taller
 * column in the source row; this one turns in the gap between the rows.
 */
function RowGapEdge(props: EdgeProps<Edge<{ centerY: number }>>) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    centerY: props.data?.centerY,
  });
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
    />
  );
}

const edgeTypes: EdgeTypes = { rowGap: RowGapEdge };

/**
 * The edges of a wrapped graph: a smooth step into a later row turns in the
 * gap below the row of its source.
 */
export function routeRowGaps(layout: StepLayout, edges: Edge[]): Edge[] {
  const gaps = layout.rowGaps;
  if (!gaps?.length) return edges;
  return edges.map(edge => {
    if (edge.type !== 'smoothstep') return edge;
    const source = layout.positions.get(edge.source);
    const target = layout.positions.get(edge.target);
    if (!source || !target) return edge;
    const centerY = gaps.find(g => g > source.y && g < target.y);
    if (centerY === undefined) return edge;
    return { ...edge, type: 'rowGap', data: { ...edge.data, centerY } };
  });
}

/**
 * Position and size of a laid out box, as React Flow takes them.
 *
 * @alpha
 */
export function flowNodeBase(layout: StepLayout, id: string) {
  const size = boxSize(layout, id);
  return {
    id,
    position: layout.positions.get(id) ?? { x: 0, y: 0 },
    width: size.width,
    height: size.height,
    draggable: false,
    connectable: false,
    selectable: false,
  };
}

/**
 * Props of {@link GraphCanvas}.
 *
 * @alpha
 */
export interface GraphCanvasProps<N extends Node> {
  nodes: N[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  layout: StepLayout;
  /** Changes when the layout changes, so the view is set again. */
  layoutKey: string;
  /** The width the graph was laid out for. */
  layoutWidth?: number;
  selectedId?: string;
  /**
   * A box to bring into view when nothing is selected (the round frame of
   * an expanded loop).
   */
  focusId?: string;
  onSelect(id: string | undefined): void;
  /** Boxes that pressing selects; by default every box. */
  selectable?(node: N): boolean;
}

/**
 * React Flow canvas of laid out boxes. It opens at a readable size and sets
 * the view again when the layout changes (boxes added by auto refresh) or
 * the area gets narrower or wider (a panel opened or closed). The selected
 * box is moved into view without cutting off the first column.
 *
 * @alpha
 */
export function GraphCanvas<N extends Node>(props: GraphCanvasProps<N>) {
  const { layout, onSelect } = props;
  const edges = useMemo(
    () => routeRowGaps(layout, props.edges),
    [layout, props.edges],
  );
  // The selected box, else the focused one, is moved into view.
  const target = props.selectedId ?? props.focusId;
  const flow = useReactFlow<N, Edge>();
  const width = useStore(s => s.width);
  const height = useStore(s => s.height);
  const zoom = useStore(s => s.transform[2]);
  const domNode = useStore(s => s.domNode);

  // The graph area grows with the layout, so a box can be below the
  // window: once a new target is laid out, the page scrolls to it too
  // (nothing moves when it is already in sight).
  const scrolledTo = useRef<string>();
  const targetLaidOut = target ? layout.positions.has(target) : false;
  useEffect(() => {
    if (!target) {
      scrolledTo.current = undefined;
      return undefined;
    }
    if (!targetLaidOut || scrolledTo.current === target) return undefined;
    // After the canvas height and the view follow the new layout.
    const timer = window.setTimeout(() => {
      const element = domNode?.querySelector(
        `.react-flow__node[data-id="${target.replace(/["\\]/g, '\\$&')}"]`,
      );
      if (!element) return;
      scrolledTo.current = target;
      element.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [target, targetLaidOut, domNode]);

  // While the area changes width a new layout follows, so the view waits
  // for it.
  const applied = useRef<{
    key?: string;
    target?: string;
    width?: number;
  }>({});
  const targetPosition = target ? layout.positions.get(target) : undefined;
  const relayoutPending =
    props.layoutWidth !== undefined && Math.abs(width - props.layoutWidth) > 1;
  useEffect(() => {
    if (!width || !height || relayoutPending) return undefined;
    const last = applied.current;
    // A new layout, or the same one in an area of another width.
    const relayout =
      last.key !== props.layoutKey ||
      last.width === undefined ||
      Math.abs(last.width - width) > 1;
    if (!relayout && last.target === target) return undefined;
    const first = last.key === undefined;
    const run = () => {
      applied.current = { key: props.layoutKey, target, width };
      const canvas = { width, height };
      const current = flow.getViewport();
      let next = relayout ? initialViewport(layout, canvas) : current;
      if (targetPosition && target) {
        next = panIntoView(
          next,
          targetPosition,
          canvas,
          boxSize(layout, target),
        );
      }
      next = keepInGraph(next, layout, canvas);
      if (
        next.x !== current.x ||
        next.y !== current.y ||
        next.zoom !== current.zoom
      ) {
        flow.setViewport(next, { duration: first ? 0 : 200 });
      }
    };
    if (first) {
      run();
      return undefined;
    }
    // The canvas height follows the new layout a moment later.
    const timer = window.setTimeout(run, 50);
    return () => window.clearTimeout(timer);
  }, [
    flow,
    props.layoutKey,
    layout,
    width,
    height,
    target,
    targetPosition,
    relayoutPending,
  ]);

  // Wheel scrolling pans a graph larger than its area; otherwise it
  // scrolls the page.
  const overflows =
    layout.width * zoom > width + 1 || layout.height * zoom > height + 1;
  const { selectable } = props;

  return (
    <ReactFlow<N, Edge>
      nodes={props.nodes}
      edges={edges}
      nodeTypes={props.nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      zoomOnScroll={false}
      panOnScroll={overflows}
      preventScrolling={overflows}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => {
        if (!selectable || selectable(node)) onSelect(node.id);
      }}
      onPaneClick={() => onSelect(undefined)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls
        showInteractive={false}
        fitViewOptions={{
          padding: 0.05,
          minZoom: MIN_ZOOM,
          maxZoom: 1,
          duration: 200,
        }}
        orientation="horizontal"
        position="bottom-right"
      />
    </ReactFlow>
  );
}

/**
 * Full screen of a graph and the panel next to it.
 *
 * @alpha
 */
export interface GraphFullscreen {
  fullscreen: boolean;
  toggle(): void;
}

/**
 * Given by the area that can go full screen (the graph and its step
 * panel); without it the graph has no full screen button.
 *
 * @alpha
 */
export const GraphFullscreenContext = createContext<
  GraphFullscreen | undefined
>(undefined);

/**
 * The full screen state of a graph area, for its context.
 *
 * @alpha
 */
export function useGraphFullscreenState(): GraphFullscreen {
  const [fullscreen, setFullscreen] = useState(false);
  const current = useRef(false);
  current.current = fullscreen;
  useEffect(() => {
    if (!fullscreen) return undefined;
    // The browser leaves full screen on Esc; follow it.
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    // Without the browser's full screen (not allowed, or not supported),
    // Esc leaves the area that covers the window.
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.fullscreenElement
      ) {
        setFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);
  const toggle = useCallback(() => {
    const next = !current.current;
    setFullscreen(next);
    // The whole page goes full screen, not only the graph: menus and
    // tooltips open outside the graph area and must stay visible. The area
    // covers the window with CSS.
    const root = document.documentElement;
    if (next && !document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen().catch(() => undefined);
    } else if (!next && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => undefined);
    }
  }, []);
  return useMemo(() => ({ fullscreen, toggle }), [fullscreen, toggle]);
}

/**
 * The full screen state around a graph, when it can go full screen.
 *
 * @alpha
 */
export function useGraphFullscreen(): GraphFullscreen | undefined {
  return useContext(GraphFullscreenContext);
}

/**
 * "Full screen", in an area that can go full screen. Zooming is with the
 * graph's own controls (zoom in, zoom out, fit the whole graph); the graph
 * opens at a readable size.
 *
 * @alpha
 */
export function ViewButtons() {
  const fullscreen = useGraphFullscreen();
  if (!fullscreen) return null;
  return (
    <Button
      size="small"
      variant="secondary"
      aria-pressed={fullscreen.fullscreen}
      onPress={fullscreen.toggle}
    >
      {fullscreen.fullscreen ? 'Exit full screen' : 'Full screen'}
    </Button>
  );
}

/**
 * A ref callback and the width of its element. The first width is taken
 * at once; later changes once the width has stayed the same for `delay`
 * milliseconds, so a width that is still changing (window resize) is laid
 * out only once. When `trigger` changes (the step panel opened or closed),
 * the width is read again at once, before the browser paints: the panel
 * changes the width in one step, and waiting would show the old layout
 * under the panel until the delay ends (longer while a large payload in
 * the panel renders).
 *
 * @alpha
 */
export function useSettledWidth(
  delay: number,
  trigger?: unknown,
): [(element: HTMLElement | null) => void, number?] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>();
  const firstTrigger = useRef(true);
  useLayoutEffect(() => {
    if (firstTrigger.current) {
      firstTrigger.current = false;
      return;
    }
    const next = element?.clientWidth || undefined;
    if (next !== undefined) {
      setWidth(last =>
        last !== undefined && Math.abs(next - last) < 1 ? last : next,
      );
    }
  }, [trigger, element]);
  useEffect(() => {
    if (!element) return undefined;
    const read = () => element.clientWidth || undefined;
    setWidth(read());
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = read();
        setWidth(last =>
          next !== undefined && last !== undefined && Math.abs(next - last) < 1
            ? last
            : next,
        );
      }, delay);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [element, delay]);
  return [setElement, width];
}
