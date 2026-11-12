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

import type { Entity } from '@backstage/catalog-model';
import { getTemporalWorkflowSource } from './workflowEntity';

describe('getTemporalWorkflowSource', () => {
  it('reads the spec of a TemporalWorkflow entity', () => {
    const entity: Entity = {
      apiVersion: 'temporal.io/v1alpha1',
      kind: 'TemporalWorkflow',
      metadata: { name: 'orders' },
      spec: {
        owner: 'team',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
      },
    };
    expect(getTemporalWorkflowSource(entity)).toEqual(
      expect.objectContaining({
        workflowTypes: ['orderWorkflow'],
        taskQueue: 'orders',
      }),
    );
  });

  it('reads the annotations of any other entity', () => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'checkout',
        annotations: {
          'temporal.io/workflow-type': 'payWorkflow, refundWorkflow',
          'temporal.io/task-queue': 'payments',
        },
      },
    };
    expect(getTemporalWorkflowSource(entity)).toEqual(
      expect.objectContaining({
        workflowTypes: ['payWorkflow', 'refundWorkflow'],
        taskQueue: 'payments',
      }),
    );
  });
});
