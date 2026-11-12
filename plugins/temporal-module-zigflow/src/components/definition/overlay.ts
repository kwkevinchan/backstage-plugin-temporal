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

import {
  WorkflowGraphNode,
  WorkflowGraphResponse,
  WorkflowNodeStatus,
} from '@kwkevinchan/backstage-plugin-temporal-frontend/common';
import { walkDefinitionTasks } from '../../common/definition';
import { listenEvents, taskKind } from './dslGraph';

/*
 * Which history events belong to which task of a definition, for workflows
 * that Zigflow runs (Zigflow 0.18). Zigflow names what it starts:
 *
 * - `call: http`, `call: grpc` and `run` with `shell`, `script` or
 *   `container`: an activity of type `<workflowType>.<task path>`. The path
 *   is the task names from the top of the document, joined with `.`; tasks
 *   in a `try` body have a `try` segment, tasks in a `catch` a `catch`
 *   segment. A `.` or `\` in a name is escaped with `\`.
 * - `call: activity`: an activity of the type in `with.name`.
 * - `run: workflow`: a child workflow of the type in `workflow.type`.
 * - a `fork` branch: a child workflow `workflow_fork_<fork>_<branch>`. The
 *   tasks of the branch run in that child, not in this history.
 * - a `switch` case with `then: <task>`: a child workflow of type `<task>`.
 *   The tasks of the target then run in the child.
 * - `listen` for a signal or an update: the signal or update by its name.
 *
 * `set`, `switch`, `wait`, `raise` and the boxes of `do`, `for` and `try`
 * leave no event that names them, so they are not marked. A name that
 * several tasks use (two `call: activity` of the same activity) is not
 * marked either: the history does not tell which task it was.
 */

/** How one history event (or a set of them) names a task. */
export interface TaskIdentity {
  activityType?: string;
  childWorkflowType?: string;
  signals?: string[];
  updates?: string[];
  /** `all`: every signal or update must arrive; otherwise one is enough. */
  listenAll?: boolean;
  /**
   * The task may run in a child workflow (inside a fork branch or a switch
   * target): found events mark it, missing events say nothing.
   */
  maybeInChild?: boolean;
}

/** State of a task in a run. */
export type TaskRunStatus = WorkflowNodeStatus | 'NotReached' | 'Pending';

export interface TaskRunMark {
  status: TaskRunStatus;
  /** Steps of the run graph that belong to the task, oldest first. */
  stepIds: string[];
  /** How often the task ran (loops and retries of the whole task). */
  count: number;
}

export interface DefinitionOverlay {
  /** Marks by task pointer. Tasks without a mark are not known. */
  marks: Map<string, TaskRunMark>;
  /** Steps of the run that no task claims. */
  unmatched: number;
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** One segment of a Zigflow activity name. */
function escapeSegment(segment: string): string {
  return segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
}

/** The activity type Zigflow registers for a task at `taskPath`. */
export function zigflowActivityType(
  workflowType: string,
  taskPath: string[],
): string {
  return [workflowType, ...taskPath].map(escapeSegment).join('.');
}

/** Workflow type of the document: `workflowType` (Zigflow) or `name`. */
function documentWorkflowType(document: unknown): string | undefined {
  const header =
    isObject(document) && isObject(document.document) ? document.document : {};
  return str(header.workflowType) ?? str(header.name);
}

/** Names of the tasks that a `switch` jumps to. */
function switchTargets(document: unknown): Set<string> {
  const targets = new Set<string>();
  walkDefinitionTasks(document, visit => {
    const task = visit.task;
    if (!isObject(task) || !Array.isArray(task.switch)) return;
    for (const item of task.switch) {
      if (!isObject(item)) continue;
      for (const value of Object.values(item)) {
        const then = isObject(value) ? str(value.then) : undefined;
        if (then && !['continue', 'exit', 'end'].includes(then)) {
          targets.add(then);
        }
      }
    }
  });
  return targets;
}

/** How each task of a definition shows in the history, by task pointer. */
export function taskIdentities(document: unknown): Map<string, TaskIdentity> {
  const workflowType = documentWorkflowType(document);
  const targets = switchTargets(document);
  const identities = new Map<string, TaskIdentity>();
  /** Pointers of tasks whose body may run in a child workflow. */
  const childScopes = new Set<string>();
  const forks = new Set<string>();

  walkDefinitionTasks(document, visit => {
    const task = (isObject(visit.task) ? visit.task : {}) as Obj;
    const kind = taskKind(task);
    const parent = visit.parent;
    const inChild = parent !== undefined && childScopes.has(parent);
    const identity: TaskIdentity = {};
    if (inChild) identity.maybeInChild = true;

    if (parent !== undefined && forks.has(parent)) {
      // A fork branch runs as a child workflow; its tasks run in the child.
      const fork = visit.taskPath[visit.taskPath.length - 2];
      identity.childWorkflowType = `workflow_fork_${fork}_${visit.name}`;
      childScopes.add(visit.pointer);
    } else if (kind === 'call') {
      const call = str(task.call);
      const w = isObject(task.with) ? task.with : {};
      if (call === 'activity') identity.activityType = str(w.name);
      else if ((call === 'http' || call === 'grpc') && workflowType) {
        identity.activityType = zigflowActivityType(
          workflowType,
          visit.taskPath,
        );
      }
    } else if (kind === 'run') {
      const run = isObject(task.run) ? task.run : {};
      if (isObject(run.workflow)) {
        identity.childWorkflowType =
          str(run.workflow.type) ?? str(run.workflow.name);
      } else if (
        workflowType &&
        (isObject(run.shell) || isObject(run.script) || isObject(run.container))
      ) {
        identity.activityType = zigflowActivityType(
          workflowType,
          visit.taskPath,
        );
      }
    } else if (kind === 'listen') {
      const to =
        isObject(task.listen) && isObject(task.listen.to) ? task.listen.to : {};
      const events = listenEvents(to);
      const signals = events.filter(e => e.type === 'signal' && e.id);
      const updates = events.filter(e => e.type === 'update' && e.id);
      if (signals.length > 0) identity.signals = signals.map(e => e.id!);
      if (updates.length > 0) identity.updates = updates.map(e => e.id!);
      if ('all' in to) identity.listenAll = true;
    }

    if (kind === 'fork') forks.add(visit.pointer);
    if (targets.has(visit.name) && kind === 'do') {
      // A switch runs its target as a child workflow named after the task.
      if (!identity.childWorkflowType && !identity.activityType) {
        identity.childWorkflowType = visit.name;
        identity.maybeInChild = true;
      }
      childScopes.add(visit.pointer);
    }
    if (inChild) childScopes.add(visit.pointer);
    if (
      identity.activityType ||
      identity.childWorkflowType ||
      identity.signals ||
      identity.updates
    ) {
      identities.set(visit.pointer, identity);
    }
  });

  // A name that two tasks share does not tell them apart.
  const count = new Map<string, number>();
  const keys = (identity: TaskIdentity) => [
    ...(identity.activityType ? [`a:${identity.activityType}`] : []),
    ...(identity.childWorkflowType ? [`c:${identity.childWorkflowType}`] : []),
    ...(identity.signals ?? []).map(s => `s:${s}`),
    ...(identity.updates ?? []).map(u => `u:${u}`),
  ];
  for (const identity of identities.values()) {
    for (const key of keys(identity)) {
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (const [pointer, identity] of identities) {
    if (keys(identity).some(key => (count.get(key) ?? 0) > 1)) {
      identities.delete(pointer);
    }
  }
  return identities;
}

/** Order of the steps: by start time, then as the backend listed them. */
function byStart(steps: WorkflowGraphNode[]): WorkflowGraphNode[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const ta = a.step.startTime ? Date.parse(a.step.startTime) : NaN;
      const tb = b.step.startTime ? Date.parse(b.step.startTime) : NaN;
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map(({ step }) => step);
}

/**
 * Marks the tasks of a definition with the steps of one run: the status of
 * the latest step of the task, how often it ran, and for tasks without any
 * step, `NotReached` (closed run) or `Pending` (running run).
 */
export function overlayRun(
  document: unknown,
  run: WorkflowGraphResponse,
): DefinitionOverlay {
  const identities = taskIdentities(document);
  const steps = byStart(run.nodes.filter(n => !n.internal));
  const claimed = new Set<string>();
  const marks = new Map<string, TaskRunMark>();
  const running = run.status === 'Running';

  for (const [pointer, identity] of identities) {
    let found: WorkflowGraphNode[] = [];
    if (identity.activityType) {
      found = steps.filter(
        s => s.kind === 'activity' && s.name === identity.activityType,
      );
    } else if (identity.childWorkflowType) {
      found = steps.filter(
        s =>
          s.kind === 'childWorkflow' && s.name === identity.childWorkflowType,
      );
    } else {
      const names = new Set([
        ...(identity.signals ?? []),
        ...(identity.updates ?? []),
      ]);
      found = steps.filter(
        s =>
          (s.kind === 'signal' && identity.signals?.includes(s.name)) ||
          (s.kind === 'update' && identity.updates?.includes(s.name)),
      );
      if (identity.listenAll && found.length > 0) {
        const seen = new Set(found.map(s => s.name));
        if ([...names].some(name => !seen.has(name))) {
          // Some of the events have arrived: still waiting for the others.
          for (const step of found) claimed.add(step.id);
          marks.set(pointer, {
            status: running ? 'Waiting' : 'NotReached',
            stepIds: found.map(s => s.id),
            count: 1,
          });
          continue;
        }
      }
    }
    if (found.length === 0) {
      if (identity.maybeInChild) continue;
      marks.set(pointer, {
        status: running ? 'Pending' : 'NotReached',
        stepIds: [],
        count: 0,
      });
      continue;
    }
    for (const step of found) claimed.add(step.id);
    const last = found[found.length - 1];
    marks.set(pointer, {
      status: last.status,
      stepIds: found.map(s => s.id),
      count: identity.signals || identity.updates ? 1 : found.length,
    });
  }

  const countable = steps.filter(s =>
    ['activity', 'childWorkflow', 'signal', 'update'].includes(s.kind),
  );
  return {
    marks,
    unmatched: countable.filter(s => !claimed.has(s.id)).length,
  };
}
