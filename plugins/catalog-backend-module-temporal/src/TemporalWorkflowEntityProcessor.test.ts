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

import { startTestBackend } from '@backstage/backend-test-utils';
import type { JsonObject } from '@backstage/types';
import { Entity } from '@backstage/catalog-model';
import {
  catalogProcessingExtensionPoint,
  CatalogProcessorResult,
} from '@backstage/plugin-catalog-node';
import catalogModuleTemporalWorkflowKind, {
  TemporalWorkflowEntityProcessor,
} from './index';

const location = { type: 'url', target: 'http://example.com/catalog.yaml' };

function workflow(spec: JsonObject): Entity {
  return {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: { name: 'order-workflow', namespace: 'default' },
    spec,
  };
}

async function relationsOf(entity: Entity) {
  const results: CatalogProcessorResult[] = [];
  await new TemporalWorkflowEntityProcessor().postProcessEntity(
    entity,
    location,
    r => results.push(r),
  );
  return results.map(r => {
    if (r.type !== 'relation') throw new Error(`unexpected ${r.type}`);
    const { source, type, target } = r.relation;
    return `${source.kind}:${source.namespace}/${source.name} ${type} ${target.kind}:${target.namespace}/${target.name}`;
  });
}

describe('TemporalWorkflowEntityProcessor', () => {
  const processor = new TemporalWorkflowEntityProcessor();

  it('validates TemporalWorkflow entities', async () => {
    await expect(
      processor.validateEntityKind(
        workflow({ owner: 'team-a', workflowType: 'orderWorkflow' }),
      ),
    ).resolves.toBe(true);
    await expect(
      processor.validateEntityKind(
        workflow({
          owner: 'team-a',
          workflowType: 'orderWorkflow',
          taskQueue: 'orders',
          namespace: 'default',
          system: 'shop',
          lifecycle: 'production',
          dependsOn: ['resource:orders-db'],
        }),
      ),
    ).resolves.toBe(true);
  });

  it('validates the definition of a workflow written in YAML', async () => {
    const definition = (value: JsonObject) =>
      workflow({
        owner: 'team-a',
        workflowType: 'order-flow',
        definition: value,
      });
    await expect(
      processor.validateEntityKind(
        definition({ format: 'serverless-workflow', target: './order.yaml' }),
      ),
    ).resolves.toBe(true);
    await expect(
      processor.validateEntityKind(
        definition({ format: 'source', target: './w.ts', symbol: 'run' }),
      ),
    ).resolves.toBe(true);
    for (const bad of [
      { format: 'source', target: './w.ts', symbol: 'two words' },
      { format: 'bpmn', target: './order.bpmn' },
      { format: 'serverless-workflow' },
      { format: 'serverless-workflow', target: './a.yaml', extra: true },
    ]) {
      await expect(
        processor.validateEntityKind(definition(bad)),
      ).rejects.toThrow();
    }
  });

  it('leaves other kinds to other processors', async () => {
    await expect(
      processor.validateEntityKind({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'x' },
        spec: { type: 'service', owner: 'a', lifecycle: 'b' },
      }),
    ).resolves.toBe(false);
    await expect(
      relationsOf({ ...workflow({}), kind: 'Component' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['without owner', { workflowType: 'orderWorkflow' }],
    ['without workflow type', { owner: 'team-a' }],
    ['with a quote', { owner: 'team-a', workflowType: "a' OR '1" }],
    ['with a space', { owner: 'a', workflowType: 'a', taskQueue: 'a b' }],
    ['with an unknown field', { owner: 'a', workflowType: 'a', type: 'x' }],
  ])('rejects a spec %s', async (_, spec) => {
    await expect(
      processor.validateEntityKind(workflow(spec)),
    ).rejects.toThrow();
  });

  it('emits owner, system and dependency relations both ways', async () => {
    await expect(
      relationsOf(
        workflow({
          owner: 'team-a',
          workflowType: 'orderWorkflow',
          system: 'shop',
          dependsOn: ['resource:orders-db'],
        }),
      ),
    ).resolves.toEqual([
      'TemporalWorkflow:default/order-workflow ownedBy Group:default/team-a',
      'Group:default/team-a ownerOf TemporalWorkflow:default/order-workflow',
      'TemporalWorkflow:default/order-workflow partOf System:default/shop',
      'System:default/shop hasPart TemporalWorkflow:default/order-workflow',
      'TemporalWorkflow:default/order-workflow dependsOn resource:default/orders-db',
      'resource:default/orders-db dependencyOf TemporalWorkflow:default/order-workflow',
    ]);
  });

  it('keeps explicit kinds of the owner', async () => {
    await expect(
      relationsOf(
        workflow({ owner: 'user:default/jane', workflowType: 'orderWorkflow' }),
      ),
    ).resolves.toEqual([
      'TemporalWorkflow:default/order-workflow ownedBy user:default/jane',
      'user:default/jane ownerOf TemporalWorkflow:default/order-workflow',
    ]);
  });
});

describe('catalogModuleTemporalWorkflowKind', () => {
  it('adds the processor to the catalog', async () => {
    const addProcessor = jest.fn();
    await startTestBackend({
      extensionPoints: [[catalogProcessingExtensionPoint, { addProcessor }]],
      features: [catalogModuleTemporalWorkflowKind],
    });
    expect(addProcessor).toHaveBeenCalledWith(
      expect.any(TemporalWorkflowEntityProcessor),
    );
  });
});
