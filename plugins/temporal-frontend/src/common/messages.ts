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

// Copy of plugins/temporal-backend/src/common/messages.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { Entity } from '@backstage/catalog-model';
import type { JsonObject, JsonValue } from '@backstage/types';
import type { WorkflowHandler, WorkflowHandlersResponse } from './controls';

/**
 * How a `TemporalWorkflow` entity describes one signal, update or query of
 * its workflow, in `spec.messages`.
 *
 * @public
 */
export type TemporalWorkflowMessageSpec = {
  /** The handler name, as the workflow defines it. */
  name: string;
  description?: string;
  /**
   * JSON Schema of the one argument the handler takes. The dialogs show a
   * form for it instead of a JSON field.
   */
  inputSchema?: JsonObject;
  /**
   * Example arguments, filled in the dialog: an array of arguments, or one
   * value for a handler with one argument. With `inputSchema`, the starting
   * value of the form.
   */
  example?: JsonValue;
  /**
   * A property of the argument (with `inputSchema`, an object) that is
   * filled with the signed-in user's entity reference, for example `by`.
   */
  userField?: string;
};

/**
 * The `spec.messages` of a `TemporalWorkflow` entity.
 *
 * @public
 */
export type TemporalWorkflowMessagesSpec = {
  signals?: TemporalWorkflowMessageSpec[];
  updates?: TemporalWorkflowMessageSpec[];
  queries?: TemporalWorkflowMessageSpec[];
};

/**
 * JSON schema of one entry of `spec.messages`, part of the kind schema.
 *
 * @public
 */
export const temporalWorkflowMessageSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string' },
    inputSchema: {
      type: 'object',
      description: 'JSON Schema of the one argument the handler takes.',
    },
    example: {
      description:
        'Example arguments: an array of arguments, or one value for a handler with one argument.',
    },
    userField: {
      type: 'string',
      pattern: '^[A-Za-z_$][A-Za-z0-9_$]{0,99}$',
      description:
        "A property of the argument filled with the signed-in user's entity reference.",
    },
  },
} as const;

const KINDS = ['signals', 'updates', 'queries'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessage(value: unknown): WorkflowHandler | undefined {
  if (!isObject(value)) return undefined;
  const { name, description, inputSchema, example, userField } = value;
  if (typeof name !== 'string' || !name.trim() || name.length > 200) {
    return undefined;
  }
  const handler: WorkflowHandler = { name: name.trim() };
  if (typeof description === 'string' && description.trim()) {
    handler.description = description.trim();
  }
  if (isObject(inputSchema)) handler.inputSchema = inputSchema as JsonObject;
  if (example !== undefined) handler.example = example as JsonValue;
  if (
    typeof userField === 'string' &&
    /^[A-Za-z_$][\w$]{0,99}$/.test(userField)
  ) {
    handler.userField = userField;
  }
  return handler;
}

/**
 * The signals, updates and queries a `TemporalWorkflow` entity describes in
 * `spec.messages`. Entries that are not valid are left out; other entities
 * describe none.
 *
 * @public
 */
export function getTemporalWorkflowMessages(
  entity: Entity | undefined,
): WorkflowHandlersResponse {
  const result: WorkflowHandlersResponse = {
    signals: [],
    updates: [],
    queries: [],
  };
  // The kind is compared here: workflowEntity.ts imports this file.
  if (entity?.kind?.toLocaleLowerCase('en-US') !== 'temporalworkflow') {
    return result;
  }
  const messages = (entity.spec as { messages?: unknown }).messages;
  if (!isObject(messages)) return result;
  for (const kind of KINDS) {
    const list = messages[kind];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const handler = readMessage(item);
      if (handler && !result[kind].some(h => h.name === handler.name)) {
        result[kind].push(handler);
      }
    }
  }
  return result;
}

/**
 * Adds what an entity describes to the handlers a workflow reports: the
 * description, input schema and example of each one, and the described
 * handlers the workflow did not report (for example when no worker
 * answered), after the reported ones.
 *
 * @public
 */
export function mergeWorkflowHandlers(
  reported: WorkflowHandlersResponse,
  described: WorkflowHandlersResponse,
): WorkflowHandlersResponse {
  const merge = (
    own: WorkflowHandler[],
    extra: WorkflowHandler[],
  ): WorkflowHandler[] => [
    ...own.map(h => {
      const d = extra.find(e => e.name === h.name);
      return d
        ? { ...h, ...d, description: d.description ?? h.description }
        : h;
    }),
    ...extra.filter(e => !own.some(h => h.name === e.name)),
  ];
  return {
    signals: merge(reported.signals, described.signals),
    updates: merge(reported.updates, described.updates),
    queries: merge(reported.queries, described.queries),
  };
}

/**
 * The arguments of an example: an array is the argument list, any other
 * value the only argument, no example no arguments.
 *
 * @public
 */
export function exampleArgs(example: JsonValue | undefined): JsonValue[] {
  if (example === undefined) return [];
  return Array.isArray(example) ? example : [example];
}
