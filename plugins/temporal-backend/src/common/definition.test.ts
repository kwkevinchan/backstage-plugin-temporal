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
import {
  getTemporalWorkflowDefinitionSpec,
  InvalidTemporalWorkflowSpecError,
} from './index';

const workflow = (definition?: unknown): Entity => ({
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'flow' },
  spec: { owner: 'team', workflowType: 'flow', definition: definition as any },
});

describe('workflow definitions', () => {
  it('reads spec.definition', () => {
    expect(getTemporalWorkflowDefinitionSpec(workflow())).toBeUndefined();
    expect(
      getTemporalWorkflowDefinitionSpec({
        ...workflow({ format: 'serverless-workflow', target: 'x' }),
        kind: 'Component',
      }),
    ).toBeUndefined();
    expect(
      getTemporalWorkflowDefinitionSpec(
        workflow({ format: 'serverless-workflow', target: ' ./a.yaml ' }),
      ),
    ).toEqual({ format: 'serverless-workflow', target: './a.yaml' });
    for (const bad of [
      'a.yaml',
      { format: 'bpmn', target: 'a' },
      { format: 'serverless-workflow' },
      { format: 'serverless-workflow', target: 'x'.repeat(3000) },
    ]) {
      expect(() => getTemporalWorkflowDefinitionSpec(workflow(bad))).toThrow(
        InvalidTemporalWorkflowSpecError,
      );
    }
  });
});
