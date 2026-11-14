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

import { createBackendModule } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import { memoryS3, storeExternally } from './__testUtils__/externalStorage';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import {
  TemporalLlmAdapter,
  temporalLlmAdapterExtensionPoint,
} from './node/alpha';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

/** Objects of the mocked S3 service, by key, and the keys read. */
const mockObjects = new Map<string, Buffer>();
const mockReads: string[] = [];

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: async (command: any) => {
        mockReads.push(command.input.Key);
        const data = mockObjects.get(command.input.Key);
        if (!data) throw new Error('NoSuchKey');
        const body = data;
        const stream = Readable.from([body]) as any;
        stream.transformToByteArray = async () => new Uint8Array(body);
        return { Body: stream, ContentLength: body.length };
      },
    })),
  };
});

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const ref = 'component:default/orders';
const plain = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});

/** A record larger than the backend shows inline (maxInlineBytes 1000). */
const bigRecord = {
  'temporal.llm': {
    v: 1,
    attributes: {
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-big',
      'gen_ai.usage.input_tokens': 5000,
      'gen_ai.usage.output_tokens': 900,
      'gen_ai.input.messages': [
        { role: 'user', parts: [{ type: 'text', content: 'x'.repeat(4000) }] },
      ],
      'gen_ai.output.messages': [
        {
          role: 'assistant',
          parts: [
            { type: 'reasoning', content: 'thinking hard' },
            { type: 'text', content: 'the answer' },
          ],
        },
      ],
    },
  },
};
const smallRecord = {
  'temporal.llm': {
    v: 1,
    attributes: {
      'gen_ai.request.model': 'gpt-small',
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.output.messages': [
        { role: 'assistant', parts: [{ type: 'text', content: 'hi' }] },
      ],
    },
  },
};

/** The two records stored with the official S3 driver, and their objects. */
const stored: Record<
  'big' | 'small',
  { payload: unknown; key: string; object: Buffer }
> = {} as any;

beforeAll(async () => {
  const s3 = memoryS3();
  for (const [name, value] of [
    ['big', bigRecord],
    ['small', smallRecord],
  ] as const) {
    const { payload, key } = await storeExternally(s3, value, {
      workflowId: name,
    });
    const object = Buffer.from(s3.objects.get(`payloads/${key}`)!);
    stored[name] = { payload, key, object };
  }
});

function events() {
  return [
    { eventId: '1', workflowExecutionStartedEventAttributes: {} },
    {
      eventId: '2',
      activityTaskScheduledEventAttributes: {
        activityId: 'llm/big',
        activityType: { name: 'callModel' },
      },
    },
    {
      eventId: '3',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '2',
        result: { payloads: [structuredClone(stored.big.payload)] },
      },
    },
    {
      eventId: '4',
      activityTaskScheduledEventAttributes: {
        activityId: 'llm/small',
        activityType: { name: 'callModel' },
      },
    },
    {
      eventId: '5',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '4',
        result: { payloads: [structuredClone(stored.small.payload)] },
      },
    },
    {
      eventId: '6',
      activityTaskScheduledEventAttributes: {
        activityId: 'plain-1',
        activityType: { name: 'plain' },
      },
    },
    {
      eventId: '7',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '6',
        result: { payloads: [plain(1)] },
      },
    },
    {
      eventId: '8',
      activityTaskScheduledEventAttributes: {
        activityId: 'llm/sealed',
        activityType: { name: 'callModel' },
      },
    },
    {
      eventId: '9',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '8',
        result: {
          payloads: [
            {
              metadata: { encoding: b64('binary/encrypted') },
              data: b64('xx'),
            },
          ],
        },
      },
    },
  ];
}

/** A module of the temporal plugin that adds LLM adapters. */
function adapterModule(...adapters: TemporalLlmAdapter[]) {
  return createBackendModule({
    pluginId: 'temporal',
    moduleId: 'test-llm-adapters',
    register(env) {
      env.registerInit({
        deps: { llm: temporalLlmAdapterExtensionPoint },
        async init({ llm }) {
          for (const adapter of adapters) llm.addLlmAdapter(adapter);
        },
      });
    },
  });
}

/** A record of the plugin's shape. */
const record = (model: string, inputTokens: number) => ({
  requestModel: model,
  usage: { inputTokens },
  systemInstructions: [],
  inputMessages: [
    { role: 'user', parts: [{ type: 'text', content: `ask ${model}` }] },
  ],
  outputMessages: [],
  toolExecutions: [],
});

/** Runs a whole agent in one step (`runAgent`): two model calls. */
const wholeAgent: TemporalLlmAdapter = {
  id: 'whole-agent',
  isModelCall: step => step.activityType === 'runAgent',
  readModelCalls: (_step, payloads) =>
    payloads.result === undefined
      ? []
      : [
          { name: 'plan', record: record('model-a', 10) },
          { name: 'answer', record: record('model-b', 20) },
        ],
};

const agentEvents = () => [
  { eventId: '1', workflowExecutionStartedEventAttributes: {} },
  {
    eventId: '2',
    activityTaskScheduledEventAttributes: {
      activityId: '1',
      activityType: { name: 'runAgent' },
    },
  },
  {
    eventId: '3',
    activityTaskCompletedEventAttributes: {
      scheduledEventId: '2',
      result: { payloads: [plain({ done: true })] },
    },
  },
];

async function start(options: {
  history: boolean;
  s3?: boolean;
  ai?: boolean;
  events?: () => unknown[];
  features?: any[];
}) {
  const workflowService = createFakeWorkflowService();
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) =>
      ({
        workflowExecutionInfo: executionInfo({
          workflowId: req.execution.workflowId,
        }),
        pendingActivities: [],
      } as any),
  );
  workflowService.getWorkflowExecutionHistory.mockImplementation(
    async () =>
      ({
        history: { events: (options.events ?? events)() },
        nextPageToken: new Uint8Array(),
      } as any),
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result:
          !options.history &&
          r.permission.name.startsWith('temporal.workflow.history')
            ? AuthorizeResult.DENY
            : AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const experimental = { aiWorkflows: options.ai !== false };
  const config =
    options.s3 === false
      ? { temporal: { experimental } }
      : {
          temporal: {
            experimental,
            externalStorage: {
              s3: {
                bucket: 'payloads',
                integrationHost: 'localhost:9100',
                maxInlineBytes: 1000,
              },
            },
          },
          integrations: {
            awsS3: [
              {
                endpoint: 'http://localhost:9100',
                s3ForcePathStyle: true,
                accessKeyId: 'a',
                secretAccessKey: 's',
              },
            ],
          },
        };
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      mockServices.rootConfig.factory({ data: config }),
      ...(options.features ?? []),
    ],
  });
  return { server: await withOpenApiValidation(server) };
}

const path = (rest: string) =>
  `/api/temporal/namespaces/default/workflows/wf-1${rest}?entityRef=${ref}`;

/** The events of a history of `test-fixtures/llm-integrations`. */
function integrationEvents(name: string): any[] {
  return JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        `../../../test-fixtures/llm-integrations/${name}.json`,
      ),
      'utf8',
    ),
  ).events;
}

const decoded = (payload: any) =>
  JSON.parse(Buffer.from(payload.data, 'base64').toString());

describe('LLM routes', () => {
  beforeEach(() => {
    mockReads.length = 0;
    mockObjects.clear();
    for (const { key, object } of Object.values(stored)) {
      mockObjects.set(key, object);
    }
  });

  it('shows model calls without the experimental switch', async () => {
    const { server } = await start({ history: true, ai: false });
    const graph = await request(server).get(path('/graph'));
    expect(graph.status).toBe(200);
    const small = graph.body.nodes.find(
      (n: { stepId?: string }) => n.stepId === 'llm/small',
    );
    expect(small.llm).toMatchObject({
      framework: 'temporal-workflow-kit',
      model: 'gpt-small',
    });
    const steps = await request(server).get(path('/steps'));
    expect(steps.status).toBe(200);
    expect(
      steps.body.activities.find(
        (a: { activityId: string }) => a.activityId === 'llm/small',
      ).llm,
    ).toMatchObject({ model: 'gpt-small' });
    const res = await request(server).get(path('/llm-calls/4'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      framework: 'temporal-workflow-kit',
      call: 'small',
      record: { requestModel: 'gpt-small' },
    });
  });

  it('reads the model calls of a module adapter, several in one step', async () => {
    const reader = await start({
      history: false,
      events: agentEvents,
      features: [adapterModule(wholeAgent)],
    });
    const graph = await request(reader.server).get(path('/graph'));
    expect(graph.status).toBe(200);
    const node = graph.body.nodes.find((n: any) => n.id === 'activity-2');
    // Names and numbers only without the history permission.
    expect(node.llm).toEqual({
      call: 'plan',
      framework: 'whole-agent',
      callCount: 2,
      record: 'available',
      model: 'model-b',
      usage: { inputTokens: 30 },
      toolCalls: [],
      reasoning: false,
    });
    expect(node.result).toBeUndefined();
    expect(
      (await request(reader.server).get(path('/llm-calls/2'))).status,
    ).toBe(403);

    const { server } = await start({
      history: true,
      events: agentEvents,
      features: [adapterModule(wholeAgent)],
    });
    const first = await request(server).get(path('/llm-calls/2'));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      nodeId: 'activity-2',
      activityType: 'runAgent',
      framework: 'whole-agent',
      call: 'plan',
      index: 0,
      callCount: 2,
      record: { requestModel: 'model-a', usage: { inputTokens: 10 } },
    });
    const second = await request(server).get(`${path('/llm-calls/2')}&index=1`);
    expect(second.body).toMatchObject({
      call: 'answer',
      index: 1,
      record: { requestModel: 'model-b' },
    });
    expect(
      (await request(server).get(`${path('/llm-calls/2')}&index=2`)).status,
    ).toBe(404);
    expect(
      (await request(server).get(`${path('/llm-calls/2')}&index=x`)).status,
    ).toBe(400);
  });

  it('fails to start when a module takes the ID of an adapter', async () => {
    await expect(
      start({
        history: true,
        features: [adapterModule({ ...wholeAgent, id: 'vercel-ai-sdk' })],
      }),
    ).rejects.toThrow('Duplicate LLM adapter id: vercel-ai-sdk');
  });

  it('restores a record stored in S3 that is larger than the inline limit', async () => {
    const { server } = await start({ history: true });
    const res = await request(server).get(path('/llm-calls/2'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nodeId: 'activity-2',
      activityId: 'llm/big',
      activityType: 'callModel',
      call: 'big',
      status: 'Completed',
      external: { key: stored.big.key, state: 'inline' },
      record: {
        provider: 'openai',
        requestModel: 'gpt-big',
        usage: { inputTokens: 5000, outputTokens: 900 },
      },
    });
    expect(res.body.record.inputMessages[0].parts[0].content).toHaveLength(
      4000,
    );
    expect(res.body.record.outputMessages[0].parts[0]).toEqual({
      type: 'reasoning',
      content: 'thinking hard',
    });
    expect(res.body.raw).toEqual(bigRecord['temporal.llm']);
  });

  it('explains records it cannot read', async () => {
    const { server } = await start({ history: true });
    const sealed = await request(server).get(path('/llm-calls/8'));
    expect(sealed.body.unavailable).toMatch(/codec/);
    expect(sealed.body.record).toBeUndefined();
    expect((await request(server).get(path('/llm-calls/6'))).status).toBe(404);
    expect((await request(server).get(path('/llm-calls/99'))).status).toBe(404);
    expect((await request(server).get(path('/llm-calls/x2'))).status).toBe(400);
  });

  it('says when S3 is not configured', async () => {
    const { server } = await start({ history: true, s3: false });
    const res = await request(server).get(path('/llm-calls/2'));
    expect(res.body.unavailable).toMatch(/no S3 configuration/);
    expect(res.body.external.state).toBe('unconfigured');
  });

  it('needs the history permission for the record', async () => {
    const { server } = await start({ history: false });
    expect((await request(server).get(path('/llm-calls/2'))).status).toBe(403);
  });

  it('shows summaries without the history permission, reading small records from S3', async () => {
    const { server } = await start({ history: false });
    const res = await request(server).get(path('/graph'));
    expect(res.status).toBe(200);
    expect(res.body.payloadsHidden).toBe(true);
    const byId = (id: string) => res.body.nodes.find((n: any) => n.id === id);
    expect(byId('activity-4').llm).toMatchObject({
      record: 'available',
      model: 'gpt-small',
      usage: { inputTokens: 10 },
    });
    expect(byId('activity-4').result).toBeUndefined();
    // Larger than the inline limit: the summary needs the record route.
    expect(byId('activity-2').llm.record).toBe('unreadable');
    expect(byId('activity-8').llm.record).toBe('unreadable');
    expect(byId('activity-6').llm).toBeUndefined();
  });

  it('adds summaries to the steps', async () => {
    const { server } = await start({ history: true });
    const res = await request(server).get(path('/steps'));
    expect(res.status).toBe(200);
    const small = res.body.activities.find(
      (a: any) => a.activityId === 'llm/small',
    );
    expect(small.llm).toMatchObject({
      record: 'available',
      model: 'gpt-small',
    });
  });

  it('shows names and numbers of official model calls to readers without the history permission', async () => {
    for (const [name, check] of [
      ['vercel-ai-sdk-agent', 'activity-11'],
      ['openai-agents-agent', 'activity-5'],
    ]) {
      const { server } = await start({
        history: false,
        events: () => integrationEvents(name),
      });
      const res = await request(server).get(path('/graph'));
      expect(res.status).toBe(200);
      const node = res.body.nodes.find((n: any) => n.id === check);
      expect(node.llm).toMatchObject({ record: 'available' });
      expect(node.llm.usage.inputTokens).toBeGreaterThan(0);
      expect(node.llm.toolCalls[0].name).toBeTruthy();
      // No prompt, system instructions, tool arguments or tool results.
      const body = JSON.stringify(res.body);
      for (const text of [
        'Event Groups 是什麼',
        '你是平台工程助理',
        'event groups round 1',
        'docs/event-groups-round-1.md',
        'Event Groups 是實驗性功能',
        '查到了',
      ]) {
        expect(body).not.toContain(text);
      }
    }
  });

  it('does not read the input of a model call from S3 for the graph', async () => {
    const s3 = memoryS3();
    const history = integrationEvents('openai-agents-agent');
    const scheduled = history.find(
      (e: any) => e.eventId === '17',
    ).activityTaskScheduledEventAttributes;
    const { payload, key } = await storeExternally(
      s3,
      decoded(scheduled.input.payloads[0]),
      { workflowId: 'openai-input' },
    );
    scheduled.input = { payloads: [payload] };
    const store = () => {
      mockObjects.set(key, Buffer.from(s3.objects.get(`payloads/${key}`)!));
    };

    const reader = await start({
      history: false,
      events: () => structuredClone(history),
    });
    store();
    const graph = await request(reader.server).get(path('/graph'));
    expect(graph.status).toBe(200);
    const node = (id: string) => graph.body.nodes.find((n: any) => n.id === id);
    // The model name is only in the input: not on the graph.
    expect(node('activity-17').llm).toMatchObject({
      framework: 'openai-agents',
      record: 'available',
      usage: { inputTokens: 261, outputTokens: 40 },
    });
    expect(node('activity-17').llm.model).toBeUndefined();
    expect(node('activity-5').llm.model).toBe('fake-model');
    // The tool is still linked: up to the next model call.
    expect(node('activity-11').tool).toMatchObject({
      llmNodeId: 'activity-5',
      inferred: true,
    });
    expect(mockReads).not.toContain(key);

    // The record route reads it.
    const { server } = await start({
      history: true,
      events: () => structuredClone(history),
    });
    store();
    const res = await request(server).get(path('/llm-calls/17'));
    expect(res.status).toBe(200);
    expect(res.body.record.requestModel).toBe('fake-model');
    expect(res.body.record.inputMessages).toHaveLength(3);
    expect(mockReads).toContain(key);
  });
});
