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

import type { JsonObject } from '@backstage/types';
import { Entity, entityKindSchemaValidator } from '@backstage/catalog-model';
import {
  buildEntityWorkflowStatsPath,
  getDependsOnTemporalWorkflowRefs,
  InvalidTemporalWorkflowSpecError,
  isTemporalAvailable,
  isTemporalWorkflowEntity,
  parseTemporalWorkflowSpec,
  temporalWorkflowEntityV1alpha1Schema,
} from './index';

const validate = entityKindSchemaValidator(
  temporalWorkflowEntityV1alpha1Schema,
);

function workflow(spec: JsonObject): Entity {
  return {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: { name: 'order-workflow' },
    spec,
  };
}

describe('TemporalWorkflow kind', () => {
  it('accepts a valid entity', () => {
    const entity = workflow({
      owner: 'group:default/team-a',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
      namespace: 'default',
      system: 'shop',
      lifecycle: 'production',
    });
    expect(validate(entity)).toBe(entity);
    expect(isTemporalWorkflowEntity(entity)).toBe(true);
    expect(parseTemporalWorkflowSpec(entity)).toEqual({
      namespace: 'default',
      taskQueue: 'orders',
      workflowTypes: ['orderWorkflow'],
    });
  });

  it('ignores other kinds and API versions', () => {
    expect(
      validate({ ...workflow({ owner: 'a', workflowType: 'b' }), kind: 'X' }),
    ).toBe(false);
    expect(
      validate({
        ...workflow({ owner: 'a', workflowType: 'b' }),
        apiVersion: 'backstage.io/v1alpha1',
      }),
    ).toBe(false);
  });

  it.each([
    ['missing owner', { workflowType: 'a' }],
    ['missing workflow type', { owner: 'a' }],
    ['quote in workflow type', { owner: 'a', workflowType: "a' OR 'b" }],
    [
      'space in task queue',
      { owner: 'a', workflowType: 'a', taskQueue: 'a b' },
    ],
    [
      'bracket in namespace',
      { owner: 'a', workflowType: 'a', namespace: 'a)' },
    ],
    ['unknown field', { owner: 'a', workflowType: 'a', queue: 'x' }],
    ['number', { owner: 'a', workflowType: 1 }],
  ])('rejects an invalid spec: %s', (_, spec) => {
    expect(() => validate(workflow(spec))).toThrow();
  });

  it('checks the spec again when reading it', () => {
    expect(() =>
      parseTemporalWorkflowSpec(workflow({ owner: 'a', taskQueue: 'q' })),
    ).toThrow(InvalidTemporalWorkflowSpecError);
    expect(() =>
      parseTemporalWorkflowSpec(
        workflow({ owner: 'a', workflowType: 'a', taskQueue: "q' OR '1" }),
      ),
    ).toThrow(InvalidTemporalWorkflowSpecError);
  });

  it('finds the workflow entities an entity depends on', () => {
    const component: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'checkout' },
      relations: [
        { type: 'dependsOn', targetRef: 'temporalworkflow:default/order' },
        { type: 'dependsOn', targetRef: 'resource:default/db' },
        { type: 'ownedBy', targetRef: 'temporalworkflow:default/other' },
        { type: 'dependsOn', targetRef: 'TemporalWorkflow:default/order' },
      ],
    };
    expect(getDependsOnTemporalWorkflowRefs(component)).toEqual([
      'temporalworkflow:default/order',
    ]);
    expect(isTemporalAvailable(component)).toBe(true);
    expect(isTemporalAvailable({ ...component, relations: [] })).toBe(false);
    expect(
      isTemporalAvailable(workflow({ owner: 'a', workflowType: 'b' })),
    ).toBe(true);
  });

  it('builds the stats path', () => {
    expect(
      buildEntityWorkflowStatsPath({
        kind: 'TemporalWorkflow',
        namespace: 'default',
        name: 'Order',
      }),
    ).toBe('/entities/temporalworkflow/default/order/workflow-stats');
  });
});
