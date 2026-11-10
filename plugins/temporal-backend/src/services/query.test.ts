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

import { Entity } from '@backstage/catalog-model';
import {
  InvalidTemporalAnnotationError,
  parseTemporalAnnotations,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  buildEntityWorkflowQuery,
  buildNamespaceWorkflowQuery,
  matchingWorkflowEntity,
  parseStatus,
  workflowBelongsToEntity,
} from './query';

function entity(annotations: Record<string, string>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'orders', namespace: 'default', annotations },
    spec: {},
  };
}

const ref = 'component:default/orders';

describe('buildEntityWorkflowQuery', () => {
  it('combines task queue and workflow types', () => {
    const annotations = parseTemporalAnnotations(
      entity({
        'temporal.io/task-queue': 'orders',
        'temporal.io/workflow-type': 'a, b',
      }),
    );
    expect(buildEntityWorkflowQuery({ annotations, entityRef: ref })).toBe(
      "TaskQueue = 'orders' AND WorkflowType IN ('a', 'b')",
    );
  });

  it('adds the entity reference search attribute as an alternative', () => {
    const annotations = parseTemporalAnnotations(
      entity({ 'temporal.io/workflow-type': 'orderWorkflow' }),
    );
    expect(
      buildEntityWorkflowQuery(
        {
          annotations,
          entityRef: ref,
          entityRefAttribute: 'BackstageEntityRef',
        },
        { status: 'Failed' },
      ),
    ).toBe(
      "((WorkflowType = 'orderWorkflow') OR (BackstageEntityRef = 'component:default/orders')) AND ExecutionStatus = 'Failed'",
    );
  });

  it('lists only the latest run of a workflow that continues as new', () => {
    const annotations = parseTemporalAnnotations(
      entity({ 'temporal.io/task-queue': 'orders' }),
    );
    const filter = { annotations, entityRef: ref };
    expect(buildEntityWorkflowQuery(filter, { allRuns: false })).toBe(
      "(TaskQueue = 'orders') AND ExecutionStatus != 'ContinuedAsNew'",
    );
    expect(buildEntityWorkflowQuery(filter, { allRuns: true })).toBe(
      "TaskQueue = 'orders'",
    );
    // A chosen status replaces the filter, so continued runs can be listed.
    expect(
      buildEntityWorkflowQuery(filter, {
        allRuns: false,
        status: 'ContinuedAsNew',
      }),
    ).toBe("(TaskQueue = 'orders') AND ExecutionStatus = 'ContinuedAsNew'");
  });

  it('uses only the search attribute when there is no filter annotation', () => {
    const annotations = parseTemporalAnnotations(
      entity({ 'temporal.io/namespace': 'default' }),
    );
    expect(
      buildEntityWorkflowQuery({
        annotations,
        entityRef: ref,
        entityRefAttribute: 'BackstageEntityRef',
      }),
    ).toBe("BackstageEntityRef = 'component:default/orders'");
    expect(() =>
      buildEntityWorkflowQuery({ annotations, entityRef: ref }),
    ).toThrow(/annotation/);
  });

  it.each([
    ["orders' OR WorkflowId != '"],
    ['orders" OR 1=1'],
    ['orders) OR (1=1'],
    ['orders\\'],
    ['two words'],
  ])('rejects injection in annotations: %s', value => {
    expect(() =>
      parseTemporalAnnotations(entity({ 'temporal.io/task-queue': value })),
    ).toThrow(InvalidTemporalAnnotationError);
    expect(() =>
      parseTemporalAnnotations(entity({ 'temporal.io/workflow-type': value })),
    ).toThrow(InvalidTemporalAnnotationError);
    expect(() =>
      parseTemporalAnnotations(entity({ 'temporal.io/namespace': value })),
    ).toThrow(InvalidTemporalAnnotationError);
  });

  it('rejects injected values that bypass annotation parsing', () => {
    expect(() =>
      buildEntityWorkflowQuery({
        annotations: { taskQueue: "x' OR 'a'='a", workflowTypes: [] },
        entityRef: ref,
      }),
    ).toThrow();
    expect(() =>
      buildEntityWorkflowQuery({
        annotations: { workflowTypes: ['ok'] },
        entityRef: "component:default/x' OR 'a'='a",
        entityRefAttribute: 'BackstageEntityRef',
      }),
    ).toThrow();
    expect(() =>
      buildEntityWorkflowQuery({
        annotations: { workflowTypes: ['ok'] },
        entityRef: ref,
        entityRefAttribute: 'Bad Name',
      }),
    ).toThrow();
  });
});

describe('the search attribute filter', () => {
  it('keeps the workflows whose Bool search attribute is true', () => {
    expect(
      buildNamespaceWorkflowQuery({
        workflowType: 'demoRelease',
        searchAttribute: 'ApprovalPending',
        status: 'Running',
      }),
    ).toBe(
      "WorkflowType = 'demoRelease' AND ApprovalPending = true AND ExecutionStatus = 'Running'",
    );
    expect(
      buildEntityWorkflowQuery(
        {
          annotations: { workflowTypes: ['demoRelease'] },
          entityRef: 'component:default/release',
        },
        { searchAttribute: 'ApprovalPending' },
      ),
    ).toBe("(WorkflowType = 'demoRelease') AND ApprovalPending = true");
    // With several alternatives and every run, the filter applies to all.
    expect(
      buildEntityWorkflowQuery(
        {
          annotations: { workflowTypes: ['demoRelease'] },
          entityRef: 'component:default/release',
          entityRefAttribute: 'BackstageEntityRef',
        },
        { searchAttribute: 'ApprovalPending', allRuns: true },
      ),
    ).toBe(
      "((WorkflowType = 'demoRelease') OR (BackstageEntityRef = 'component:default/release')) AND ApprovalPending = true",
    );
  });

  it('rejects names that are not search attribute names', () => {
    expect(() =>
      buildNamespaceWorkflowQuery({ searchAttribute: 'x = true OR y' }),
    ).toThrow('Invalid search attribute name');
  });
});

describe('parseStatus', () => {
  it('accepts known statuses only', () => {
    expect(parseStatus(undefined)).toBeUndefined();
    expect(parseStatus('Running')).toBe('Running');
    expect(() => parseStatus("Running' OR '1")).toThrow(/Invalid status/);
    expect(() => parseStatus(['Running'])).toThrow(/Invalid status/);
  });
});

describe('workflowBelongsToEntity', () => {
  const annotations = { taskQueue: 'orders', workflowTypes: ['a', 'b'] };

  it('matches the same rules as the query', () => {
    const filter = { annotations, entityRef: ref };
    expect(
      workflowBelongsToEntity(
        { taskQueue: 'orders', workflowType: 'a' },
        filter,
      ),
    ).toBe(true);
    expect(
      workflowBelongsToEntity(
        { taskQueue: 'other', workflowType: 'a' },
        filter,
      ),
    ).toBe(false);
    expect(
      workflowBelongsToEntity(
        { taskQueue: 'orders', workflowType: 'c' },
        filter,
      ),
    ).toBe(false);
  });

  it('matches the entity reference search attribute when configured', () => {
    const workflow = { taskQueue: 'other', workflowType: 'c', entityRef: ref };
    expect(
      workflowBelongsToEntity(workflow, { annotations, entityRef: ref }),
    ).toBe(false);
    expect(
      workflowBelongsToEntity(workflow, {
        annotations,
        entityRef: ref,
        entityRefAttribute: 'BackstageEntityRef',
      }),
    ).toBe(true);
  });
});

describe('related TemporalWorkflow entities', () => {
  const filter = {
    annotations: { workflowTypes: [] },
    entityRef: ref,
    related: [
      {
        entityRef: 'temporalworkflow:default/order',
        taskQueue: 'orders',
        workflowTypes: ['orderWorkflow'],
      },
    ],
  };

  it('adds each related entity as an alternative', () => {
    expect(buildEntityWorkflowQuery(filter)).toBe(
      "TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow'",
    );
    expect(
      buildEntityWorkflowQuery({
        ...filter,
        entityRefAttribute: 'BackstageEntityRef',
      }),
    ).toBe(
      "(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') OR (BackstageEntityRef IN ('component:default/orders', 'temporalworkflow:default/order'))",
    );
  });

  it('rejects injected values in related entities', () => {
    expect(() =>
      buildEntityWorkflowQuery({
        ...filter,
        related: [
          {
            entityRef: 'temporalworkflow:default/x',
            workflowTypes: ["a' OR '1"],
          },
        ],
      }),
    ).toThrow();
  });

  it('finds the related entity a run matches', () => {
    expect(
      matchingWorkflowEntity(
        { taskQueue: 'orders', workflowType: 'orderWorkflow' },
        filter,
      ),
    ).toBe('temporalworkflow:default/order');
    expect(
      workflowBelongsToEntity(
        { taskQueue: 'orders', workflowType: 'orderWorkflow' },
        filter,
      ),
    ).toBe(true);
    expect(
      matchingWorkflowEntity(
        { taskQueue: 'other', workflowType: 'orderWorkflow' },
        filter,
      ),
    ).toBeUndefined();
  });
});

describe('buildNamespaceWorkflowQuery', () => {
  it('combines the filters', () => {
    expect(buildNamespaceWorkflowQuery({})).toBe('');
    expect(
      buildNamespaceWorkflowQuery({
        workflowType: 'orderWorkflow',
        workflowIdPrefix: 'order-',
        status: 'Running',
      }),
    ).toBe(
      "WorkflowType = 'orderWorkflow' AND WorkflowId STARTS_WITH 'order-' AND ExecutionStatus = 'Running'",
    );
  });

  it('lists only the latest run of a workflow that continues as new', () => {
    expect(buildNamespaceWorkflowQuery({ allRuns: false })).toBe(
      "ExecutionStatus != 'ContinuedAsNew'",
    );
    expect(
      buildNamespaceWorkflowQuery({
        allRuns: false,
        workflowIdPrefix: 'poll-',
      }),
    ).toBe(
      "WorkflowId STARTS_WITH 'poll-' AND ExecutionStatus != 'ContinuedAsNew'",
    );
    expect(buildNamespaceWorkflowQuery({ allRuns: true })).toBe('');
    expect(
      buildNamespaceWorkflowQuery({ allRuns: false, status: 'Completed' }),
    ).toBe("ExecutionStatus = 'Completed'");
  });
});
