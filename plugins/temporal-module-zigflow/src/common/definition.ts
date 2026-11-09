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

// Copy of plugins/temporal-backend-module-zigflow/src/common/definition.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

/*
 * The response of the definition route and the walk over the tasks of a
 * Serverless Workflow definition. The `spec.definition` of a
 * `TemporalWorkflow` entity is part of the kind and stays in
 * `@kwkevinchan/backstage-plugin-temporal-backend`.
 */

import type { CompoundEntityRef } from '@backstage/catalog-model';
import type { JsonObject } from '@backstage/types';

/**
 * Builds the path of the definition of a `TemporalWorkflow` entity, relative
 * to the root of the Temporal backend plugin:
 * `/entities/:kind/:namespace/:name/definition`.
 *
 * @public
 */
export function buildEntityDefinitionPath(entity: CompoundEntityRef): string {
  return `/entities/${encodeURIComponent(
    entity.kind.toLocaleLowerCase('en-US'),
  )}/${encodeURIComponent(
    entity.namespace.toLocaleLowerCase('en-US'),
  )}/${encodeURIComponent(entity.name.toLocaleLowerCase('en-US'))}/definition`;
}

/**
 * One task of a definition and where it is in the file.
 *
 * @public
 */
export interface WorkflowDefinitionTask {
  /** JSON pointer of the task, for example `/do/1/checkStock`. */
  pointer: string;
  /** Name of the task. */
  name: string;
  /** First line of the task (the line of its name), from 1. */
  startLine: number;
  /** Last line of the task, from 1. */
  endLine: number;
}

/**
 * Why a definition could not be shown.
 *
 * - `read`: the file could not be read (not found, host not allowed).
 * - `tooLarge`: the file is larger than the limit.
 * - `parse`: the file is not valid YAML, or uses too many aliases.
 * - `format`: the file is YAML, but not a workflow of the format.
 *
 * @public
 */
export interface WorkflowDefinitionError {
  kind: 'read' | 'tooLarge' | 'parse' | 'format';
  message: string;
  /** Line of a parse error, from 1. */
  line?: number;
  /** Column of a parse error, from 1. */
  column?: number;
}

/**
 * The definition of a `TemporalWorkflow` entity, as the backend read it
 * (`GET /entities/:kind/:namespace/:name/definition`).
 *
 * @public
 */
export interface WorkflowDefinitionResponse {
  entityRef: string;
  /** Format of the file (`spec.definition.format`). */
  format: 'serverless-workflow';
  /** `spec.definition.target` as written. */
  target: string;
  /** The URL the file was read from. */
  url?: string;
  /** The text of the file; absent when it could not be read. */
  content?: string;
  /** Size of the file in bytes. */
  size?: number;
  /** Largest file the backend reads, in bytes. */
  maxBytes: number;
  /** The parsed file. Absent when it is not valid YAML. */
  document?: JsonObject;
  /** The tasks of the definition with their lines, in file order. */
  tasks: WorkflowDefinitionTask[];
  error?: WorkflowDefinitionError;
}

/**
 * A task list inside a task: the body of `do`, `for` and `try`, the `do` of
 * a `catch`, and the branches of a `fork`.
 *
 * @public
 */
export interface DefinitionTaskList {
  /** Path from the task to the list, for example `['catch', 'do']`. */
  path: string[];
  list: unknown[];
  /**
   * Zigflow names the activities in `try` and `catch` bodies with a `try`
   * or `catch` segment (`<workflowType>.<task>.try.<step>`).
   */
  scope?: 'try' | 'catch';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The task lists inside a task, in the order they appear in the DSL
 * (`try` before `catch`).
 *
 * @public
 */
export function definitionTaskLists(task: unknown): DefinitionTaskList[] {
  if (!isObject(task)) return [];
  const lists: DefinitionTaskList[] = [];
  if ('try' in task) {
    if (Array.isArray(task.try)) {
      lists.push({ path: ['try'], list: task.try, scope: 'try' });
    }
    const handler = task.catch;
    if (isObject(handler) && Array.isArray(handler.do)) {
      lists.push({ path: ['catch', 'do'], list: handler.do, scope: 'catch' });
    }
    return lists;
  }
  if (isObject(task.fork) && Array.isArray(task.fork.branches)) {
    lists.push({ path: ['fork', 'branches'], list: task.fork.branches });
    return lists;
  }
  if (Array.isArray(task.do)) lists.push({ path: ['do'], list: task.do });
  return lists;
}

/**
 * One item of a task list: `{ <name>: <task> }`. Undefined for an item of
 * another shape.
 *
 * @public
 */
export function definitionTaskItem(
  item: unknown,
): { name: string; task: unknown } | undefined {
  if (!isObject(item)) return undefined;
  const keys = Object.keys(item);
  if (keys.length !== 1) return undefined;
  return { name: keys[0], task: item[keys[0]] };
}

/** Escapes one segment of a JSON pointer. */
export function jsonPointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * One task found by {@link walkDefinitionTasks}.
 *
 * @public
 */
export interface DefinitionTaskVisit {
  pointer: string;
  /** Path of the task in the document, for example `['do', 1, 'checkStock']`. */
  path: (string | number)[];
  name: string;
  task: unknown;
  /** Pointer of the task that holds this one; undefined at the top level. */
  parent?: string;
  /**
   * Task names from the top of the document to this task, with `try` and
   * `catch` segments in try bodies, as Zigflow builds activity names.
   */
  taskPath: string[];
  /** True for a task inside a `fork` branch. */
  inFork: boolean;
}

/**
 * Calls `visit` for every task of a definition, depth first in file order.
 * Items that are not `{ <name>: <task> }` are skipped.
 *
 * @public
 */
export function walkDefinitionTasks(
  document: unknown,
  visit: (task: DefinitionTaskVisit) => void,
) {
  const walk = (
    list: unknown[],
    path: (string | number)[],
    parent: DefinitionTaskVisit | undefined,
    taskPath: string[],
    inFork: boolean,
    depth: number,
  ) => {
    // Deeply nested documents are cut off instead of overflowing the stack.
    if (depth > 64) return;
    list.forEach((raw, index) => {
      const item = definitionTaskItem(raw);
      if (!item) return;
      const itemPath = [...path, index, item.name];
      const current: DefinitionTaskVisit = {
        pointer: `/${itemPath.map(jsonPointerSegment).join('/')}`,
        path: itemPath,
        name: item.name,
        task: item.task,
        parent: parent?.pointer,
        taskPath: [...taskPath, item.name],
        inFork,
      };
      visit(current);
      for (const inner of definitionTaskLists(item.task)) {
        walk(
          inner.list,
          [...itemPath, ...inner.path],
          current,
          inner.scope ? [...current.taskPath, inner.scope] : current.taskPath,
          inFork || inner.path[0] === 'fork',
          depth + 1,
        );
      }
    });
  };
  if (isObject(document) && Array.isArray(document.do)) {
    walk(document.do, ['do'], undefined, [], false, 0);
  }
}
