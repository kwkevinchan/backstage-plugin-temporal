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

/** The model calls of a step and the adapter that read them. */
export interface LlmModelCalls {
  framework: string;
  calls: TemporalLlmModelCall[];
}

/** The tool call of a step and the adapter that read it. */
export interface LlmToolCall {
  framework: string;
  tool: TemporalLlmToolStep;
}

/**
 * Reads the steps of one run with the adapters. A step that an adapter
 * fails on (an exception, or a value of the wrong shape) is a plain step;
 * the failure is logged once per adapter.
 */
export interface LlmStepReader {
  isModelCall(step: TemporalLlmStep): boolean;
  readModelCalls(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
  ): LlmModelCalls | undefined;
  readToolCall(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
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

  constructor(private readonly logger?: LoggerService) {}

  /** The built-in adapters only, for tests and callers without modules. */
  static builtIn(logger?: LoggerService): LlmAdapters {
    const adapters = new LlmAdapters(logger);
    for (const adapter of builtInLlmAdapters()) {
      adapters.add(adapter, { builtIn: true });
    }
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

  /** All adapters, in the order they are asked. */
  all(): TemporalLlmAdapter[] {
    return [...this.added, ...this.builtIn];
  }

  /** A reader for the steps of one run. */
  reader(): LlmStepReader {
    const adapters = this.all();
    const warned = new Set<string>();
    const guard = <T>(
      adapter: TemporalLlmAdapter,
      step: TemporalLlmStep,
      what: string,
      run: () => T,
      valid: (value: unknown) => boolean,
    ): T => {
      let value: T;
      try {
        value = run();
      } catch (error) {
        this.warn(warned, adapter, step, `${what} failed: ${error}`);
        throw new AdapterFailure();
      }
      if (!valid(value)) {
        this.warn(warned, adapter, step, `${what} returned an invalid value`);
        throw new AdapterFailure();
      }
      return value;
    };
    const isBoolean = (v: unknown) => typeof v === 'boolean';
    const claimed = (step: TemporalLlmStep) =>
      adapters.filter(a =>
        guard(a, step, 'isModelCall', () => a.isModelCall(step), isBoolean),
      );
    return {
      isModelCall(step) {
        try {
          return claimed(step).length > 0;
        } catch (error) {
          if (error instanceof AdapterFailure) return false;
          throw error;
        }
      },
      readModelCalls(step, payloads) {
        try {
          for (const adapter of claimed(step)) {
            const calls = guard(
              adapter,
              step,
              'readModelCalls',
              () => adapter.readModelCalls(step, payloads),
              isModelCallList,
            );
            if (calls.length > 0) return { framework: adapter.id, calls };
          }
          return undefined;
        } catch (error) {
          if (error instanceof AdapterFailure) return undefined;
          throw error;
        }
      },
      readToolCall(step, payloads) {
        try {
          for (const adapter of adapters) {
            if (!adapter.readToolCall) continue;
            const tool = guard(
              adapter,
              step,
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

  private warn(
    warned: Set<string>,
    adapter: TemporalLlmAdapter,
    step: TemporalLlmStep,
    message: string,
  ) {
    if (warned.has(adapter.id)) return;
    warned.add(adapter.id);
    this.logger?.warn(
      `LLM adapter ${adapter.id}: ${message} (activity type ${step.activityType}); the step is shown as a plain step`,
    );
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
