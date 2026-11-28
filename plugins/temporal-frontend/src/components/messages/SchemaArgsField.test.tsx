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

import { screen, waitFor } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import type { JsonObject } from '@backstage/types';
import validator from '@rjsf/validator-ajv8';
import {
  MAX_SCHEMA_CHARS,
  MAX_SCHEMA_DEPTH,
  SchemaArgsField,
} from './SchemaArgsField';

// The form fails while it renders when `formThrows` is set.
let formThrows = false;
jest.mock('@rjsf/core', () => {
  const actual = jest.requireActual('@rjsf/core');
  const Actual = actual.default;
  return {
    __esModule: true,
    ...actual,
    default: (props: object) => {
      if (formThrows) throw new Error('form failed');
      return <Actual {...props} />;
    },
  };
});

const schema: JsonObject = {
  type: 'object',
  required: ['orderId'],
  properties: { orderId: { type: 'string', title: 'Order ID' } },
};

/** A schema whose JSON has `depth` objects inside each other. */
function nested(depth: number): JsonObject {
  let value: JsonObject = { type: 'string' };
  for (let i = 1; i < depth; i++) {
    value = { type: 'array', items: value };
  }
  return value;
}

async function render(inputSchema: JsonObject) {
  const onChange = jest.fn();
  await renderInTestApp(
    <SchemaArgsField
      messageDefinition={{
        name: 'findOrder',
        inputSchema,
        example: { orderId: 'order-1' },
      }}
      onChange={onChange}
    />,
  );
  return onChange;
}

/**
 * Checks that the JSON field is shown and gives the example, and returns
 * the note above it.
 */
async function fallbackNote(onChange: jest.Mock): Promise<string | null> {
  expect(screen.queryByTestId('message-form')).toBeNull();
  expect(
    screen.getByRole('textbox', { name: 'Arguments (JSON)' }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({
      args: [{ orderId: 'order-1' }],
    }),
  );
  return screen.getByTestId('message-form-fallback').textContent;
}

describe('SchemaArgsField', () => {
  afterEach(() => {
    formThrows = false;
    jest.restoreAllMocks();
  });

  it('shows the form of an input schema', async () => {
    const onChange = await render(schema);
    expect(screen.getByTestId('message-form')).toBeInTheDocument();
    expect(screen.queryByTestId('message-form-fallback')).toBeNull();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        args: [{ orderId: 'order-1' }],
      }),
    );
  });

  it('shows the form of a schema at the depth limit', async () => {
    await render(nested(MAX_SCHEMA_DEPTH));
    expect(screen.getByTestId('message-form')).toBeInTheDocument();
  });

  it('gives the JSON field for a schema nested too deep', async () => {
    const onChange = await render(nested(MAX_SCHEMA_DEPTH + 1));
    expect(await fallbackNote(onChange)).toMatch(
      /nested more than 32 levels deep/,
    );
  });

  it('gives the JSON field for a schema that is too large', async () => {
    const onChange = await render({
      ...schema,
      description: 'x'.repeat(MAX_SCHEMA_CHARS),
    });
    expect(await fallbackNote(onChange)).toMatch(
      /larger than 65536 characters/,
    );
  });

  it('gives the JSON field for a schema that cannot be compiled', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = await render({ type: 'no-such-type' });
    expect(await fallbackNote(onChange)).toMatch(/could not be compiled/);
  });

  it('gives the JSON field when the page does not allow eval', async () => {
    // ajv compiles schemas with `new Function`, which a Content Security
    // Policy without 'unsafe-eval' refuses with an EvalError.
    jest.spyOn(validator.ajv, 'compile').mockImplementation(() => {
      throw new EvalError('Refused to evaluate a string as JavaScript');
    });
    const onChange = await render({ ...schema, title: 'Another schema' });
    expect(await fallbackNote(onChange)).toMatch(/could not be compiled/);
  });

  it('gives the JSON field when the form fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    formThrows = true;
    const onChange = await render(schema);
    expect(await fallbackNote(onChange)).toMatch(
      /form of the input schema could not be shown/,
    );
  });
});
