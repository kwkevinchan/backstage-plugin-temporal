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

import { Entity, entityKindSchemaValidator } from '@backstage/catalog-model';
import {
  exampleArgs,
  getTemporalWorkflowMessages,
  mergeWorkflowHandlers,
} from './messages';
import { temporalWorkflowEntityV1alpha1Schema } from './workflowEntity';

const validate = entityKindSchemaValidator(
  temporalWorkflowEntityV1alpha1Schema,
);

function workflow(messages: unknown): Entity {
  return {
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: { name: 'ticket-workflow' },
    spec: { owner: 'group:default/a', workflowType: 'ticket', messages } as any,
  };
}

const approve = {
  name: 'approve',
  description: 'Approve or reject',
  inputSchema: {
    type: 'object',
    required: ['approved'],
    properties: { approved: { type: 'boolean' }, by: { type: 'string' } },
  },
  example: { approved: true },
  userField: 'by',
};

describe('spec.messages', () => {
  it('is part of the kind schema', () => {
    const entity = workflow({ updates: [approve], signals: [{ name: 'x' }] });
    expect(validate(entity)).toBe(entity);
    expect(() =>
      validate(workflow({ updates: [{ description: 'no name' }] })),
    ).toThrow();
    expect(() => validate(workflow({ other: [] }))).toThrow();
    expect(() =>
      validate(workflow({ updates: [{ name: 'a', userField: 'a.b' }] })),
    ).toThrow();
  });

  it('reads the messages of a TemporalWorkflow entity', () => {
    expect(
      getTemporalWorkflowMessages(
        workflow({
          updates: [approve, { name: 'approve' }, { name: '' }, 'bad'],
          signals: [{ name: ' note ', userField: 'not valid' }],
        }),
      ),
    ).toEqual({
      signals: [{ name: 'note' }],
      updates: [approve],
      queries: [],
    });
  });

  it('reads none from other entities', () => {
    const empty = { signals: [], updates: [], queries: [] };
    expect(getTemporalWorkflowMessages(undefined)).toEqual(empty);
    expect(
      getTemporalWorkflowMessages({
        ...workflow({ updates: [approve] }),
        kind: 'Component',
      }),
    ).toEqual(empty);
    expect(getTemporalWorkflowMessages(workflow('nope'))).toEqual(empty);
  });

  it('merges them into the handlers a workflow reports', () => {
    expect(
      mergeWorkflowHandlers(
        {
          signals: [{ name: 'note', description: 'From the worker' }],
          updates: [{ name: 'approve', description: 'From the worker' }],
          queries: [{ name: 'state' }],
        },
        {
          signals: [{ name: 'note', example: 'hi' }],
          updates: [approve, { name: 'escalate' }],
          queries: [],
        },
      ),
    ).toEqual({
      signals: [
        { name: 'note', description: 'From the worker', example: 'hi' },
      ],
      updates: [approve, { name: 'escalate' }],
      queries: [{ name: 'state' }],
    });
  });

  it('turns an example into arguments', () => {
    expect(exampleArgs(undefined)).toEqual([]);
    expect(exampleArgs({ a: 1 })).toEqual([{ a: 1 }]);
    expect(exampleArgs([1, 2])).toEqual([1, 2]);
  });
});
