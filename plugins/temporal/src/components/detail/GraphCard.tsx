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

import { Alert, Card, CardBody, CardHeader, Flex, Text } from '@backstage/ui';
import type {
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowRef,
  WorkflowRunRef,
} from '../../common';
import { ErrorAlert, Loading } from '../feedback';
import {
  GraphFullscreenContext,
  useGraphFullscreenState,
} from '../graph/GraphCanvas';
import type { GroupViews } from '../graph/eventGroups';
import { GroupDisplay, WorkflowGraph } from '../graph/WorkflowGraph';
import { StepDrawer } from '../StepDrawer';
import { tp } from '../styles';
import { stepsDoneText } from '../WorkflowProgress';

/**
 * The Steps card of the details page: the graph of the run, with the step
 * panel next to it for the selected step.
 */
export function GraphCard(props: {
  graph?: WorkflowGraphResponse;
  graphError?: Error;
  selected?: WorkflowGraphNode;
  /** Shows the step drawer next to the graph. */
  showDrawer: boolean;
  onSelect(id: string | undefined): void;
  /** Selects a step from the step panel (a tool call of a model call). */
  onSelectStep(id: string): void;
  workflowRef: WorkflowRunRef;
  entityRef?: string;
  workflowHref(ref: WorkflowRef): string;
  showMarkers: boolean;
  onShowMarkersChange(show: boolean): void;
  groupViews: GroupViews;
  onGroupViewChange(key: string, expanded: boolean | undefined): void;
  focusGroup?: { key: string };
  onGroupDisplay(display: GroupDisplay): void;
}) {
  const { graph, graphError, selected, onSelect } = props;
  const showDrawer = Boolean(selected) && props.showDrawer;
  const fullscreen = useGraphFullscreenState();
  return (
    <Card>
      <CardHeader>
        <Flex align="center" justify="between" gap="2">
          <Text as="h3" variant="title-small" style={{ margin: 0 }}>
            Steps
          </Text>
          {graph && graph.totalSteps > 0 && (
            <Text variant="body-small" color="secondary">
              {graph.status === 'Running'
                ? stepsDoneText(graph.completedSteps)
                : `${graph.completedSteps} of ${graph.totalSteps} steps done`}
            </Text>
          )}
        </Flex>
      </CardHeader>
      <CardBody>
        {graphError && (
          <div style={graph ? { marginBottom: 12 } : undefined}>
            <ErrorAlert
              title={graph ? 'Could not refresh graph' : undefined}
              error={graphError}
            />
          </div>
        )}
        {!graph && !graphError && <Loading label="Loading graph" />}
        {graph?.truncated && (
          <Alert
            status="info"
            icon
            title="The history is long; the graph shows its first events."
            style={{ marginBottom: 12 }}
          />
        )}
        {graph?.eventGroupsTruncated && (
          <Alert
            status="info"
            icon
            title="The run has more event groups than the backend reads; some groups are left out."
            style={{ marginBottom: 12 }}
          />
        )}
        {graph && (
          <GraphFullscreenContext.Provider value={fullscreen}>
            <div
              className={tp('tp-graph-layout')}
              data-testid="workflow-graph-layout"
              data-fullscreen={fullscreen.fullscreen}
            >
              <WorkflowGraph
                graph={graph}
                selectedId={selected?.id}
                onSelect={onSelect}
                showMarkers={props.showMarkers}
                onShowMarkersChange={props.onShowMarkersChange}
                groupViews={props.groupViews}
                onGroupViewChange={props.onGroupViewChange}
                focusGroup={props.focusGroup}
                onGroupDisplay={props.onGroupDisplay}
                panelOpen={showDrawer}
              />
              {showDrawer && selected && (
                <StepDrawer
                  step={selected}
                  workflowHref={props.workflowHref}
                  onClose={() => onSelect(undefined)}
                  nodes={graph.nodes}
                  workflowRef={props.workflowRef}
                  entityRef={props.entityRef}
                  onSelectStep={props.onSelectStep}
                />
              )}
            </div>
          </GraphFullscreenContext.Provider>
        )}
      </CardBody>
    </Card>
  );
}
