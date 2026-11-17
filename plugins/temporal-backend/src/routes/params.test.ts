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

import { InputError } from '@backstage/errors';
import type { Request } from 'express';
import {
  entityRefFromParams,
  parseArgs,
  parseFlag,
  parseMessageBody,
  parsePageSize,
  requestBody,
  workflowRefFromParams,
} from './params';

function reqWith(parts: Partial<Pick<Request, 'body' | 'params'>>): Request {
  return {
    body: undefined,
    params: {},
    ...parts,
  } as Request;
}

describe('route parameter parsers', () => {
  it('validates JSON object request bodies', () => {
    expect(requestBody(reqWith({ body: undefined }))).toEqual({});
    expect(requestBody(reqWith({ body: null }))).toEqual({});
    expect(requestBody(reqWith({ body: { ok: true } }))).toEqual({ ok: true });

    expect(() => requestBody(reqWith({ body: [1, 2] }))).toThrow(
      new InputError('The request body must be a JSON object'),
    );
    expect(() => requestBody(reqWith({ body: 'text' }))).toThrow(
      new InputError('The request body must be a JSON object'),
    );
  });

  it('validates message body name length and args array shape', () => {
    expect(
      parseMessageBody(
        reqWith({ body: { name: `  ${'a'.repeat(196)}  `, args: [1, 'b'] } }),
      ),
    ).toEqual({ name: 'a'.repeat(196), args: [1, 'b'] });

    for (const badName of [undefined, 123, '   ', 'a'.repeat(201)]) {
      expect(() =>
        parseMessageBody(reqWith({ body: { name: badName } })),
      ).toThrow(new InputError('name is required'));
    }

    expect(parseArgs(undefined)).toBeUndefined();
    expect(parseArgs(null)).toBeUndefined();
    expect(() => parseArgs({ not: 'an-array' })).toThrow(
      new InputError('args must be an array of arguments'),
    );
  });

  it('validates workflowRefFromParams length and optional runId', () => {
    expect(
      workflowRefFromParams(
        reqWith({
          params: {
            namespace: 'default',
            workflowId: 'w'.repeat(1000),
            runId: '',
          },
        }),
      ),
    ).toEqual({
      namespace: 'default',
      workflowId: 'w'.repeat(1000),
      runId: undefined,
    });

    expect(() =>
      workflowRefFromParams(
        reqWith({ params: { namespace: 'default', workflowId: '' } }),
      ),
    ).toThrow(new InputError('Invalid workflowId'));

    expect(() =>
      workflowRefFromParams(
        reqWith({
          params: { namespace: 'default', workflowId: 'w'.repeat(1001) },
        }),
      ),
    ).toThrow(new InputError('Invalid workflowId'));
  });

  it('normalizes entityRefFromParams and rejects missing route segments', () => {
    expect(
      entityRefFromParams(
        reqWith({
          params: {
            kind: 'TemporalWorkflow',
            namespace: 'Default',
            name: 'OrderFlow',
          },
        }),
      ),
    ).toBe('temporalworkflow:default/orderflow');

    expect(() =>
      entityRefFromParams(
        reqWith({ params: { namespace: 'default', name: 'orders' } }),
      ),
    ).toThrow(new InputError('Invalid entity reference'));

    expect(() =>
      entityRefFromParams(
        reqWith({ params: { kind: 'component', namespace: 'default' } }),
      ),
    ).toThrow(new InputError('Invalid entity reference'));
  });

  it('validates boolean flags and integer page size bounds', () => {
    expect(parseFlag(undefined, 'allRuns')).toBe(false);
    expect(parseFlag('', 'allRuns')).toBe(false);
    expect(parseFlag('false', 'allRuns')).toBe(false);
    expect(parseFlag('true', 'allRuns')).toBe(true);
    expect(() => parseFlag('yes', 'allRuns')).toThrow(
      new InputError('allRuns must be true or false'),
    );

    const limits = { default: 25, max: 100 };
    expect(parsePageSize(undefined, limits)).toBe(25);
    expect(parsePageSize('100', limits)).toBe(100);
    for (const bad of ['0', '-1', '1.5', '101', 'abc']) {
      expect(() => parsePageSize(bad, limits)).toThrow(
        new InputError('pageSize must be between 1 and 100'),
      );
    }
  });
});
