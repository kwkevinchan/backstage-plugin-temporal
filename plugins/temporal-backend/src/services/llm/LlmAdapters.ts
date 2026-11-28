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
import type { WorkflowLlmRecord } from '../../common';
import { openaiAgentsAdapter } from './openaiAgents';
import { vercelAiSdkAdapter } from './vercelAiSdk';

/** A step of a run as the adapters see it: what the history says about it. */
export interface LlmStep {
  activityType: string;
  /** Activity ID. */
  activityId?: string;
  /** The summary text of the step (Temporal's user metadata), first line. */
  summary?: string;
}

/**
 * The decoded payloads of a step. A payload that a codec encoded, or one
 * in External Storage (the backend does not read those), is left out.
 */
export interface LlmStepPayloads {
  /** The arguments, when all of them are readable. */
  input?: JsonValue[];
  /** The result of the completed step. */
  result?: JsonValue;
  /**
   * The failure details of the step's failed attempts, newest first; left
   * out once the step completed.
   */
  failureDetails?: JsonValue[];
}

/** One model call read from a step. */
export interface LlmModelCall {
  /**
   * The call in the plugin's format. Left out when the step has no
   * readable record of it yet (for example while it runs).
   */
  record?: WorkflowLlmRecord;
  /** The data the record was read from, shown as raw JSON. */
  raw?: JsonValue;
}

/** A step that ran a tool a model call asked for. */
export interface LlmToolStep {
  /** The tool name, when the step records it. */
  toolName?: string;
  /** The tool call ID from the model, when the step records it. */
  toolCallId?: string;
}

/**
 * Recognizes the model calls and tool calls of one framework in a run's
 * history and turns them into the plugin's format. Steps are matched by
 * plain names that anyone can give their activities, so an adapter checks
 * the shape of the payloads before it reads a step as its own.
 */
export interface LlmAdapter {
  /** Shown as the framework of the calls it reads, for example `vercel-ai-sdk`. */
  id: string;
  /** True when the step may be a model call of this framework. */
  isModelCall(step: LlmStep): boolean;
  /**
   * The model call of a step that `isModelCall` accepted. Undefined when
   * the payloads do not have the framework's shape (the step is then
   * offered to the next adapter, and is otherwise a plain step).
   */
  readModelCall(
    step: LlmStep,
    payloads: LlmStepPayloads,
  ): LlmModelCall | undefined;
  /** The tool a step that is not a model call ran, when it records one. */
  readToolCall?(
    step: LlmStep,
    payloads: LlmStepPayloads,
  ): LlmToolStep | undefined;
}

/** The built-in adapters, in the order they are asked. */
const ADAPTERS: LlmAdapter[] = [vercelAiSdkAdapter, openaiAgentsAdapter];

/** The model call of a step and the adapter that read it. */
export interface LlmModelRead {
  framework: string;
  call: LlmModelCall;
}

/** The first adapter that reads the step as a model call. */
export function readModelCall(
  step: LlmStep,
  payloads: LlmStepPayloads,
): LlmModelRead | undefined {
  for (const adapter of ADAPTERS) {
    if (!adapter.isModelCall(step)) continue;
    const call = adapter.readModelCall(step, payloads);
    if (call) return { framework: adapter.id, call };
  }
  return undefined;
}

/** The first adapter that reads the step as a tool call. */
export function readToolCall(
  step: LlmStep,
  payloads: LlmStepPayloads,
): LlmToolStep | undefined {
  for (const adapter of ADAPTERS) {
    const tool = adapter.readToolCall?.(step, payloads);
    if (tool) return tool;
  }
  return undefined;
}
