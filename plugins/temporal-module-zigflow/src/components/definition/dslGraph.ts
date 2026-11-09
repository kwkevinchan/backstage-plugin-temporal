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
  definitionTaskItem,
  definitionTaskLists,
  jsonPointerSegment,
} from '../../common/definition';

/*
 * A workflow definition in the Serverless Workflow DSL 1.0 as boxes and
 * arrows. Tasks run top to bottom in their list; `then` directives jump
 * (`continue`, `exit`, `end` or a task name). Tasks with a body get a box
 * for the task and arrows into their body:
 *
 * - `do`: the box, then the tasks of the body.
 * - `for`: the box, the body, and an arrow back ("next") for the next item;
 *   "done" leaves the loop.
 * - `fork`: the box, one branch per arrow, and a join box where they meet.
 * - `try`: the box, the body, and a catch box reached "on error", with an
 *   arrow back when the catch retries.
 * - `switch`: one arrow per case, to the case's `then`.
 *
 * Tasks of an unknown kind are plain boxes marked unsupported.
 */

/** Kind of a box in the definition graph. */
export type DefinitionNodeKind =
  | 'start'
  | 'end'
  | 'call'
  | 'run'
  | 'do'
  | 'for'
  | 'fork'
  | 'join'
  | 'try'
  | 'catch'
  | 'switch'
  | 'wait'
  | 'listen'
  | 'set'
  | 'emit'
  | 'raise'
  | 'unsupported';

export interface DefinitionGraphNode {
  /** The JSON pointer of the task; `#start`, `#end`, or `<pointer>#join`. */
  id: string;
  kind: DefinitionNodeKind;
  /** The task the box belongs to (a join and a catch belong to their task). */
  pointer?: string;
  title: string;
  subtitle: string;
  /** Short notes: `if`, `retry ×3`, `while`. */
  badges: string[];
}

/** Kind of an arrow: the next task, a loop back, an error, a jump. */
export type DefinitionEdgeKind = 'next' | 'loop' | 'error' | 'jump';

export interface DefinitionGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: DefinitionEdgeKind;
}

export interface DefinitionGraph {
  nodes: DefinitionGraphNode[];
  edges: DefinitionGraphEdge[];
}

export const START_ID = '#start';
export const END_ID = '#end';

type Directive = string | undefined;

/** The end of a path out of a task, waiting for its next box. */
interface Exit {
  from: string;
  label?: string;
  /** `then` of the path: undefined or `continue` (next task), `exit`, `end`, a task name. */
  then?: Directive;
  kind?: DefinitionEdgeKind;
}

interface Built {
  entry: string;
  exits: Exit[];
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A runtime expression without `${ }`, for short texts. */
function bare(expression: string): string {
  const match = /^\$\{\s*([\s\S]*?)\s*\}$/.exec(expression.trim());
  return match ? match[1] : expression.trim();
}

function shorten(text: string, max = 40): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const DURATION_UNITS: [string, string][] = [
  ['days', 'd'],
  ['hours', 'h'],
  ['minutes', 'm'],
  ['seconds', 's'],
  ['milliseconds', 'ms'],
];

/** `{ minutes: 1, seconds: 30 }` as `1m 30s`; ISO 8601 and expressions as written. */
export function durationText(value: unknown): string | undefined {
  if (typeof value === 'string') return shorten(bare(value), 30);
  if (!isObject(value)) return undefined;
  if (value.until !== undefined) {
    return `until ${shorten(bare(String(value.until)), 24)}`;
  }
  const parts = DURATION_UNITS.flatMap(([key, unit]) => {
    const amount = value[key];
    if (amount === undefined) return [];
    return [
      typeof amount === 'number'
        ? `${amount}${unit}`
        : `${shorten(bare(String(amount)), 16)} ${key}`,
    ];
  });
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function endpointText(endpoint: unknown): string | undefined {
  const raw = isObject(endpoint) ? endpoint.uri : endpoint;
  const text = str(raw);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return shorten(bare(text), 30);
  }
}

/** Kinds of task in the DSL, with the key that marks each one. */
const TASK_KEYS: [string, DefinitionNodeKind][] = [
  ['call', 'call'],
  ['run', 'run'],
  ['fork', 'fork'],
  ['for', 'for'],
  ['try', 'try'],
  ['switch', 'switch'],
  ['wait', 'wait'],
  ['listen', 'listen'],
  ['set', 'set'],
  ['emit', 'emit'],
  ['raise', 'raise'],
  ['do', 'do'],
];

/** Kind of a task, from the key that marks it. */
export function taskKind(task: unknown): DefinitionNodeKind {
  if (!isObject(task)) return 'unsupported';
  for (const [key, kind] of TASK_KEYS) {
    if (key in task) return kind;
  }
  return 'unsupported';
}

/** The second line of a task box. */
export function taskSubtitle(task: unknown): string {
  const kind = taskKind(task);
  const t = (isObject(task) ? task : {}) as Obj;
  const w = isObject(t.with) ? t.with : {};
  switch (kind) {
    case 'call': {
      const call = str(t.call) ?? '?';
      if (call === 'activity') return `Activity ${str(w.name) ?? '?'}`;
      if (call === 'http') {
        const method = str(w.method)?.toUpperCase() ?? 'GET';
        const target = endpointText(w.endpoint);
        return `HTTP ${method}${target ? ` ${target}` : ''}`;
      }
      if (call === 'grpc') {
        const service = isObject(w.service) ? str(w.service.name) : undefined;
        const method = str(w.method);
        return `gRPC ${[service, method].filter(Boolean).join('.') || '?'}`;
      }
      if (call === 'openapi') {
        return `OpenAPI ${str(w.operationId) ?? '?'}`;
      }
      if (call === 'asyncapi') {
        return `AsyncAPI ${str(w.operation) ?? str(w.operationRef) ?? '?'}`;
      }
      return `Call ${shorten(call, 30)}`;
    }
    case 'run': {
      const run = isObject(t.run) ? t.run : {};
      if (isObject(run.workflow)) {
        return `Child workflow ${
          str(run.workflow.type) ?? str(run.workflow.name) ?? '?'
        }`;
      }
      if (isObject(run.shell)) {
        return `Shell ${shorten(str(run.shell.command) ?? '?', 30)}`;
      }
      if (isObject(run.script)) {
        return `Script${
          str(run.script.language) ? ` (${str(run.script.language)})` : ''
        }`;
      }
      if (isObject(run.container)) {
        return `Container ${shorten(str(run.container.image) ?? '?', 30)}`;
      }
      return 'Run';
    }
    case 'do':
      return `Do · ${Array.isArray(t.do) ? t.do.length : 0} tasks`;
    case 'for': {
      const loop = isObject(t.for) ? t.for : {};
      const each = str(loop.each) ?? 'item';
      const into = str(loop.in);
      return `For each ${each}${into ? ` in ${shorten(bare(into), 24)}` : ''}`;
    }
    case 'fork': {
      const fork = isObject(t.fork) ? t.fork : {};
      const count = Array.isArray(fork.branches) ? fork.branches.length : 0;
      return `${
        fork.compete === true ? 'Race' : 'Parallel'
      } · ${count} branches`;
    }
    case 'try': {
      const handler = isObject(t.catch) ? t.catch : {};
      return `Try · errors as ${str(handler.as) ?? 'error'}`;
    }
    case 'switch': {
      const count = Array.isArray(t.switch) ? t.switch.length : 0;
      return `Switch · ${count} ${count === 1 ? 'case' : 'cases'}`;
    }
    case 'wait':
      return `Wait ${durationText(t.wait) ?? ''}`.trim();
    case 'listen': {
      const to = isObject(t.listen) && isObject(t.listen.to) ? t.listen.to : {};
      const events = listenEvents(to);
      if (events.length === 1) {
        return `${capital(events[0].type ?? 'event')} ${events[0].id ?? '?'}`;
      }
      const mode = 'all' in to ? 'all' : 'any';
      return `Listen · ${mode} of ${events.length} events`;
    }
    case 'set': {
      const keys = isObject(t.set) ? Object.keys(t.set) : [];
      return keys.length > 0 ? `Set ${shorten(keys.join(', '), 30)}` : 'Set';
    }
    case 'emit': {
      const event =
        isObject(t.emit) && isObject(t.emit.event) ? t.emit.event : {};
      const props = isObject(event.with) ? event.with : {};
      return `Emit ${str(props.type) ?? 'event'}`;
    }
    case 'raise': {
      const error =
        isObject(t.raise) && isObject(t.raise.error) ? t.raise.error : {};
      const type = str(error.type);
      return `Raise ${
        str(error.title) ??
        (type ? type.split('/').pop() : undefined) ??
        'error'
      }`;
    }
    default: {
      const key = isObject(task) ? Object.keys(task)[0] : undefined;
      return `Unsupported task${key ? ` (${key})` : ''}`;
    }
  }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The events of a `listen.to`: `one`, or the list of `all` or `any`. */
export function listenEvents(to: Obj): { id?: string; type?: string }[] {
  let filters: unknown[] = [];
  if (isObject(to.one)) filters = [to.one];
  else if (Array.isArray(to.all)) filters = to.all;
  else if (Array.isArray(to.any)) filters = to.any;
  return filters.map(filter => {
    const props = isObject(filter) && isObject(filter.with) ? filter.with : {};
    return { id: str(props.id), type: str(props.type) };
  });
}

function badgesOf(task: unknown): string[] {
  if (!isObject(task)) return [];
  const badges: string[] = [];
  if (task.if !== undefined) badges.push('if');
  if ('for' in task && task.while !== undefined) badges.push('while');
  const metadata = isObject(task.metadata) ? task.metadata : {};
  const options = isObject(metadata.activityOptions)
    ? metadata.activityOptions
    : {};
  const retry = isObject(options.retryPolicy) ? options.retryPolicy : {};
  if (typeof retry.maximumAttempts === 'number') {
    badges.push(`retry ×${retry.maximumAttempts}`);
  }
  return badges;
}

/** `then` of a task or a switch case. */
function directiveOf(value: unknown): Directive {
  return str(value);
}

/** The `retry` of a catch, as a short text: `retry`, `retry ×3`. */
function retryText(handler: Obj): string | undefined {
  if (handler.retry === undefined) return undefined;
  const retry = isObject(handler.retry) ? handler.retry : {};
  const limit = isObject(retry.limit) ? retry.limit : {};
  const attempt = isObject(limit.attempt) ? limit.attempt : {};
  return typeof attempt.count === 'number'
    ? `retry ×${attempt.count}`
    : 'retry';
}

/** Builds the graph of a parsed definition. */
export function buildDefinitionGraph(document: unknown): DefinitionGraph {
  const nodes: DefinitionGraphNode[] = [];
  const edges: DefinitionGraphEdge[] = [];
  const edgeIds = new Set<string>();
  /** Entry box of every task by name, for `then: <name>` across scopes. */
  const byName = new Map<string, string>();
  /** Jumps to task names, resolved once every task is known. */
  const jumps: { exit: Exit; scope: Map<string, string> }[] = [];

  const addEdge = (exit: Exit, target: string, kind?: DefinitionEdgeKind) => {
    let id = `${exit.from}->${target}`;
    if (exit.label) id += `:${exit.label}`;
    // Two cases of a switch can lead to the same box.
    let n = 2;
    while (edgeIds.has(id)) id = `${exit.from}->${target}:${n++}`;
    edgeIds.add(id);
    const edge: DefinitionGraphEdge = {
      id,
      source: exit.from,
      target,
      kind: kind ?? exit.kind ?? 'next',
    };
    if (exit.label) edge.label = exit.label;
    edges.push(edge);
  };

  const addNode = (node: DefinitionGraphNode) => {
    nodes.push(node);
    return node.id;
  };

  function buildList(
    list: unknown[],
    pointer: string,
    depth: number,
  ): Built | undefined {
    const built: { name: string; built: Built; then: Directive }[] = [];
    list.forEach((raw, index) => {
      const item = definitionTaskItem(raw);
      if (!item) return;
      const itemPointer = `${pointer}/${index}/${jsonPointerSegment(
        item.name,
      )}`;
      const result = buildTask(item.name, item.task, itemPointer, depth);
      byName.set(item.name, result.entry);
      built.push({
        name: item.name,
        built: result,
        then: isObject(item.task) ? directiveOf(item.task.then) : undefined,
      });
    });
    if (built.length === 0) return undefined;
    const scope = new Map(built.map(b => [b.name, b.built.entry]));
    const exits: Exit[] = [];
    let waiting: Exit[] = [];
    for (const { built: b, then } of built) {
      for (const exit of waiting) addEdge(exit, b.entry);
      waiting = [];
      for (const raw of b.exits) {
        const exit = raw.then === undefined && then ? { ...raw, then } : raw;
        const directive = exit.then;
        if (directive === undefined || directive === 'continue') {
          waiting.push(exit);
        } else if (directive === 'exit') {
          exits.push(exit);
        } else if (directive === 'end') {
          addEdge(exit, END_ID, exit.kind ?? 'jump');
        } else {
          jumps.push({ exit, scope });
        }
      }
    }
    exits.push(...waiting);
    return { entry: built[0].built.entry, exits };
  }

  function buildTask(
    name: string,
    task: unknown,
    pointer: string,
    depth: number,
  ): Built {
    const kind = taskKind(task);
    const id = addNode({
      id: pointer,
      kind,
      pointer,
      title: name,
      subtitle: taskSubtitle(task),
      badges: badgesOf(task),
    });
    const t = (isObject(task) ? task : {}) as Obj;
    // Very deep documents stop drawing bodies instead of overflowing.
    const lists = depth > 32 ? [] : definitionTaskLists(task);
    const listAt = (path: string) => lists.find(l => l.path.join('/') === path);

    switch (kind) {
      case 'do': {
        const body = listAt('do');
        const inner = body
          ? buildList(body.list, `${pointer}/do`, depth + 1)
          : undefined;
        if (!inner) return { entry: id, exits: [{ from: id }] };
        addEdge({ from: id }, inner.entry);
        return { entry: id, exits: inner.exits };
      }
      case 'for': {
        const body = listAt('do');
        const inner = body
          ? buildList(body.list, `${pointer}/do`, depth + 1)
          : undefined;
        if (inner) {
          addEdge({ from: id, label: 'each' }, inner.entry);
          for (const exit of inner.exits) {
            addEdge({ ...exit, label: 'next' }, id, 'loop');
          }
        }
        return { entry: id, exits: [{ from: id, label: 'done' }] };
      }
      case 'fork': {
        const branches = listAt('fork/branches');
        const fork = isObject(t.fork) ? t.fork : {};
        const join = addNode({
          id: `${pointer}#join`,
          kind: 'join',
          pointer,
          title: fork.compete === true ? 'First to finish' : 'Join',
          subtitle: `End of ${name}`,
          badges: [],
        });
        branches?.list.forEach((raw, index) => {
          const item = definitionTaskItem(raw);
          if (!item) return;
          const branch = buildTask(
            item.name,
            item.task,
            `${pointer}/fork/branches/${index}/${jsonPointerSegment(
              item.name,
            )}`,
            depth + 1,
          );
          addEdge({ from: id, label: item.name }, branch.entry);
          for (const exit of branch.exits) addEdge(exit, join);
        });
        return { entry: id, exits: [{ from: join }] };
      }
      case 'try': {
        const body = listAt('try');
        const handlerList = listAt('catch/do');
        const handler = isObject(t.catch) ? t.catch : {};
        const inner = body
          ? buildList(body.list, `${pointer}/try`, depth + 1)
          : undefined;
        const exits: Exit[] = [];
        if (inner) {
          addEdge({ from: id }, inner.entry);
          exits.push(...inner.exits);
        } else {
          exits.push({ from: id });
        }
        const when = str(handler.when);
        const catchId = addNode({
          id: `${pointer}#catch`,
          kind: 'catch',
          pointer,
          title: 'Catch',
          subtitle: when
            ? `When ${shorten(bare(when), 30)}`
            : `Errors as ${str(handler.as) ?? 'error'}`,
          badges: [retryText(handler)].filter((b): b is string => Boolean(b)),
        });
        addEdge({ from: id, label: 'on error' }, catchId, 'error');
        if (handler.retry !== undefined) {
          addEdge({ from: catchId, label: 'retry' }, id, 'loop');
        }
        const recovery = handlerList
          ? buildList(handlerList.list, `${pointer}/catch/do`, depth + 1)
          : undefined;
        if (recovery) {
          addEdge({ from: catchId }, recovery.entry);
          exits.push(...recovery.exits);
        } else {
          exits.push({ from: catchId });
        }
        return { entry: id, exits };
      }
      case 'switch': {
        const cases = Array.isArray(t.switch) ? t.switch : [];
        const exits: Exit[] = [];
        let hasDefault = false;
        for (const raw of cases) {
          const item = definitionTaskItem(raw);
          if (!item || !isObject(item.task)) continue;
          const when = str(item.task.when);
          if (!when) hasDefault = true;
          exits.push({
            from: id,
            label: item.name,
            then: directiveOf(item.task.then) ?? 'continue',
            kind: 'jump',
          });
        }
        if (!hasDefault) {
          exits.push({ from: id, label: 'no match', then: 'continue' });
        }
        return { entry: id, exits };
      }
      case 'raise':
        // A raise does not continue: the error goes to the closest catch.
        return { entry: id, exits: [] };
      default:
        return { entry: id, exits: [{ from: id }] };
    }
  }

  addNode({
    id: START_ID,
    kind: 'start',
    title: 'Start',
    subtitle: workflowName(document),
    badges: [],
  });
  const top =
    isObject(document) && Array.isArray(document.do)
      ? buildList(document.do, '/do', 0)
      : undefined;
  addNode({ id: END_ID, kind: 'end', title: 'End', subtitle: '', badges: [] });
  if (top) {
    addEdge({ from: START_ID }, top.entry);
    for (const exit of top.exits) addEdge(exit, END_ID);
  } else {
    addEdge({ from: START_ID }, END_ID);
  }
  for (const { exit, scope } of jumps) {
    const target = scope.get(exit.then!) ?? byName.get(exit.then!);
    // A jump to a task that does not exist is left out.
    if (target) addEdge(exit, target, exit.kind ?? 'jump');
  }
  return { nodes, edges };
}

/** `document.title`, or the workflow type of a Zigflow file, or the name. */
export function workflowName(document: unknown): string {
  const header =
    isObject(document) && isObject(document.document) ? document.document : {};
  return (
    str(header.title) ?? str(header.workflowType) ?? str(header.name) ?? ''
  );
}
