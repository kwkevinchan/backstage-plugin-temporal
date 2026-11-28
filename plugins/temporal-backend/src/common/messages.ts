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
import type { JsonObject, JsonValue } from '@backstage/types';
import type {
  WorkflowMessageDefinition,
  WorkflowMessageDefinitionsResponse,
} from './controls';
import { isJsonObject } from './json';
import {
  MAX_MESSAGE_NAME_LENGTH,
  USER_FIELD_PATTERN_SOURCE,
} from './namePatterns';

/**
 * How a `TemporalWorkflow` entity describes one signal, update or query of
 * its workflow, in `spec.messages`.
 *
 * @public
 */
export type TemporalWorkflowMessageSpec = {
  /** The message name, as the workflow defines it. */
  name: string;
  description?: string;
  /**
   * JSON Schema of the one argument this message takes. The dialogs show a
   * form for it instead of a JSON field.
   */
  inputSchema?: JsonObject;
  /**
   * Example arguments, filled in the dialog: an array of arguments, or one
   * value for a message with one argument. With `inputSchema`, the starting
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

const KINDS = ['signals', 'updates', 'queries'] as const;

const USER_FIELD_PATTERN = new RegExp(USER_FIELD_PATTERN_SOURCE);

function readMessage(value: unknown): WorkflowMessageDefinition | undefined {
  if (!isJsonObject(value)) return undefined;
  const { name, description, inputSchema, example, userField } = value;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > MAX_MESSAGE_NAME_LENGTH
  ) {
    return undefined;
  }
  const definition: WorkflowMessageDefinition = { name: name.trim() };
  if (typeof description === 'string' && description.trim()) {
    definition.description = description.trim();
  }
  if (isJsonObject(inputSchema)) definition.inputSchema = inputSchema;
  if (example !== undefined) definition.example = example;
  if (typeof userField === 'string' && USER_FIELD_PATTERN.test(userField)) {
    definition.userField = userField;
  }
  return definition;
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
): WorkflowMessageDefinitionsResponse {
  const result: WorkflowMessageDefinitionsResponse = {
    signals: [],
    updates: [],
    queries: [],
  };
  // The kind is compared here: workflowEntity.ts imports this file.
  if (entity?.kind?.toLocaleLowerCase('en-US') !== 'temporalworkflow') {
    return result;
  }
  const messages = (entity.spec as { messages?: unknown } | undefined)
    ?.messages;
  if (!isJsonObject(messages)) return result;
  for (const kind of KINDS) {
    const list = messages[kind];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const definition = readMessage(item);
      if (definition && !result[kind].some(d => d.name === definition.name)) {
        result[kind].push(definition);
      }
    }
  }
  return result;
}

/**
 * Adds what an entity describes to the message definitions a workflow reports: the
 * description, input schema and example of each one, and the described
 * definitions the workflow did not report (for example when no worker
 * answered), after the reported ones.
 *
 * @public
 */
export function mergeWorkflowMessageDefinitions(
  reported: WorkflowMessageDefinitionsResponse,
  described: WorkflowMessageDefinitionsResponse,
): WorkflowMessageDefinitionsResponse {
  const merge = (
    own: WorkflowMessageDefinition[],
    extra: WorkflowMessageDefinition[],
  ): WorkflowMessageDefinition[] => [
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
