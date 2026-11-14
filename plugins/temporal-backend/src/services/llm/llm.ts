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

import type { JsonValue } from '@backstage/types';
import { addLlmUsage } from '../../common';
import type {
  WorkflowGraphNode,
  WorkflowLlmRecord,
  WorkflowLlmSummary,
  WorkflowLlmToolCallRef,
  WorkflowNodeStatus,
} from '../../common';
import type {
  TemporalLlmModelCall,
  TemporalLlmStep,
  TemporalLlmStepPayloads,
} from '../../node/alpha';
import { canonicalJson, isObject, Json, str } from './json';
import type { LlmModelCalls, LlmStepReader } from './LlmAdapters';

/*
 * Model calls and tool calls of a run. The LLM adapters (`LlmAdapters`)
 * read each step; this file turns what they read into the summaries of the
 * graph and links tool calls to the model calls that asked for them:
 *
 * 1. A step that records a tool call ID (an adapter says so) is linked to
 *    the latest model call before it whose output asked for that ID.
 * 2. Other tool calls of a model call's output are matched to the steps
 *    scheduled after the call ended and before the next call of the same
 *    agent was scheduled (the call whose input answers that tool call ID,
 *    else the next model call), by tool name, then arguments, then order.
 *    These links are marked `inferred`: two calls of one tool with the same
 *    arguments are matched in the order they were scheduled.
 */

/** A step of a run with what the LLM reading needs. */
export interface LlmLinkNode extends WorkflowGraphNode {
  /** Event ID of the first and of the closing event. */
  first: number;
  last?: number;
}

/** A step to read with the adapters, and its payloads (protobuf JSON). */
export interface LlmStepEntry {
  node: LlmLinkNode;
  step: TemporalLlmStep;
  /** `{ payloads }` of the input. */
  input?: Json;
  /** `{ payloads }` of the result, when the step completed with one. */
  result?: Json;
  /** Failures of failed attempts, newest first. */
  failures: Json[];
  /** Decoded result of a local activity (from its marker). */
  localResult?: unknown;
}

/** The values of decoded payloads, or undefined when one is not readable. */
function values(decoded: unknown): JsonValue[] | undefined {
  const list = Array.isArray(decoded) ? decoded : [decoded];
  const out: JsonValue[] = [];
  for (const d of list) {
    if (!isObject(d) || !('value' in d)) return undefined;
    out.push(d.value as JsonValue);
  }
  return out;
}

/** Decodes `{ payloads }` (protobuf JSON) like `decodePayloads` of convert. */
export type DecodePayloads = (raw: Json) => JsonValue | undefined;

/** The failure details of a failure and its causes. */
function failureDetails(failure: Json, decodePayloads: DecodePayloads) {
  const out: JsonValue[] = [];
  for (let f = failure, depth = 0; f && depth < 5; f = f.cause, depth++) {
    const decoded = decodePayloads(f.applicationFailureInfo?.details);
    if (decoded === undefined) continue;
    out.push(...(values(decoded) ?? []));
  }
  return out;
}

/** Defines a property that is computed on first read, then kept. */
function lazy<T extends object, K extends keyof T>(
  target: T,
  key: K,
  compute: () => T[K] | undefined,
) {
  let done = false;
  let value: T[K] | undefined;
  Object.defineProperty(target, key, {
    enumerable: true,
    get() {
      if (!done) {
        value = compute();
        done = true;
      }
      return value;
    },
  });
}

/**
 * The decoded payloads of a step for the adapters. Each payload is decoded
 * when it is first read: most steps are read by no adapter.
 */
export function stepPayloads(
  entry: LlmStepEntry,
  decodePayloads: DecodePayloads,
): {
  payloads: TemporalLlmStepPayloads;
  /** The decoded result, also when it is not readable. */
  decodedResult: () => unknown;
} {
  const payloads: TemporalLlmStepPayloads = {};
  let decoded: unknown;
  let decodedOnce = false;
  const decodedResult = () => {
    if (!decodedOnce && entry.step.kind === 'activity' && entry.result) {
      decoded = decodePayloads(entry.result) ?? null;
    }
    decodedOnce = true;
    return decoded;
  };
  if (entry.input) {
    lazy(payloads, 'input', () => {
      const input = decodePayloads(entry.input);
      return input === undefined ? undefined : values(input);
    });
  }
  if (entry.step.kind === 'localActivity') {
    if (entry.localResult !== undefined) {
      payloads.result = entry.localResult as JsonValue;
    }
  } else if (entry.result) {
    lazy(payloads, 'result', () => {
      const result = values(decodedResult());
      return result && result.length === 1 ? result[0] : result;
    });
  } else if (entry.failures.length > 0) {
    lazy(payloads, 'failureDetails', () =>
      entry.failures.flatMap(f => failureDetails(f, decodePayloads)),
    );
  }
  return { payloads, decodedResult };
}

function hasReasoning(record: WorkflowLlmRecord): boolean {
  return (
    (record.usage.reasoningTokens ?? 0) > 0 ||
    record.outputMessages.some(m =>
      m.parts.some(p => p.type === 'reasoning' || /thinking/.test(p.type)),
    )
  );
}

/** A tool call in the output of a model call. */
interface ToolRequest {
  ref: WorkflowLlmToolCallRef;
  arguments?: JsonValue;
}

/** Tool calls in the output of a record, in order. */
function outputToolCalls(record: WorkflowLlmRecord): ToolRequest[] {
  const calls: ToolRequest[] = [];
  for (const message of record.outputMessages) {
    for (const part of message.parts) {
      if (part.type !== 'tool_call') continue;
      const ref: WorkflowLlmToolCallRef = { name: str(part.name) ?? 'tool' };
      if (str(part.id)) ref.id = part.id as string;
      calls.push({ ref, arguments: part.arguments });
    }
  }
  return calls;
}

/** IDs of the tool calls the input of a record answers. */
function answeredToolCalls(record: WorkflowLlmRecord): Set<string> {
  const ids = new Set<string>();
  for (const message of record.inputMessages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call_response' && str(part.id)) {
        ids.add(part.id as string);
      }
    }
  }
  return ids;
}

/** Milliseconds between two ISO times, when both are set. */
function between(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

const OPEN = ['Scheduled', 'Running', 'Retrying', 'Waiting'];

/**
 * The summary of the model calls of one step. `decodedResult` is the
 * decoded result payload (`{ encoding, value }`, a stored payload, or
 * undecodable), for the state of a call without a record.
 */
export function summarizeModelCalls(
  node: Pick<
    WorkflowGraphNode,
    'status' | 'startTime' | 'endTime' | 'attempts'
  >,
  read: LlmModelCalls,
  decodedResult: unknown,
): { summary: WorkflowLlmSummary; requests: ToolRequest[] } {
  const { calls, framework } = read;
  const summary: WorkflowLlmSummary = {
    framework,
    record: 'pending',
    toolCalls: [],
    reasoning: false,
  };
  if (calls[0]?.name) summary.call = calls[0].name;
  if (calls.length > 1) summary.callCount = calls.length;
  const startedTime = node.attempts?.[node.attempts.length - 1]?.startedTime;
  const activityMs = between(startedTime ?? node.startTime, node.endTime);
  if (activityMs !== undefined && node.endTime) summary.durationMs = activityMs;
  const records = calls
    .map(c => c.record)
    .filter((r): r is WorkflowLlmRecord => r !== undefined);
  if (records.length === 0) {
    if (isObject(decodedResult)) {
      summary.record = 'value' in decodedResult ? 'missing' : 'unreadable';
    } else if (!OPEN.includes(node.status)) {
      summary.record = 'missing';
    }
    return { summary, requests: [] };
  }
  summary.record = 'available';
  const last = records[records.length - 1];
  if (records[0].operation) summary.operation = records[0].operation;
  const providers = new Set(records.map(r => r.provider));
  if (providers.size === 1 && last.provider) summary.provider = last.provider;
  const model = last.responseModel ?? last.requestModel;
  if (model) summary.model = model;
  let usage = undefined as WorkflowLlmSummary['usage'];
  for (const r of records) {
    if (Object.keys(r.usage).length > 0) usage = addLlmUsage(usage, r.usage);
  }
  if (usage) summary.usage = usage;
  if (records.length === 1 && last.durationMs !== undefined)
    summary.durationMs = last.durationMs;
  if (last.finishReasons?.length) summary.finishReasons = last.finishReasons;
  const error = [...records].reverse().find(r => r.error)?.error;
  if (error) summary.error = error.type ?? error.message;
  summary.reasoning = records.some(hasReasoning);
  const requests = records.flatMap(outputToolCalls);
  summary.toolCalls = requests.map(r => r.ref);
  for (const record of records) {
    for (const execution of record.toolExecutions) {
      const status: WorkflowNodeStatus = execution.error
        ? 'Failed'
        : 'Completed';
      const listed = summary.toolCalls.find(
        c => c.id !== undefined && c.id === execution.id,
      );
      if (listed) {
        listed.inActivity = true;
        listed.status = status;
      } else {
        summary.toolCalls.push({
          ...(execution.id ? { id: execution.id } : {}),
          name: execution.name,
          inActivity: true,
          status,
        });
      }
    }
  }
  return { summary, requests };
}

/** A tool name in a form that ignores case and separators. */
function nameKey(name: string | undefined): string {
  return (name ?? '').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
}

interface ModelStep {
  entry: LlmStepEntry;
  calls: TemporalLlmModelCall[];
  requests: ToolRequest[];
  answered: Set<string>;
}

interface ToolStep {
  entry: LlmStepEntry;
  /** Read for the arguments only when the step is a candidate. */
  payloads: TemporalLlmStepPayloads;
  toolName?: string;
  toolCallId?: string;
  modelCall?: string;
}

/** The result of reading the steps of a run. */
export interface LlmSteps {
  /** The model calls of each model call step, by node ID. */
  calls: Map<string, LlmModelCalls>;
}

/**
 * Reads the steps of a run with the adapters: sets `llm` on the model
 * calls and `tool` on the tool calls, and links them.
 */
export function readLlmSteps(
  entries: LlmStepEntry[],
  reader: LlmStepReader,
  decodePayloads: DecodePayloads,
): LlmSteps {
  const calls = new Map<string, LlmModelCalls>();
  const models: ModelStep[] = [];
  const tools: ToolStep[] = [];
  const plain: ToolStep[] = [];
  for (const entry of [...entries].sort(
    (a, b) => a.node.first - b.node.first,
  )) {
    const { payloads, decodedResult } = stepPayloads(entry, decodePayloads);
    const read =
      entry.step.kind === 'activity'
        ? reader.readModelCalls(entry.step, payloads)
        : undefined;
    if (read) {
      const { summary, requests } = summarizeModelCalls(
        entry.node,
        read,
        decodedResult(),
      );
      entry.node.llm = summary;
      calls.set(entry.node.id, read);
      const answered = new Set<string>();
      for (const c of read.calls) {
        if (c.record)
          answeredToolCalls(c.record).forEach(id => answered.add(id));
      }
      models.push({ entry, calls: read.calls, requests, answered });
      continue;
    }
    const tool = reader.readToolCall(entry.step, payloads)?.tool;
    const step: ToolStep = { entry, payloads, ...tool };
    // A local activity that ran a tool is shown by its activity type.
    if (tool && entry.step.kind === 'localActivity' && entry.step.activityType)
      entry.node.name = entry.step.activityType;
    (tool ? tools : plain).push(step);
  }
  linkByToolCallId(models, tools);
  linkByInference(models, [
    ...tools.filter(t => !t.toolCallId && !t.entry.node.tool),
    ...plain.filter(p => p.entry.step.kind === 'activity'),
  ]);
  return { calls };
}

function link(
  tool: ToolStep,
  owner: ModelStep | undefined,
  ref: WorkflowLlmToolCallRef | undefined,
  inferred: boolean,
) {
  const node = tool.entry.node;
  node.tool = {};
  const call = tool.modelCall ?? owner?.entry.node.llm?.call;
  if (call !== undefined) node.tool.call = call;
  const toolCallId = tool.toolCallId ?? ref?.id;
  if (toolCallId !== undefined) node.tool.toolCallId = toolCallId;
  if (owner) node.tool.llmNodeId = owner.entry.node.id;
  const name = tool.toolName ?? ref?.name;
  if (name !== undefined && (owner || tool.toolName)) node.tool.name = name;
  if (inferred) node.tool.inferred = true;
  if (!ref) return;
  ref.nodeId = node.id;
  ref.status = node.status;
  delete ref.inActivity;
  if (inferred) ref.inferred = true;
}

/** Steps that record a tool call ID: the model call that asked for it. */
function linkByToolCallId(models: ModelStep[], tools: ToolStep[]) {
  for (const tool of tools) {
    const before = models
      .filter(m => m.entry.node.first < tool.entry.node.first)
      .reverse();
    const id = tool.toolCallId;
    const refOf = (m: ModelStep | undefined) =>
      m?.entry.node.llm!.toolCalls.find(c => c.id === id && !c.nodeId);
    let owner =
      id === undefined ? undefined : before.find(m => refOf(m) !== undefined);
    let ref = refOf(owner);
    if (!owner && tool.modelCall !== undefined) {
      // The model call by its name, when its record is not readable.
      owner = before.find(m => m.entry.node.llm?.call === tool.modelCall);
      if (owner && id !== undefined) {
        ref = refOf(owner);
        if (!ref) {
          ref = { id, name: tool.entry.node.name };
          owner.entry.node.llm!.toolCalls.push(ref);
        }
      }
    }
    if (owner || id !== undefined) link(tool, owner, ref, false);
  }
}

/** Tool calls without an ID on their step: by name, arguments and order. */
function linkByInference(models: ModelStep[], candidates: ToolStep[]) {
  const used = new Set<ToolStep>();
  models.forEach((model, i) => {
    const start = model.entry.node.last;
    if (start === undefined) return;
    for (const request of model.requests) {
      const { ref } = request;
      if (ref.nodeId || ref.inActivity) continue;
      const next =
        (ref.id !== undefined
          ? models.slice(i + 1).find(m => m.answered.has(ref.id!))
          : undefined) ??
        models.slice(i + 1).find(m => m.entry.node.first > start);
      const end = next?.entry.node.first ?? Infinity;
      const key = nameKey(ref.name);
      const matching = candidates.filter(c => {
        const { node, step } = c.entry;
        return (
          !used.has(c) &&
          node.first > start &&
          node.first < end &&
          [c.toolName, step.activityType, step.summary].some(
            n => n !== undefined && nameKey(n) === key,
          )
        );
      });
      const args =
        request.arguments === undefined
          ? undefined
          : canonicalJson(request.arguments);
      const found =
        matching.find(c => {
          const input = c.payloads.input;
          return (
            args !== undefined &&
            input?.length === 1 &&
            canonicalJson(input[0]) === args
          );
        }) ?? matching[0];
      if (!found) continue;
      used.add(found);
      link(found, model, ref, true);
    }
  });
}

/** Activity ID of a local activity from its marker details, when readable. */
export function localActivityId(details: unknown): string | undefined {
  return localActivityData(details, 'activity_id', 'activityId');
}

/** Activity type of a local activity from its marker details, when readable. */
export function localActivityType(details: unknown): string | undefined {
  return localActivityData(details, 'activity_type', 'activityType');
}

function localActivityData(
  details: unknown,
  ...keys: string[]
): string | undefined {
  if (!isObject(details)) return undefined;
  for (const key of ['data', 'meta']) {
    const decoded = details[key];
    const value =
      isObject(decoded) && 'value' in decoded ? decoded.value : undefined;
    if (isObject(value)) {
      for (const k of keys) {
        const found = str(value[k]);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** The decoded result of a local activity from its marker details. */
export function localActivityResult(details: unknown): unknown {
  if (!isObject(details)) return undefined;
  const decoded = details.result;
  return isObject(decoded) && 'value' in decoded ? decoded.value : undefined;
}
