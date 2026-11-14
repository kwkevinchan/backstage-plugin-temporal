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

import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  TemporalLlmAdapter,
  TemporalLlmModelCall,
  TemporalLlmStep,
  TemporalLlmStepPayloads,
  TemporalLlmToolStep,
} from '../../node/alpha';
import { isObject } from './json';
import { openaiAgentsAdapter } from './openaiAgents';
import { vercelAiSdkAdapter } from './vercelAiSdk';
import { workflowKitAdapter } from './workflowKit';

/** The built-in adapters, in the order they are asked. */
export function builtInLlmAdapters(): TemporalLlmAdapter[] {
  return [vercelAiSdkAdapter, openaiAgentsAdapter, workflowKitAdapter];
}

/** Most model calls one step may report; more make the step a plain step. */
export const MAX_MODEL_CALLS_PER_STEP = 100;

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
const optionalCount = (v: unknown) =>
  v === undefined || (typeof v === 'number' && Number.isFinite(v));

function isPartList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(p => isObject(p) && typeof p.type === 'string')
  );
}

function isMessageList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      m =>
        isObject(m) &&
        typeof m.role === 'string' &&
        optionalString(m.name) &&
        isPartList(m.parts),
    )
  );
}

/** True when an adapter returned a record of the plugin's shape. */
function isRecord(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.usage)) return false;
  const usage = value.usage;
  return (
    [
      'inputTokens',
      'outputTokens',
      'reasoningTokens',
      'cacheReadInputTokens',
      'cacheWriteInputTokens',
    ].every(k => optionalCount(usage[k])) &&
    [
      'operation',
      'provider',
      'requestModel',
      'responseModel',
      'responseId',
      'conversationId',
      'startTime',
    ].every(k => optionalString(value[k])) &&
    optionalCount(value.durationMs) &&
    isPartList(value.systemInstructions) &&
    isMessageList(value.inputMessages) &&
    isMessageList(value.outputMessages) &&
    Array.isArray(value.toolExecutions) &&
    value.toolExecutions.every(
      (t: unknown) => isObject(t) && typeof t.name === 'string',
    ) &&
    (value.finishReasons === undefined ||
      (Array.isArray(value.finishReasons) &&
        value.finishReasons.every((r: unknown) => typeof r === 'string'))) &&
    (value.toolDefinitions === undefined ||
      Array.isArray(value.toolDefinitions)) &&
    (value.parameters === undefined || isObject(value.parameters)) &&
    (value.error === undefined ||
      (isObject(value.error) && typeof value.error.message === 'string'))
  );
}

function isModelCallList(value: unknown): value is TemporalLlmModelCall[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_MODEL_CALLS_PER_STEP &&
    value.every(
      c =>
        isObject(c) &&
        optionalString(c.name) &&
        (c.record === undefined || isRecord(c.record)),
    )
  );
}

function isToolStep(value: unknown): value is TemporalLlmToolStep | undefined {
  return (
    value === undefined ||
    (isObject(value) &&
      optionalString(value.toolName) &&
      optionalString(value.toolCallId) &&
      optionalString(value.modelCall))
  );
}

/** Deepest nesting of a value an adapter returns. */
const MAX_JSON_DEPTH = 64;

class NotJson extends Error {}

/**
 * A copy of a value as plain JSON: objects and arrays of strings, finite
 * numbers, booleans and null. Throws `NotJson` for anything else (cycles,
 * functions, class instances, `NaN`, `BigInt`, ...). Getters are read once;
 * object fields that are undefined are left out, as `JSON.stringify` does.
 */
function jsonCopy(value: unknown, path: object[] = []): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NotJson();
    return value;
  }
  if (typeof value !== 'object' || path.length >= MAX_JSON_DEPTH)
    throw new NotJson();
  if (path.includes(value)) throw new NotJson();
  const inner = [...path, value];
  if (Array.isArray(value)) {
    return value.map(v => {
      if (v === undefined) throw new NotJson();
      return jsonCopy(v, inner);
    });
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new NotJson();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = jsonCopy(v, inner);
  }
  return out;
}

/** The model calls of a step and the adapter that read them. */
export interface LlmModelCalls {
  framework: string;
  calls: TemporalLlmModelCall[];
  /**
   * False when tool calls of these calls must not be linked by inference
   * (the workflow kit's format marks every tool step).
   */
  inferToolCalls: boolean;
}

/** The tool call of a step and the adapter that read it. */
export interface LlmToolCall {
  framework: string;
  tool: TemporalLlmToolStep;
}

/**
 * Reads the steps of one run with the adapters. A step that an adapter
 * fails on (an exception, or a value of the wrong shape) is a plain step;
 * the failure is logged once per adapter and reader, with the event ID of
 * the step and the name of the error, never its message.
 */
export interface LlmStepReader {
  isModelCall(step: TemporalLlmStep, eventId?: string): boolean;
  readModelCalls(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
    eventId?: string,
  ): LlmModelCalls | undefined;
  readToolCall(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
    eventId?: string,
  ): LlmToolCall | undefined;
}

/** Thrown inside the reader when an adapter fails on a step. */
class AdapterFailure extends Error {}

/**
 * The LLM adapters of the backend: the ones modules add with
 * `temporalLlmAdapterExtensionPoint`, asked first, then the built-in ones.
 * IDs are unique.
 */
export class LlmAdapters {
  private readonly added: TemporalLlmAdapter[] = [];
  private readonly builtIn: TemporalLlmAdapter[] = [];
  /** Adapters whose tool calls are not linked by inference. */
  private readonly noInference = new Set<string>();

  constructor(private readonly logger?: LoggerService) {}

  /** The built-in adapters only, for tests and callers without modules. */
  static builtIn(logger?: LoggerService): LlmAdapters {
    const adapters = new LlmAdapters(logger);
    adapters.addBuiltIns();
    return adapters;
  }

  /** Adds an adapter. Throws when its ID is taken or it is not an adapter. */
  add(adapter: TemporalLlmAdapter, options: { builtIn?: boolean } = {}) {
    if (
      !adapter ||
      typeof adapter.id !== 'string' ||
      adapter.id === '' ||
      typeof adapter.isModelCall !== 'function' ||
      typeof adapter.readModelCalls !== 'function'
    ) {
      throw new Error(
        'An LLM adapter needs an id, isModelCall and readModelCalls',
      );
    }
    if (this.all().some(a => a.id === adapter.id)) {
      throw new Error(`Duplicate LLM adapter id: ${adapter.id}`);
    }
    (options.builtIn ? this.builtIn : this.added).push(adapter);
  }

  /**
   * Adds the built-in adapters, after the ones added so far. The workflow
   * kit's tool steps all carry markers, so its calls get no inferred links.
   */
  addBuiltIns() {
    for (const adapter of builtInLlmAdapters()) {
      this.add(adapter, { builtIn: true });
    }
    this.noInference.add(workflowKitAdapter.id);
  }

  /** All adapters, in the order they are asked. */
  all(): TemporalLlmAdapter[] {
    return [...this.added, ...this.builtIn];
  }

  /**
   * A reader for the steps of one run. `silent` logs nothing, for a pass
   * whose steps are read again by another reader.
   */
  reader(options: { silent?: boolean } = {}): LlmStepReader {
    const adapters = this.all();
    const noInference = this.noInference;
    const warned = new Set<string>();
    const warn = (
      adapter: TemporalLlmAdapter,
      step: TemporalLlmStep,
      eventId: string | undefined,
      message: string,
    ) => {
      if (options.silent || warned.has(adapter.id)) return;
      warned.add(adapter.id);
      this.logger?.warn(
        `LLM adapter ${adapter.id}: ${message} (activity type ${
          step.activityType
        }${eventId ? `, event ${eventId}` : ''})`,
      );
    };
    const guard = <T>(
      adapter: TemporalLlmAdapter,
      step: TemporalLlmStep,
      eventId: string | undefined,
      what: string,
      run: () => T,
      valid: (value: unknown) => boolean,
    ): T => {
      let value: unknown;
      try {
        value = run();
      } catch (error) {
        // The name only: the message may hold payload content.
        const name = error instanceof Error ? error.name : typeof error;
        warn(
          adapter,
          step,
          eventId,
          `${what} threw ${name}; the step is shown as a plain step`,
        );
        throw new AdapterFailure();
      }
      try {
        value = value === undefined ? undefined : jsonCopy(value);
      } catch {
        warn(
          adapter,
          step,
          eventId,
          `${what} returned a value that is not plain JSON; the step is shown as a plain step`,
        );
        throw new AdapterFailure();
      }
      if (!valid(value)) {
        warn(
          adapter,
          step,
          eventId,
          `${what} returned a value of the wrong shape; the step is shown as a plain step`,
        );
        throw new AdapterFailure();
      }
      return value as T;
    };
    const isBoolean = (v: unknown) => typeof v === 'boolean';
    const claimed = (step: TemporalLlmStep, eventId?: string) =>
      adapters.filter(a =>
        guard(
          a,
          step,
          eventId,
          'isModelCall',
          () => a.isModelCall(step),
          isBoolean,
        ),
      );
    return {
      isModelCall(step, eventId) {
        if (step.kind !== 'activity') return false;
        try {
          return claimed(step, eventId).length > 0;
        } catch (error) {
          if (error instanceof AdapterFailure) return false;
          throw error;
        }
      },
      readModelCalls(step, payloads, eventId) {
        try {
          const claiming = claimed(step, eventId);
          if (step.kind !== 'activity') {
            // Model calls are read from activities only.
            for (const adapter of claiming) {
              warn(
                adapter,
                step,
                eventId,
                'isModelCall is true for a local activity, which is never read as a model call (only readToolCall is asked)',
              );
            }
            return undefined;
          }
          for (const adapter of claiming) {
            const calls = guard(
              adapter,
              step,
              eventId,
              'readModelCalls',
              () => adapter.readModelCalls(step, payloads),
              isModelCallList,
            );
            if (calls.length > 0) {
              return {
                framework: adapter.id,
                calls,
                inferToolCalls: !noInference.has(adapter.id),
              };
            }
          }
          return undefined;
        } catch (error) {
          if (error instanceof AdapterFailure) return undefined;
          throw error;
        }
      },
      readToolCall(step, payloads, eventId) {
        try {
          for (const adapter of adapters) {
            if (!adapter.readToolCall) continue;
            const tool = guard(
              adapter,
              step,
              eventId,
              'readToolCall',
              () => adapter.readToolCall!(step, payloads),
              isToolStep,
            );
            if (tool) return { framework: adapter.id, tool };
          }
          return undefined;
        } catch (error) {
          if (error instanceof AdapterFailure) return undefined;
          throw error;
        }
      },
    };
  }
}

let builtInOnly: LlmAdapters | undefined;

/**
 * The built-in adapters without a logger, for graphs built without the
 * plugin's adapters (tests and helpers).
 */
export function builtInOnlyLlmAdapters(): LlmAdapters {
  builtInOnly ??= LlmAdapters.builtIn();
  return builtInOnly;
}
