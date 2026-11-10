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
  buildEntityWorkflowsPath,
  buildWorkflowPath,
  isTemporalAvailable,
  parseTemporalAnnotations,
  parseTemporalWorkflowResourceRef,
  stringifyTemporalWorkflowResourceRef,
  temporalPermissions,
} from './index';

const entity = (annotations: Record<string, string> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'x', annotations },
});

describe('temporal common', () => {
  it('detects Temporal annotations', () => {
    expect(isTemporalAvailable(entity())).toBe(false);
    expect(isTemporalAvailable(entity({ 'temporal.io/task-queue': 'q' }))).toBe(
      true,
    );
  });

  it('parses workflow types separated by commas', () => {
    expect(
      parseTemporalAnnotations(
        entity({ 'temporal.io/workflow-type': ' a ,b,, c ' }),
      ),
    ).toEqual({
      namespace: undefined,
      taskQueue: undefined,
      workflowTypes: ['a', 'b', 'c'],
    });
  });

  it('builds encoded paths', () => {
    expect(
      buildWorkflowPath({
        namespace: 'default',
        workflowId: 'a/b',
        runId: 'r',
      }),
    ).toBe('/namespaces/default/workflows/a%2Fb/runs/r');
    expect(
      buildEntityWorkflowsPath({
        kind: 'Component',
        namespace: 'default',
        name: 'X',
      }),
    ).toBe('/entities/component/default/x/workflows');
  });

  it('defines catalog-entity and temporal-workflow permissions', () => {
    expect(
      temporalPermissions.map(p => [
        p.name,
        'resourceType' in p ? p.resourceType : undefined,
      ]),
    ).toEqual([
      ['temporal.workflow.read', 'catalog-entity'],
      ['temporal.workflow.history.read', 'catalog-entity'],
      ['temporal.workflow.list', 'temporal-workflow'],
      ['temporal.workflow.history.list', 'temporal-workflow'],
      ['temporal.workflow.query', 'catalog-entity'],
      ['temporal.workflow.start', 'catalog-entity'],
      ['temporal.workflow.signal', 'catalog-entity'],
      ['temporal.workflow.update', 'catalog-entity'],
      ['temporal.workflow.cancel', 'catalog-entity'],
      ['temporal.workflow.terminate', 'catalog-entity'],
      ['temporal.workflow.rerun', 'catalog-entity'],
    ]);
  });

  it('encodes workflow resource references reversibly', () => {
    const ref = { namespace: 'default', workflowId: 'order:1/a', runId: 'r1' };
    const text = stringifyTemporalWorkflowResourceRef(ref);
    expect(text).toBe('default:order%3A1%2Fa:r1');
    expect(parseTemporalWorkflowResourceRef(text)).toEqual(ref);
    expect(
      parseTemporalWorkflowResourceRef(
        stringifyTemporalWorkflowResourceRef({
          namespace: 'default',
          workflowId: 'w',
        }),
      ),
    ).toEqual({ namespace: 'default', workflowId: 'w' });
    expect(parseTemporalWorkflowResourceRef('only-one')).toBeUndefined();
    expect(parseTemporalWorkflowResourceRef('a:b:c:d')).toBeUndefined();
    expect(parseTemporalWorkflowResourceRef(':w')).toBeUndefined();
  });
});
