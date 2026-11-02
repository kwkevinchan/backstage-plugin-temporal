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

import type { WorkflowDefinitionTask } from '../../common';

/**
 * The task at a line of the file: the innermost task whose lines contain
 * it. Undefined for lines outside every task (the document header).
 */
export function taskAtLine(
  tasks: WorkflowDefinitionTask[],
  line: number,
): WorkflowDefinitionTask | undefined {
  let best: WorkflowDefinitionTask | undefined;
  for (const task of tasks) {
    if (line < task.startLine || line > task.endLine) continue;
    // Inner tasks start later and end sooner than the tasks around them.
    if (
      !best ||
      task.startLine > best.startLine ||
      (task.startLine === best.startLine && task.endLine < best.endLine)
    ) {
      best = task;
    }
  }
  return best;
}

/** The task of a graph box: a task box, or the join or catch of a task. */
export function pointerOfNode(id: string): string | undefined {
  if (!id.startsWith('/')) return undefined;
  const hash = id.indexOf('#');
  return hash < 0 ? id : id.slice(0, hash);
}
