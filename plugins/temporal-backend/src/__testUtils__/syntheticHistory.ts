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

const b64 = (s: string) => Buffer.from(s).toString('base64');

function encodedPayloads(...values: unknown[]) {
  return {
    payloads: values.map(value => ({
      metadata: { encoding: b64('json/plain') },
      data: b64(JSON.stringify(value)),
    })),
  };
}

class HistoryBuilder {
  readonly events: any[] = [];
  private readonly baseSec = Math.floor(
    Date.parse('2026-01-01T00:00:00Z') / 1000,
  );

  add(type: string, attributes: Record<string, unknown> = {}): string {
    const eventId = String(this.events.length + 1);
    const key = `${type.charAt(0).toLowerCase()}${type.slice(
      1,
    )}EventAttributes`;
    const snake = type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    this.events.push({
      eventId,
      eventTime: { seconds: String(this.baseSec + this.events.length) },
      eventType: `EVENT_TYPE_${snake}`,
      [key]: attributes,
    });
    return eventId;
  }

  startWorkflow(workflowType: string, taskQueue: string) {
    this.add('WorkflowExecutionStarted', {
      workflowType: { name: workflowType },
      taskQueue: { name: taskQueue },
      input: encodedPayloads({ run: workflowType }),
    });
  }

  workflowTaskTurn() {
    const scheduled = this.add('WorkflowTaskScheduled', {
      taskQueue: { name: 'default' },
    });
    this.add('WorkflowTaskStarted', { scheduledEventId: scheduled });
    this.add('WorkflowTaskCompleted', { scheduledEventId: scheduled });
  }

  scheduleActivity(activityId: string, name: string, input: unknown[]): string {
    return this.add('ActivityTaskScheduled', {
      activityId,
      activityType: { name },
      taskQueue: { name: 'default' },
      input: encodedPayloads(...input),
    });
  }

  finishActivity(scheduledEventId: string, result: unknown[]) {
    this.add('ActivityTaskStarted', { scheduledEventId, attempt: 1 });
    this.add('ActivityTaskCompleted', {
      scheduledEventId,
      result: encodedPayloads(...result),
    });
  }

  completeWorkflow(result: unknown) {
    this.workflowTaskTurn();
    this.add('WorkflowExecutionCompleted', {
      result: encodedPayloads(result),
    });
  }
}

function nestedToolArgs(round: number, index: number) {
  return {
    zetaKey: `item-${round}-${index}`,
    alphaFilter: {
      tenant: `team-${index % 4}`,
      status: ['active', 'pending'],
      bounds: { min: round, max: round + 10 },
    },
    limit: 25,
    tags: ['v1', 'cached', `r-${round % 7}`],
  };
}

/**
 * Sequential plain workflow (~5,000 events by default: `activities = 830`
 * produces 4,985 events and 830 visible activity steps with JSON payloads).
 */
export function plainSequentialHistory(activities = 830): any[] {
  const b = new HistoryBuilder();
  b.startWorkflow('batchPipelineWorkflow', 'pipelines');
  for (let i = 0; i < activities; i++) {
    b.workflowTaskTurn();
    const scheduled = b.scheduleActivity(`act-${i}`, 'processPartition', [
      {
        partition: i,
        source: 's3://bucket/prefix',
        options: { retry: true, compression: 'zstd', tags: ['a', 'b'] },
      },
    ]);
    b.finishActivity(scheduled, [
      { partition: i, rows: 1024, checksum: `sha-${i}` },
    ]);
  }
  b.completeWorkflow({ processed: activities });
  return b.events;
}

/**
 * Fan-out/fan-in plain workflow (`rounds = 150, batchSize = 10` produces
 * 4,955 events and 1,500 parallel-batched activity steps).
 */
export function plainParallelBatchHistory(rounds = 150, batchSize = 10): any[] {
  const b = new HistoryBuilder();
  b.startWorkflow('parallelFanoutWorkflow', 'pipelines');
  for (let r = 0; r < rounds; r++) {
    b.workflowTaskTurn();
    const scheduledIds: string[] = [];
    for (let k = 0; k < batchSize; k++) {
      scheduledIds.push(
        b.scheduleActivity(`act-${r}-${k}`, 'runShard', [
          { round: r, shard: k, slice: [k * 10, (k + 1) * 10] },
        ]),
      );
    }
    for (let k = 0; k < batchSize; k++) {
      b.finishActivity(scheduledIds[k], [{ round: r, shard: k, ok: true }]);
    }
  }
  b.completeWorkflow({ rounds, batchSize });
  return b.events;
}

/**
 * Vercel AI SDK agent loop with explicit `toolCallId` on MCP tool activities
 * (`rounds = 235, toolsPerRound = 4` produces 4,940 events: 235 model calls
 * and 940 linked tool steps).
 */
export function agentToolCallIdHistory(rounds = 235, toolsPerRound = 4): any[] {
  const toolNames = ['searchDocs', 'lookupOrder', 'checkPolicy'];
  const b = new HistoryBuilder();
  b.startWorkflow('vercelAgentWorkflow', 'agents');
  for (let r = 0; r < rounds; r++) {
    b.workflowTaskTurn();
    const calls = Array.from({ length: toolsPerRound }, (_, k) => ({
      id: `tc-${r}-${k}`,
      name: toolNames[(r + k) % toolNames.length],
      args: nestedToolArgs(r, k),
    }));
    const modelScheduled = b.scheduleActivity(`llm-${r}`, 'invokeModel', [
      {
        modelId: 'gpt-4o-mini',
        options: {
          temperature: 0.2,
          prompt: [
            {
              role: 'system',
              content: 'You are a helpful platform assistant.',
            },
            {
              role: 'user',
              content: [{ type: 'text', text: `Analyze batch round ${r}` }],
            },
          ],
        },
      },
    ]);
    b.finishActivity(modelScheduled, [
      {
        content: [
          { type: 'reasoning', text: `Selecting ${toolsPerRound} tools.` },
          ...calls.map(c => ({
            type: 'tool-call',
            toolCallId: c.id,
            toolName: c.name,
            input: c.args,
          })),
        ],
        finishReason: { unified: 'tool-calls' },
        usage: { inputTokens: { total: 420 }, outputTokens: { total: 85 } },
        response: { id: `resp-${r}`, modelId: 'gpt-4o-mini' },
      },
    ]);

    b.workflowTaskTurn();
    const toolScheduled = calls.map((c, k) =>
      b.scheduleActivity(`tool-${r}-${k}`, 'docs-callTool', [
        {
          name: c.name,
          input: c.args,
          options: { toolCallId: c.id },
        },
      ]),
    );
    for (let k = 0; k < calls.length; k++) {
      b.finishActivity(toolScheduled[k], [
        { matched: true, count: k + 1, summary: `ok-${r}-${k}` },
      ]);
    }
  }
  b.completeWorkflow({ status: 'done', rounds });
  return b.events;
}

/**
 * OpenAI Agents SDK loop with plain activity tool calls linked by inference
 * (no `toolCallId` on tool activities; key order differs from `arguments`).
 * `rounds = 235, toolsPerRound = 4` -> 4,940 events (235 model calls + 940 tools).
 */
export function agentInferredToolsHistory(
  rounds = 235,
  toolsPerRound = 4,
): any[] {
  const toolNames = ['searchDocs', 'lookupOrder', 'checkPolicy'];
  const b = new HistoryBuilder();
  b.startWorkflow('openaiAgentWorkflow', 'agents');
  let previousResults: any[] = [];
  for (let r = 0; r < rounds; r++) {
    b.workflowTaskTurn();
    const calls = Array.from({ length: toolsPerRound }, (_, k) => ({
      callId: `oa-${r}-${k}`,
      name: toolNames[(r + k) % toolNames.length],
      argsModel: {
        limit: 25,
        alphaFilter: {
          status: ['active', 'pending'],
          bounds: { max: r + 10, min: r },
          tenant: `team-${k % 4}`,
        },
        tags: ['v1', 'cached', `r-${r % 7}`],
        zetaKey: `item-${r}-${k}`,
      },
      argsTool: nestedToolArgs(r, k),
    }));
    const modelScheduled = b.scheduleActivity(
      `llm-${r}`,
      'invokeModelActivity',
      [
        {
          modelName: 'gpt-4o',
          request: {
            systemInstructions: 'You are a helpful platform assistant.',
            input: [
              { type: 'message', role: 'user', content: `Round ${r}` },
              ...previousResults,
            ],
            modelSettings: { temperature: 0.1 },
          },
        },
      ],
    );
    b.finishActivity(modelScheduled, [
      {
        usage: { inputTokens: 480, outputTokens: 95 },
        responseId: `resp-${r}`,
        output: calls.map(c => ({
          type: 'function_call',
          callId: c.callId,
          name: c.name,
          arguments: JSON.stringify(c.argsModel),
        })),
      },
    ]);

    b.workflowTaskTurn();
    const toolScheduled = calls.map((c, k) =>
      b.scheduleActivity(`tool-${r}-${k}`, c.name, [c.argsTool]),
    );
    for (let k = 0; k < calls.length; k++) {
      b.finishActivity(toolScheduled[k], [{ found: k + 1, round: r }]);
    }
    previousResults = calls.map((c, k) => ({
      type: 'function_call_result',
      callId: c.callId,
      name: c.name,
      output: JSON.stringify({ found: k + 1, round: r }),
    }));
  }
  b.completeWorkflow({ status: 'done', rounds });
  return b.events;
}

/**
 * Dense inferred OpenAI Agents workflow (`rounds = 138, toolsPerRound = 9`
 * -> 4,973 events, 138 model calls and 1,242 inferred tool calls reusing 2
 * tool names).
 */
export function agentDenseInferredHistory(
  rounds = 138,
  toolsPerRound = 9,
): any[] {
  const b = new HistoryBuilder();
  b.startWorkflow('openaiDenseAgentWorkflow', 'agents');
  let previousResults: any[] = [];
  for (let r = 0; r < rounds; r++) {
    b.workflowTaskTurn();
    const calls = Array.from({ length: toolsPerRound }, (_, k) => {
      const name = k % 2 === 0 ? 'searchDocs' : 'lookupOrder';
      return {
        callId: `dense-${r}-${k}`,
        name,
        argsModel: {
          limit: 25,
          alphaFilter: {
            status: ['active', 'pending'],
            bounds: { max: r + 10, min: r },
            tenant: `team-${k % 4}`,
          },
          tags: ['v1', 'cached', `r-${r % 7}`],
          zetaKey: `item-${r}-${k}`,
        },
        argsTool: nestedToolArgs(r, k),
      };
    });
    const modelScheduled = b.scheduleActivity(
      `llm-${r}`,
      'invokeModelActivity',
      [
        {
          modelName: 'gpt-4o',
          request: {
            systemInstructions: 'Dense agent helper.',
            input: [
              { type: 'message', role: 'user', content: `Round ${r}` },
              ...previousResults,
            ],
          },
        },
      ],
    );
    b.finishActivity(modelScheduled, [
      {
        usage: { inputTokens: 600, outputTokens: 140 },
        responseId: `resp-${r}`,
        output: calls.map(c => ({
          type: 'function_call',
          callId: c.callId,
          name: c.name,
          arguments: JSON.stringify(c.argsModel),
        })),
      },
    ]);

    b.workflowTaskTurn();
    const toolScheduled = calls.map((c, k) =>
      b.scheduleActivity(`tool-${r}-${k}`, c.name, [c.argsTool]),
    );
    for (let k = 0; k < calls.length; k++) {
      b.finishActivity(toolScheduled[k], [{ found: k + 1, round: r }]);
    }
    previousResults = calls.map((c, k) => ({
      type: 'function_call_result',
      callId: c.callId,
      name: c.name,
      output: JSON.stringify({ found: k + 1, round: r }),
    }));
  }
  b.completeWorkflow({ status: 'done', rounds });
  return b.events;
}

/**
 * Local-activity heavy workflow (`count = 4400` produces 4,933 events and
 * 4,402 visible nodes, exercising graph edge construction near the 5,000-event
 * read limit).
 */
export function localActivitiesHistory(count = 4400): any[] {
  const b = new HistoryBuilder();
  b.startWorkflow('localActivityWorkflow', 'default');
  for (let i = 0; i < count; i++) {
    if (i % 25 === 0) {
      b.workflowTaskTurn();
    }
    b.add('MarkerRecorded', {
      markerName: 'core_local_activity',
      details: {
        data: encodedPayloads({
          activityId: `la-${i}`,
          activityType: 'checkRule',
          attempt: 1,
        }),
        result: encodedPayloads({ ok: true, i }),
      },
    });
  }
  b.completeWorkflow({ count });
  return b.events;
}

/** Shape of generated payloads for {@link LargePayloadHistoryOptions}. */
export type SyntheticPayloadShape = 'structured' | 'string';

/** Options for large-payload synthetic history generators. */
export interface LargePayloadHistoryOptions {
  /** Number of sequential activity steps to emit. */
  activities?: number;
  /** Approximate UTF-8 JSON size of each large payload, in bytes. */
  payloadBytes?: number;
  /** Payload JSON shape: realistic nested objects/arrays or a single string. */
  shape?: SyntheticPayloadShape;
}

function largePayloadValue(
  targetBytes: number,
  seed: number,
  shape: SyntheticPayloadShape = 'structured',
): Record<string, unknown> {
  if (shape === 'string') {
    const overhead = Buffer.byteLength(
      JSON.stringify({ seed, blob: '' }),
      'utf8',
    );
    return {
      seed,
      blob: 'a'.repeat(Math.max(0, targetBytes - overhead)),
    };
  }
  const items: Array<Record<string, unknown>> = [];
  let bytes = Buffer.byteLength(
    JSON.stringify({ seed, count: 999999, items: [] }),
    'utf8',
  );
  let i = 0;
  while (bytes < targetBytes) {
    const rec = {
      id: `rec-${seed}-${i}`,
      status: i % 2 === 0 ? 'ok' : 'pending',
      score: (i * 17) % 100,
      tags: ['alpha', 'beta', `g${i % 9}`],
      summary: `Record payload item number ${i} for batch ${seed}`,
    };
    const itemBytes = Buffer.byteLength(JSON.stringify(rec), 'utf8') + 1;
    if (items.length > 0 && bytes + itemBytes > targetBytes) {
      break;
    }
    items.push(rec);
    bytes += itemBytes;
    i += 1;
  }
  return { seed, count: items.length, items };
}

/**
 * Few-step workflow near Temporal's payload/history limits: by default 24
 * sequential activities (149 events) each returning ~2 MB (~48 MB total).
 */
export function largePayloadFewStepsHistory(
  options: LargePayloadHistoryOptions = {},
): any[] {
  const activities = options.activities ?? 24;
  const payloadBytes = options.payloadBytes ?? 2_000_000;
  const shape = options.shape ?? 'structured';
  const b = new HistoryBuilder();
  b.startWorkflow('largePayloadFewStepsWorkflow', 'pipelines');
  for (let i = 0; i < activities; i++) {
    b.workflowTaskTurn();
    const scheduled = b.scheduleActivity(`act-${i}`, 'processLargeChunk', [
      { chunk: i },
    ]);
    b.finishActivity(scheduled, [largePayloadValue(payloadBytes, i, shape)]);
  }
  b.completeWorkflow({ activities });
  return b.events;
}

/**
 * Large-history workflow with medium payloads: by default 830 sequential
 * activities (4,985 events) where each input and result is ~10 KiB.
 */
export function largePayloadManyEventsHistory(
  options: LargePayloadHistoryOptions = {},
): any[] {
  const activities = options.activities ?? 830;
  const payloadBytes = options.payloadBytes ?? 10_240;
  const shape = options.shape ?? 'structured';
  const b = new HistoryBuilder();
  b.startWorkflow('largePayloadManyEventsWorkflow', 'pipelines');
  for (let i = 0; i < activities; i++) {
    b.workflowTaskTurn();
    const scheduled = b.scheduleActivity(`act-${i}`, 'processMediumChunk', [
      largePayloadValue(payloadBytes, i * 2, shape),
    ]);
    b.finishActivity(scheduled, [
      largePayloadValue(payloadBytes, i * 2 + 1, shape),
    ]);
  }
  b.completeWorkflow({ activities });
  return b.events;
}
