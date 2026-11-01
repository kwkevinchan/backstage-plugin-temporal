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

import type { ReactNode } from 'react';
import type {
  WorkflowGraphNode,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { ButtonIcon, Flex, Link, Text } from '@backstage/ui';
import { RiCloseLine } from '@remixicon/react';
import { FailureView } from './FailureView';
import { formatDuration, formatTime } from './format';
import { JsonView, PayloadView } from './PayloadView';
import { kindLabel } from './steps';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';
import { tp } from './styles';

function Section(props: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={tp('tp-section')} data-testid={props.testId}>
      <Text as="h4" variant="title-x-small" style={{ margin: '0 0 6px' }}>
        {props.title}
      </Text>
      {props.children}
    </section>
  );
}

/** Rows of a definition list; empty values are left out. */
export function DefinitionList(props: { items: [string, ReactNode][] }) {
  const items = props.items.filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return (
    <dl className={tp('tp-dl')}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface StepDrawerProps {
  step: WorkflowGraphNode;
  payloadsHidden: boolean;
  /** Link to the details page of another run (child, next run). */
  workflowHref(ref: WorkflowRef): string;
  onClose(): void;
}

/**
 * Details of one step next to the graph: input, output, error, attempts
 * and the events it was built from.
 */
export function StepDrawer(props: StepDrawerProps) {
  const { step, payloadsHidden, workflowHref, onClose } = props;
  const duration =
    step.startTime && step.startTime !== step.endTime
      ? formatDuration(step.startTime, step.endTime)
      : '';
  const attempt = step.attempt
    ? `${step.attempt}${
        step.maximumAttempts ? ` of ${step.maximumAttempts}` : ''
      }`
    : undefined;
  const linked = step.workflow;
  const hasInput = step.input !== undefined;
  const hasResult = step.result !== undefined;
  const showsPayloads = !['waiting', 'cancelRequest'].includes(step.kind);

  return (
    <aside
      className={tp('tp-drawer')}
      aria-label={`Step ${step.name}`}
      data-testid="step-drawer"
    >
      <Flex align="start" justify="between" gap="2">
        <div style={{ minWidth: 0 }}>
          <Text as="p" variant="body-x-small" color="secondary">
            {kindLabel(step.kind)}
          </Text>
          <Text
            as="h3"
            variant="title-small"
            style={{ margin: 0, wordBreak: 'break-word' }}
          >
            {step.name}
          </Text>
          <div style={{ marginTop: 4 }}>
            <WorkflowStatusLabel status={step.status} />
          </div>
        </div>
        <ButtonIcon
          aria-label="Close step details"
          variant="tertiary"
          icon={<RiCloseLine />}
          onPress={onClose}
        />
      </Flex>

      <div className={tp('tp-section')}>
        <DefinitionList
          items={[
            ['Waiting for', step.waitingFor],
            ['ID', step.stepId],
            ['Started', formatTime(step.startTime)],
            [
              'Ended',
              step.endTime !== step.startTime ? formatTime(step.endTime) : '',
            ],
            ['Duration', duration],
            ['Attempt', attempt],
            [
              step.kind === 'workflowClosed' ? 'Next run' : 'Workflow',
              linked ? (
                <Link href={workflowHref(linked)}>
                  {linked.workflowId}
                  {step.kind === 'workflowClosed' && linked.runId
                    ? ` (${linked.runId})`
                    : ''}
                </Link>
              ) : undefined,
            ],
          ]}
        />
      </div>

      {step.failure && (
        <Section title="Error" testId="step-error">
          <FailureView failure={step.failure} />
        </Section>
      )}

      {showsPayloads && payloadsHidden && (
        <Section title="Input and output">
          <Text as="p" variant="body-small" color="secondary">
            Inputs and results are hidden: they need the permission to read the
            event history.
          </Text>
        </Section>
      )}
      {showsPayloads && !payloadsHidden && (hasInput || !hasResult) && (
        <Section title="Input" testId="step-input">
          <PayloadView payload={step.input} open />
        </Section>
      )}
      {showsPayloads &&
        !payloadsHidden &&
        (hasResult || step.kind === 'activity') && (
          <Section title="Output" testId="step-output">
            <PayloadView payload={step.result} open />
          </Section>
        )}

      {step.attempts && step.attempts.length > 0 && (
        <Section title="Attempts" testId="step-attempts">
          {step.attempts.map(a => (
            <div key={a.attempt} className={tp('tp-section')}>
              <Flex align="center" gap="2">
                <Text variant="body-small" weight="bold">
                  Attempt {a.attempt}
                </Text>
                <WorkflowStatusLabel status={a.status} />
                {a.startedTime && (
                  <Text variant="body-x-small" color="secondary">
                    {formatTime(a.startedTime)}
                  </Text>
                )}
              </Flex>
              {a.failure && !(a.attempt === step.attempt && step.failure) && (
                <FailureView failure={a.failure} />
              )}
            </div>
          ))}
          {step.attempt && step.attempt > step.attempts.length && (
            <Text as="p" variant="body-x-small" color="secondary">
              Temporal keeps only the last attempt and the failure before it.
            </Text>
          )}
        </Section>
      )}

      {step.details && Object.keys(step.details).length > 0 && (
        <Section title="Details">
          <JsonView value={step.details} />
        </Section>
      )}

      {step.events.length > 0 && (
        <Section title="Events" testId="step-events">
          <DefinitionList
            items={step.events.map(e => [
              `#${e.eventId}`,
              <>
                {e.eventType}{' '}
                <Text as="span" variant="body-x-small" color="secondary">
                  {formatTime(e.eventTime)}
                </Text>
              </>,
            ])}
          />
        </Section>
      )}
    </aside>
  );
}
