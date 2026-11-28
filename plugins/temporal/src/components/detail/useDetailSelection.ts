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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WorkflowEventGroup, WorkflowGraphNode } from '../../common';
import {
  DEFAULT_DETAIL_TAB,
  isLinkableStep,
  resolveDetailStep,
  withDetailStep,
  withDetailTab,
} from '../detailState';
import type { GroupViews } from '../graph/eventGroups';
import type { GroupDisplay } from '../graph/WorkflowGraph';
import { isMarkerStep } from '../steps';

/**
 * What is selected and shown on the details page of a run: the tab and
 * the step in the URL, where the step panel is (next to the graph or next
 * to the timeline), the markers, and the event groups that are expanded.
 *
 * `runKey` identifies the run, `nodes` and `eventGroups` are those of its
 * graph once it is read.
 */
export function useDetailSelection(options: {
  runKey: string;
  nodes?: WorkflowGraphNode[];
  eventGroups?: WorkflowEventGroup[];
}) {
  const { runKey, nodes, eventGroups } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  // Local fallback only for non-linkable steps (synthetic `waiting` nodes).
  const [ephemeralStep, setEphemeralStep] = useState<{
    runKey: string;
    id: string;
  }>();
  // Where to mount the step drawer (graph vs timeline) so only one renders at a time.
  const [drawerChoice, setDrawerChoice] = useState<{
    runKey: string;
    where: 'graph' | 'timeline';
  }>();
  const revealedStepRef = useRef<string>();
  const [showMarkers, setShowMarkers] = useState(false);
  // Temporal event groups the user expanded or collapsed, and the group
  // picked in the Event Groups tab.
  const [groupViews, setGroupViews] = useState<GroupViews>({});
  const [focusGroup, setFocusGroup] = useState<{ key: string }>();
  // How the graph draws each group, for the Event Groups tab.
  const [groupDisplay, setGroupDisplay] = useState<GroupDisplay>();
  const showGroupDisplay = useCallback(
    (display: GroupDisplay) =>
      setGroupDisplay(last =>
        last && JSON.stringify(last) === JSON.stringify(display)
          ? last
          : display,
      ),
    [],
  );
  const setGroupView = useCallback(
    (key: string, expanded: boolean | undefined) =>
      setGroupViews(({ [key]: _old, ...views }) =>
        expanded === undefined ? views : { ...views, [key]: expanded },
      ),
    [],
  );
  const graphRef = useRef<HTMLDivElement>(null);
  const urlSelectedNode = useMemo(
    () => resolveDetailStep(searchParams, nodes),
    [searchParams, nodes],
  );
  const ephemeralNode = useMemo(
    () =>
      ephemeralStep?.runKey === runKey
        ? nodes?.find(n => n.id === ephemeralStep.id && !n.internal)
        : undefined,
    [ephemeralStep, runKey, nodes],
  );
  const selectedNode = ephemeralNode ?? urlSelectedNode;
  // A step picked outside the graph: its groups are expanded.
  const openGroupsOf = useCallback(
    (id: string) => {
      const keys = nodes?.find(n => n.id === id)?.groups ?? [];
      // Unchanged when they are open already: no new layout.
      setGroupViews(views =>
        keys.every(k => views[k])
          ? views
          : { ...views, ...Object.fromEntries(keys.map(k => [k, true])) },
      );
    },
    [nodes],
  );
  const revealStep = useCallback(
    (id: string) => {
      const node = nodes?.find(n => n.id === id);
      if (node && isMarkerStep(node)) setShowMarkers(true);
      openGroupsOf(id);
    },
    [nodes, openGroupsOf],
  );
  // Place the drawer of a deep-linked step and reveal it once per URL
  // selection, so later tab changes do not move the drawer and later manual
  // toggles of markers or group boxes are not overridden.
  useEffect(() => {
    if (!urlSelectedNode || ephemeralNode) return;
    const key = `${runKey}\0${urlSelectedNode.id}`;
    if (revealedStepRef.current === key) return;
    revealedStepRef.current = key;
    if (searchParams.get('tab') === 'timeline') {
      setDrawerChoice({ runKey, where: 'timeline' });
      // The timeline shows markers only with the switch on; the graph's
      // groups are left as they are.
      if (isMarkerStep(urlSelectedNode)) setShowMarkers(true);
    } else {
      setDrawerChoice({ runKey, where: 'graph' });
      revealStep(urlSelectedNode.id);
    }
  }, [runKey, urlSelectedNode, ephemeralNode, revealStep, searchParams]);
  const setTab = useCallback(
    (nextTab: string) => {
      const normalized = nextTab === DEFAULT_DETAIL_TAB ? null : nextTab;
      if (searchParams.get('tab') === normalized) return;
      // A step picked in the timeline belongs to the Timeline tab: it is
      // unselected when the tab is left. One updater for both params, because
      // a second call in the same event would start from the same params.
      const dropStep =
        searchParams.get('tab') === 'timeline' &&
        drawerChoice?.runKey === runKey &&
        drawerChoice.where === 'timeline';
      if (dropStep) {
        setEphemeralStep(undefined);
        revealedStepRef.current = undefined;
      }
      setSearchParams(
        current => {
          const next = withDetailTab(current, nextTab);
          return dropStep ? withDetailStep(next, undefined) : next;
        },
        { replace: true },
      );
    },
    [drawerChoice, runKey, searchParams, setSearchParams],
  );
  const selectStep = useCallback(
    (id: string | undefined) => {
      if (!id) {
        setEphemeralStep(undefined);
        revealedStepRef.current = undefined;
        if (searchParams.has('step')) {
          setSearchParams(current => withDetailStep(current, undefined), {
            replace: true,
          });
        }
        return;
      }
      const node = nodes?.find(n => n.id === id);
      if (node && !isLinkableStep(node)) {
        setEphemeralStep({ runKey, id });
        revealedStepRef.current = undefined;
        if (searchParams.has('step')) {
          setSearchParams(current => withDetailStep(current, undefined), {
            replace: true,
          });
        }
        return;
      }
      setEphemeralStep(undefined);
      revealedStepRef.current = `${runKey}\0${id}`;
      if (searchParams.get('step') !== id) {
        setSearchParams(current => withDetailStep(current, id), {
          replace: true,
        });
      }
    },
    [nodes, runKey, searchParams, setSearchParams],
  );
  const selectInPlace = useCallback(
    (where: 'graph' | 'timeline', id: string | undefined) => {
      if (id !== undefined) {
        setDrawerChoice({ runKey, where });
      }
      selectStep(id);
    },
    [runKey, selectStep],
  );
  const selectFromGraph = useCallback(
    (id: string | undefined) => selectInPlace('graph', id),
    [selectInPlace],
  );
  const selectFromTimeline = useCallback(
    (id: string | undefined) => selectInPlace('timeline', id),
    [selectInPlace],
  );
  const scrollToGraph = useCallback(
    () =>
      graphRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      }),
    [],
  );
  const selectFromTab = useCallback(
    (id: string) => {
      // A marker picked in the events is shown in the graph.
      revealStep(id);
      selectFromGraph(id);
      scrollToGraph();
    },
    [revealStep, selectFromGraph, scrollToGraph],
  );
  // A step picked in the step panel: selected and shown in its groups.
  const selectInGraph = useCallback(
    (id: string) => {
      revealStep(id);
      selectFromGraph(id);
    },
    [revealStep, selectFromGraph],
  );
  // A group picked in the Event Groups tab: expanded with the groups
  // around it and brought into view.
  const showGroup = useCallback(
    (key: string) => {
      const byKey = new Map((eventGroups ?? []).map(g => [g.key, g]));
      const open: Record<string, boolean> = {};
      for (
        let g = byKey.get(key);
        g && !(g.key in open);
        g = g.parent ? byKey.get(g.parent) : undefined
      ) {
        open[g.key] = true;
      }
      setGroupViews(views => ({ ...views, ...open }));
      setFocusGroup({ key });
      selectStep(undefined);
      scrollToGraph();
    },
    [eventGroups, scrollToGraph, selectStep],
  );

  return {
    searchParams,
    /** The element to scroll to when a step or a group is shown in the graph. */
    graphRef,
    selectedNode,
    /** Where the user last selected a step of this run, if anywhere. */
    drawerPlace:
      drawerChoice?.runKey === runKey ? drawerChoice.where : undefined,
    showMarkers,
    setShowMarkers,
    groupViews,
    setGroupView,
    focusGroup,
    groupDisplay,
    showGroupDisplay,
    setTab,
    selectFromGraph,
    selectFromTimeline,
    selectFromTab,
    selectInGraph,
    showGroup,
  };
}
