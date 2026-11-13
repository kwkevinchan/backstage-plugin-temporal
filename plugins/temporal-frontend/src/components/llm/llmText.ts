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

import type {
  WorkflowGraphNode,
  WorkflowLlmSummary,
  WorkflowLlmUsage,
} from '../../common';
import { formatMilliseconds } from '../format';

/** Token count in short form: `812`, `1.2k`, `15k`, `1.3M`. */
export function formatTokens(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${Math.round(n / 100) / 10}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

/** Duration of a call: `340ms`, `1.5s`, `2m 5s`. */
export function formatCallDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : formatMilliseconds(ms);
}

/** `1.2k in · 164 out` of the token counts. */
export function tokensText(usage: WorkflowLlmUsage | undefined): string {
  if (!usage) return '';
  return [
    usage.inputTokens !== undefined
      ? `${formatTokens(usage.inputTokens)} in`
      : '',
    usage.outputTokens !== undefined
      ? `${formatTokens(usage.outputTokens)} out`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** `1 tool`, `3 tools`. */
export function toolCountText(count: number): string {
  if (count === 0) return '';
  return count === 1 ? '1 tool' : `${count} tools`;
}

/** The third line of an LLM box: tokens, duration and tools. */
export function llmStatsText(summary: WorkflowLlmSummary): string {
  return [
    tokensText(summary.usage),
    formatCallDuration(summary.durationMs),
    toolCountText(summary.toolCalls.length),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The model, or why it is not known. */
export function modelText(summary: WorkflowLlmSummary): string {
  if (summary.model) return summary.model;
  switch (summary.record) {
    case 'pending':
      return 'Calling the model';
    case 'unreadable':
      return 'Record not readable here';
    case 'missing':
      return 'No LLM record';
    default:
      return 'Model call';
  }
}

/** The name of a tool step: the tool name, else the activity type. */
export function toolName(node: WorkflowGraphNode): string {
  return node.tool?.name ?? node.name;
}
