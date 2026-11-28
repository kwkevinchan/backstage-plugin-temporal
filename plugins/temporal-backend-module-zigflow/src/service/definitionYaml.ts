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
import { isScalar, LineCounter, parseDocument, visit as visitYaml } from 'yaml';
import type {
  WorkflowDefinitionError,
  WorkflowDefinitionTask,
} from '../common/definition';
import { definitionTaskLines } from './definitionTasks';

/**
 * Most aliases in a definition file. The `yaml` package counts the anchor
 * itself as one of the copies, so one anchor takes at most
 * `MAX_ALIAS_COUNT - 1` aliases (`maxAliasCount` of the `yaml` package). The `yaml` package looks up the anchor of each alias in a
 * scan of the whole document, so the time to turn a file into data grows
 * with aliases times nodes; a small limit keeps it linear.
 */
export const MAX_ALIAS_COUNT = 20;
/**
 * Most levels of nested maps and lists in the data of a definition. The data
 * is copied and walked recursively, so the limit also keeps the stack small.
 */
const MAX_DEFINITION_DEPTH = 64;
/**
 * The data of a definition may be at most this many times the size of the
 * file, counted as one per value plus one per character of strings and keys.
 * A file without aliases stays well below it; aliases that copy large blocks
 * many times ("billion laughs") fail instead of filling the memory.
 */
const MAX_DATA_PER_FILE_SIZE = 4;

/** Data of a definition that cannot be returned as JSON. */
class DataError extends Error {}

/**
 * Copies the data of a YAML document into plain JSON values. Aliases make
 * the same object appear more than once, or inside itself; the copy expands
 * them, so it fails on a cycle, on deep nesting and past `maxSize` (one per
 * value plus one per character of strings and keys).
 */
function copyAsJson(root: unknown, maxSize: number): unknown {
  let size = 0;
  const grow = (amount: number) => {
    size += amount;
    if (size > maxSize) {
      throw new DataError(
        'The file expands to too much data through its aliases',
      );
    }
  };
  const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    grow(1);
    if (typeof value === 'string') {
      grow(value.length);
      return value;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (value === null || typeof value !== 'object') return null;
    if (depth >= MAX_DEFINITION_DEPTH) {
      throw new DataError(
        `The file is nested more than ${MAX_DEFINITION_DEPTH} levels deep`,
      );
    }
    if (ancestors.has(value)) {
      throw new DataError('The file has an alias inside its own anchor');
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map(item => copy(item, depth + 1));
      }
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        grow(key.length);
        // defineProperty keeps a "__proto__" key as data.
        Object.defineProperty(result, key, {
          value: copy(item, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return copy(root, 0);
}

/**
 * Parses a definition file without running anything: plain YAML 1.2 (core
 * schema, no custom tags), unique keys, limits on aliases, nesting and the
 * size of the data. Returns the data, the tasks with their lines, and an
 * error for invalid files.
 */
export function parseDefinition(text: string): {
  document?: JsonObject;
  tasks: WorkflowDefinitionTask[];
  error?: WorkflowDefinitionError;
} {
  const lineCounter = new LineCounter();
  // Unique keys are checked below: the check of the `yaml` package compares
  // each key with every earlier key of its map.
  const doc = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    schema: 'core',
    merge: false,
    uniqueKeys: false,
    strict: true,
  });
  const parseError = (
    message: string,
    pos?: { line: number; col: number },
  ) => ({
    tasks: [],
    error: {
      kind: 'parse' as const,
      message,
      ...(pos ? { line: pos.line } : {}),
    },
  });
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    return parseError(
      first.message.split('\n')[0],
      first.linePos?.[0] ?? lineCounter.linePos(first.pos[0]),
    );
  }
  let duplicate: number | undefined;
  let aliases = 0;
  try {
    visitYaml(doc, {
      Alias() {
        aliases += 1;
        return aliases > MAX_ALIAS_COUNT ? visitYaml.BREAK : undefined;
      },
      Map(_, map) {
        const keys = new Set<unknown>();
        for (const pair of map.items) {
          // Like the `yaml` package, only scalar keys are compared.
          if (!isScalar(pair.key)) continue;
          if (keys.has(pair.key.value)) {
            duplicate = pair.key.range?.[0] ?? 0;
            return visitYaml.BREAK;
          }
          keys.add(pair.key.value);
        }
        return undefined;
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return parseError('The file is nested too deeply');
    }
    throw error;
  }
  if (duplicate !== undefined) {
    return parseError(
      'Map keys must be unique',
      lineCounter.linePos(duplicate),
    );
  }
  const tooManyAliases = `The file uses too many aliases (at most ${MAX_ALIAS_COUNT} aliases in all, and at most ${
    MAX_ALIAS_COUNT - 1
  } for one anchor)`;
  if (aliases > MAX_ALIAS_COUNT) return parseError(tooManyAliases);
  let document: JsonObject;
  try {
    const data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        tasks: [],
        error: { kind: 'format', message: 'The file is not a YAML object' },
      };
    }
    document = copyAsJson(
      data,
      MAX_DATA_PER_FILE_SIZE * text.length + 1024,
    ) as JsonObject;
  } catch (error) {
    if (error instanceof DataError) return parseError(error.message);
    if (error instanceof RangeError) {
      return parseError('The file is nested too deeply');
    }
    return parseError(
      error instanceof Error && /alias/i.test(error.message)
        ? tooManyAliases
        : 'The file could not be read as YAML',
    );
  }
  if (!Array.isArray(document.do)) {
    return {
      document,
      tasks: [],
      error: {
        kind: 'format',
        message: 'The file has no task list (do) at the top level',
      },
    };
  }
  const tasks = definitionTaskLines(document, doc, text, lineCounter);
  const dsl = (document.document as JsonObject | undefined)?.dsl;
  if (typeof dsl === 'string' && !/^1\./.test(dsl)) {
    return {
      document,
      tasks,
      error: {
        kind: 'format',
        message: `DSL version ${dsl} is not supported; the page reads 1.x`,
      },
    };
  }
  return { document, tasks };
}
