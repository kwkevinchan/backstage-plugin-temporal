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

import { Alert } from '@backstage/ui';
import type {
  WorkflowDetail,
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowRef,
  WorkflowRunRef,
} from '../../common';
import { StepDrawer } from '../StepDrawer';
import { tp } from '../styles';
import { WorkflowTimeline } from '../timeline/WorkflowTimeline';

/**
 * The Timeline tab: the steps on a time axis, with the step panel of the
 * graph next to it for the selected bar.
 */
export function TimelineTab(props: {
  graph: WorkflowGraphResponse;
  workflow: WorkflowDetail;
  showMarkers: boolean;
  live: boolean;
  selected?: WorkflowGraphNode;
  showDrawer: boolean;
  onSelect(id: string | undefined): void;
  onSelectStep(id: string): void;
  workflowRef: WorkflowRunRef;
  workflowHref(ref: WorkflowRef): string;
  entityRef?: string;
}) {
  const { graph, selected, onSelect } = props;
  const showDrawer = Boolean(selected) && props.showDrawer;
  return (
    <div className={tp('tp-graph-layout')}>
      <div className={tp('tp-graph-column')}>
        {graph.truncated && (
          <Alert
            status="info"
            icon
            title="The history is long; the timeline shows its first events."
          />
        )}
        <WorkflowTimeline
          graph={graph}
          workflow={props.workflow}
          showMarkers={props.showMarkers}
          selectedId={selected?.id}
          onSelect={onSelect}
          live={props.live}
        />
      </div>
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
  );
}
