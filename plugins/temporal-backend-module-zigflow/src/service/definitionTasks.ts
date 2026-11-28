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
import { Document, isMap, isSeq, LineCounter } from 'yaml';
import {
  walkDefinitionTasks,
  WorkflowDefinitionTask,
} from '../common/definition';

/** Last line with text in `[start, end)`, from 1. */
function lastLine(
  text: string,
  lineCounter: LineCounter,
  start: number,
  end: number,
): number {
  let at = Math.min(end, text.length) - 1;
  while (at > start && /\s/.test(text[at])) at--;
  return lineCounter.linePos(Math.max(at, start)).line;
}

/**
 * The tasks of a definition with the lines of each in the file: `document` is
 * the data of `doc`, the parsed `text`.
 */
export function definitionTaskLines(
  document: JsonObject,
  doc: Document,
  text: string,
  lineCounter: LineCounter,
): WorkflowDefinitionTask[] {
  const tasks: WorkflowDefinitionTask[] = [];
  walkDefinitionTasks(document, visit => {
    // The list item `{ <name>: <task> }` spans the name and the task.
    const item = doc.getIn(visit.path.slice(0, -1), true);
    const range = isMap(item) || isSeq(item) ? item.range : undefined;
    if (!range) return;
    tasks.push({
      pointer: visit.pointer,
      startLine: lineCounter.linePos(range[0]).line,
      endLine: lastLine(text, lineCounter, range[0], range[1]),
    });
  });
  return tasks;
}
