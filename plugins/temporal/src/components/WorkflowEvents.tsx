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

import { useState } from 'react';
import type {
  WorkflowGraphNode,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  Button,
  Flex,
  Switch,
  Text,
  ToggleButton,
  ToggleButtonGroup,
} from '@backstage/ui';
import { formatTime } from './format';
import { kindLabel } from './steps';
import { WorkflowHistory } from './WorkflowHistory';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';
import { tp } from './styles';

/** History events grouped by step, in event order. */
export function GroupedEvents(props: {
  steps: WorkflowGraphNode[];
  showInternal: boolean;
  onSelect(id: string): void;
}) {
  const steps = props.steps.filter(
    s => s.events.length > 0 && (props.showInternal || !s.internal),
  );
  return (
    <div role="list" aria-label="Grouped events" data-testid="grouped-events">
      {steps.map(step => (
        <details key={step.id} className={tp('tp-group')} role="listitem">
          <summary>
            <WorkflowStatusLabel status={step.status} />
            <Text variant="body-medium" weight="bold">
              {step.name}
            </Text>
            <Text variant="body-small" color="secondary">
              {kindLabel(step.kind)} · {step.events.length}{' '}
              {step.events.length === 1 ? 'event' : 'events'} · #
              {step.events[0].eventId}
            </Text>
          </summary>
          <div style={{ padding: '0 0 12px 24px' }}>
            {step.events.map(e => (
              <Flex key={e.eventId} gap="3" align="center">
                <Text variant="body-small" color="secondary">
                  #{e.eventId}
                </Text>
                <Text variant="body-small">{e.eventType}</Text>
                <Text variant="body-x-small" color="secondary">
                  {formatTime(e.eventTime)}
                </Text>
              </Flex>
            ))}
            {!step.internal && (
              <Button
                size="small"
                variant="tertiary"
                onPress={() => props.onSelect(step.id)}
              >
                Show step
              </Button>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * Events of a run: grouped by step (default), or the raw history with
 * every attribute.
 */
export function WorkflowEvents(props: {
  steps: WorkflowGraphNode[];
  workflowRef: WorkflowRef;
  entityRef?: string;
  payloadsHidden: boolean;
  onSelect(id: string): void;
}) {
  const [view, setView] = useState<'grouped' | 'raw'>('grouped');
  const [showInternal, setShowInternal] = useState(false);
  return (
    <div>
      <Flex align="center" gap="4" mb="3">
        <ToggleButtonGroup
          aria-label="Event view"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[view]}
          onSelectionChange={keys => {
            const [key] = [...keys];
            if (key === 'grouped' || key === 'raw') setView(key);
          }}
        >
          <ToggleButton id="grouped" size="small">
            Grouped
          </ToggleButton>
          <ToggleButton id="raw" size="small" isDisabled={props.payloadsHidden}>
            Raw
          </ToggleButton>
        </ToggleButtonGroup>
        {view === 'grouped' && (
          <Switch
            label="Show workflow tasks"
            isSelected={showInternal}
            onChange={setShowInternal}
          />
        )}
      </Flex>
      {view === 'grouped' ? (
        <GroupedEvents
          steps={props.steps}
          showInternal={showInternal}
          onSelect={props.onSelect}
        />
      ) : (
        <WorkflowHistory
          workflowRef={props.workflowRef}
          entityRef={props.entityRef}
        />
      )}
    </div>
  );
}
