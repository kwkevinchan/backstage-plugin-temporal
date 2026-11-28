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
import type {
  WorkflowGraphNode,
  WorkflowLlmRecord,
  WorkflowLlmSummary,
  WorkflowLlmToolCallRef,
} from '../../common';
import { decodePayloads } from '../convert';
import { canonicalJson, isObject, Json, str } from './json';
import {
  LlmModelRead,
  LlmStep,
  LlmStepPayloads,
  readModelCall,
  readToolCall,
} from './LlmAdapters';

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
  step: LlmStep;
  /** `{ payloads }` of the input. */
  input?: Json;
  /** `{ payloads }` of the result, when the step completed with one. */
  result?: Json;
  /** Failures of failed attempts, newest first. */
  failures: Json[];
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

/** The failure details of a failure and its causes. */
function failureDetails(failure: Json) {
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
export function stepPayloads(entry: LlmStepEntry): {
  payloads: LlmStepPayloads;
  /** The decoded result, also when it is not readable. */
  decodedResult: () => unknown;
} {
  const payloads: LlmStepPayloads = {};
  let decoded: unknown;
  let decodedOnce = false;
  const decodedResult = () => {
    if (!decodedOnce && entry.result) {
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
  if (entry.result) {
    lazy(payloads, 'result', () => {
      const result = values(decodedResult());
      return result && result.length === 1 ? result[0] : result;
    });
  } else if (entry.failures.length > 0) {
    lazy(payloads, 'failureDetails', () =>
      entry.failures.flatMap(f => failureDetails(f)),
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
 * The summary of the model call of one step. `decodedResult` is the
 * decoded result payload (`{ encoding, value }`, a stored payload, or
 * undecodable), for the state of a call without a record.
 */
export function summarizeModelCall(
  node: Pick<
    WorkflowGraphNode,
    'status' | 'startTime' | 'endTime' | 'attempts'
  >,
  read: LlmModelRead,
  decodedResult: unknown,
): { summary: WorkflowLlmSummary; requests: ToolRequest[] } {
  const { call, framework } = read;
  const summary: WorkflowLlmSummary = {
    framework,
    record: 'pending',
    toolCalls: [],
    reasoning: false,
  };
  const startedTime = node.attempts?.[node.attempts.length - 1]?.startedTime;
  const activityMs = between(startedTime ?? node.startTime, node.endTime);
  if (activityMs !== undefined && node.endTime) summary.durationMs = activityMs;
  const record = call.record;
  if (!record) {
    if (isObject(decodedResult)) {
      summary.record = 'value' in decodedResult ? 'missing' : 'unreadable';
    } else if (!OPEN.includes(node.status)) {
      summary.record = 'missing';
    }
    return { summary, requests: [] };
  }
  summary.record = 'available';
  if (record.provider) summary.provider = record.provider;
  const model = record.responseModel ?? record.requestModel;
  if (model) summary.model = model;
  if (Object.keys(record.usage).length > 0) {
    summary.usage = { ...record.usage };
  }
  if (record.durationMs !== undefined) summary.durationMs = record.durationMs;
  if (record.finishReasons?.length)
    summary.finishReasons = record.finishReasons;
  // The summary keeps the error type; the message is in the full record.
  if (record.error) summary.error = record.error.type || 'error';
  summary.reasoning = hasReasoning(record);
  const requests = outputToolCalls(record);
  summary.toolCalls = requests.map(r => r.ref);
  return { summary, requests };
}

/** A tool name in a form that ignores case and separators. */
function nameKey(name: string | undefined): string {
  return (name ?? '').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
}

interface ModelStep {
  entry: LlmStepEntry;
  requests: ToolRequest[];
  answered: Set<string>;
}

interface ToolStep {
  entry: LlmStepEntry;
  /** Read for the arguments only when the step is a candidate. */
  payloads: LlmStepPayloads;
  toolName?: string;
  toolCallId?: string;
}

/** The result of reading the steps of a run. */
export interface LlmSteps {
  /** The model call of each model call step, by node ID. */
  calls: Map<string, LlmModelRead>;
}

/**
 * Reads the steps of a run with the adapters: sets `llm` on the model
 * calls and `tool` on the tool calls, and links them.
 */
export function readLlmSteps(entries: LlmStepEntry[]): LlmSteps {
  const calls = new Map<string, LlmModelRead>();
  const models: ModelStep[] = [];
  const tools: ToolStep[] = [];
  const plain: ToolStep[] = [];
  for (const entry of [...entries].sort(
    (a, b) => a.node.first - b.node.first,
  )) {
    const { payloads, decodedResult } = stepPayloads(entry);
    const read = readModelCall(entry.step, payloads);
    if (read) {
      const { summary, requests } = summarizeModelCall(
        entry.node,
        read,
        decodedResult(),
      );
      entry.node.llm = summary;
      calls.set(entry.node.id, read);
      const answered = read.call.record
        ? answeredToolCalls(read.call.record)
        : new Set<string>();
      models.push({ entry, requests, answered });
      continue;
    }
    const tool = readToolCall(entry.step, payloads);
    const step: ToolStep = { entry, payloads, ...tool };
    (tool ? tools : plain).push(step);
  }
  linkByToolCallId(models, tools);
  linkByInference(
    models,
    tools.filter(t => !t.toolCallId && !t.entry.node.tool),
    plain,
  );
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
  const toolCallId = tool.toolCallId ?? ref?.id;
  if (toolCallId !== undefined) node.tool.toolCallId = toolCallId;
  if (owner) node.tool.llmNodeId = owner.entry.node.id;
  const name = tool.toolName ?? ref?.name;
  if (name !== undefined && (owner || tool.toolName)) node.tool.name = name;
  if (inferred) node.tool.inferred = true;
  if (!ref) return;
  ref.nodeId = node.id;
  ref.status = node.status;
  if (inferred) ref.inferred = true;
}

function pushBucket<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function lastIndexBefore<T extends { entry: { node: { first: number } } }>(
  items: T[],
  beforeFirst: number,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].entry.node.first < beforeFirst) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function firstIndexAfter<T extends { entry: { node: { first: number } } }>(
  items: T[],
  afterFirst: number,
  minIndex = 0,
): number {
  let lo = minIndex;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].entry.node.first <= afterFirst) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function firstNumberAfter(
  items: number[],
  afterValue: number,
): number | undefined {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid] <= afterValue) lo = mid + 1;
    else hi = mid;
  }
  return lo < items.length ? items[lo] : undefined;
}

/** Steps that record a tool call ID: the model call that asked for it. */
function linkByToolCallId(models: ModelStep[], tools: ToolStep[]) {
  const byToolCallId = new Map<string, ModelStep[]>();
  for (const model of models) {
    const seenIds = new Set<string>();
    for (const callRef of model.entry.node.llm!.toolCalls) {
      if (callRef.id !== undefined && !seenIds.has(callRef.id)) {
        seenIds.add(callRef.id);
        pushBucket(byToolCallId, callRef.id, model);
      }
    }
  }

  for (const tool of tools) {
    const toolFirst = tool.entry.node.first;
    const id = tool.toolCallId;
    const refOf = (m: ModelStep | undefined) =>
      m?.entry.node.llm!.toolCalls.find(c => c.id === id && !c.nodeId);

    let owner: ModelStep | undefined;
    if (id !== undefined) {
      const candidates = byToolCallId.get(id);
      if (candidates) {
        for (let i = lastIndexBefore(candidates, toolFirst); i >= 0; i--) {
          if (refOf(candidates[i]) !== undefined) {
            owner = candidates[i];
            break;
          }
        }
      }
    }

    if (owner || id !== undefined) link(tool, owner, refOf(owner), false);
  }
}

function indexByNameKey(steps: ToolStep[]): Map<string, ToolStep[]> {
  const byKey = new Map<string, ToolStep[]>();
  for (const step of steps) {
    const { summary, activityType } = step.entry.step;
    const keys = new Set<string>();
    for (const raw of [step.toolName, activityType, summary]) {
      if (raw !== undefined) keys.add(nameKey(raw));
    }
    for (const key of keys) {
      pushBucket(byKey, key, step);
    }
  }
  return byKey;
}

/** Maximum unlinked tool requests in one model call processed by inference. */
export const MAX_INFERRED_TOOL_REQUESTS_PER_CALL = 500;
/** Maximum total unlinked tool requests in a run processed by inference. */
export const MAX_INFERRED_TOOL_REQUESTS = 2000;

/** Tool calls without an ID on their step: by name, arguments and order. */
function linkByInference(
  models: ModelStep[],
  toolCandidates: ToolStep[],
  plainCandidates: ToolStep[],
) {
  let totalUnlinked = 0;
  for (const model of models) {
    let callUnlinked = 0;
    for (const request of model.requests) {
      if (!request.ref.nodeId) {
        callUnlinked += 1;
        totalUnlinked += 1;
        if (totalUnlinked > MAX_INFERRED_TOOL_REQUESTS) return;
      }
    }
    if (callUnlinked > MAX_INFERRED_TOOL_REQUESTS_PER_CALL) return;
  }
  const used = new Set<ToolStep>();
  const toolsByKey = indexByNameKey(toolCandidates);
  const plainByKey = indexByNameKey(plainCandidates);
  const answeredById = new Map<string, number[]>();
  for (let i = 0; i < models.length; i++) {
    for (const id of models[i].answered) {
      pushBucket(answeredById, id, i);
    }
  }
  const canonicalInputCache = new Map<ToolStep, string | undefined>();
  const canonicalInputOf = (candidate: ToolStep): string | undefined => {
    if (canonicalInputCache.has(candidate)) {
      return canonicalInputCache.get(candidate);
    }
    const input = candidate.payloads.input;
    const value = input?.length === 1 ? canonicalJson(input[0]) : undefined;
    canonicalInputCache.set(candidate, value);
    return value;
  };

  models.forEach((model, i) => {
    const start = model.entry.node.last;
    if (start === undefined) return;
    const nextStartedIdx = firstIndexAfter(models, start, i + 1);
    const defaultNext =
      nextStartedIdx < models.length ? models[nextStartedIdx] : undefined;

    for (const request of model.requests) {
      const { ref } = request;
      if (ref.nodeId) continue;
      let next: ModelStep | undefined;
      if (ref.id !== undefined) {
        const idxList = answeredById.get(ref.id);
        const answeredIdx = idxList ? firstNumberAfter(idxList, i) : undefined;
        if (answeredIdx !== undefined) next = models[answeredIdx];
      }
      next = next ?? defaultNext;
      const end = next?.entry.node.first ?? Infinity;
      const key = nameKey(ref.name);

      const matching: ToolStep[] = [];
      for (const bucketMap of [toolsByKey, plainByKey]) {
        const bucket = bucketMap.get(key);
        if (!bucket) continue;
        for (
          let k = firstIndexAfter(bucket, start);
          k < bucket.length && bucket[k].entry.node.first < end;
          k++
        ) {
          const candidate = bucket[k];
          if (!used.has(candidate)) matching.push(candidate);
        }
      }
      if (matching.length === 0) continue;

      const args =
        request.arguments === undefined
          ? undefined
          : canonicalJson(request.arguments);
      const found =
        (args === undefined
          ? undefined
          : matching.find(c => canonicalInputOf(c) === args)) ?? matching[0];
      used.add(found);
      link(found, model, ref, true);
    }
  });
}
