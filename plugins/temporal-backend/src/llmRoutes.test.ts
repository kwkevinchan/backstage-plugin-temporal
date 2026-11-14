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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { Readable } from 'node:stream';
import request from 'supertest';
import { memoryS3, storeExternally } from './__testUtils__/externalStorage';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

/** Objects of the mocked S3 service, by key. */
const mockObjects = new Map<string, Buffer>();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: async (command: any) => {
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

async function start(options: {
  history: boolean;
  s3?: boolean;
  ai?: boolean;
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
        history: { events: events() },
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
                endpoint: 'http://localhost:9100',
                forcePathStyle: true,
                maxInlineBytes: 1000,
                credentials: { accessKeyId: 'a', secretAccessKey: 's' },
              },
            },
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
    ],
  });
  return { server: await withOpenApiValidation(server) };
}

const path = (rest: string) =>
  `/api/temporal/namespaces/default/workflows/wf-1${rest}?entityRef=${ref}`;

describe('LLM routes', () => {
  beforeEach(() => {
    mockObjects.clear();
    for (const { key, object } of Object.values(stored)) {
      mockObjects.set(key, object);
    }
  });

  it('serves no model call records unless the AI views are enabled', async () => {
    const { server } = await start({ history: true, ai: false });
    const graph = await request(server).get(path('/graph'));
    expect(graph.status).toBe(200);
    // The model and tool calls are still there, as plain activities.
    expect(
      graph.body.nodes.some((n: { stepId?: string }) =>
        n.stepId?.startsWith('llm/'),
      ),
    ).toBe(true);
    for (const node of graph.body.nodes) {
      expect(node.llm).toBeUndefined();
      expect(node.tool).toBeUndefined();
    }
    const steps = await request(server).get(path('/steps'));
    expect(steps.status).toBe(200);
    for (const activity of steps.body.activities) {
      expect(activity.llm).toBeUndefined();
      expect(activity.tool).toBeUndefined();
    }
    const res = await request(server).get(path('/llm-calls/5'));
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/temporal.experimental.aiWorkflows/);
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
});
