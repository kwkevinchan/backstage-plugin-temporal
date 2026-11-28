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
import request from 'supertest';
import { memoryS3, storeExternally } from './__testUtils__/externalStorage';
import { readHistoryFixture } from './__testUtils__/fixtures';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const ref = 'component:default/orders';
const plain = (value: unknown) => ({
  metadata: { encoding: b64('json/plain') },
  data: b64(JSON.stringify(value)),
});

/** A Vercel AI SDK result that a worker stores in External Storage. */
const bigResult = {
  content: [
    { type: 'reasoning', text: 'thinking hard' },
    { type: 'text', text: `the answer ${'x'.repeat(4000)}` },
  ],
  finishReason: 'stop',
  usage: {
    inputTokens: { total: 5000 },
    outputTokens: { total: 900 },
  },
  response: { id: 'resp-big', modelId: 'gpt-big' },
};
const smallResult = {
  content: [{ type: 'text', text: 'hi' }],
  finishReason: 'stop',
  usage: { inputTokens: { total: 10 }, outputTokens: { total: 2 } },
  response: { id: 'resp-small', modelId: 'gpt-small' },
};
const bigInput = {
  modelId: 'gpt-big',
  options: {
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(4000) }] },
    ],
  },
};
const smallInput = {
  modelId: 'gpt-small',
  options: {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi?' }] }],
  },
};

/** The result of `bigResult` as the official S3 driver stores it. */
let stored: Awaited<ReturnType<typeof storeExternally>>;

beforeAll(async () => {
  stored = await storeExternally(memoryS3(), bigResult);
});

function events() {
  return [
    { eventId: '1', workflowExecutionStartedEventAttributes: {} },
    {
      eventId: '2',
      activityTaskScheduledEventAttributes: {
        activityId: 'model-big',
        activityType: { name: 'invokeModel' },
        input: { payloads: [plain(bigInput)] },
      },
    },
    {
      eventId: '3',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '2',
        result: { payloads: [structuredClone(stored.payload)] },
      },
    },
    {
      eventId: '4',
      activityTaskScheduledEventAttributes: {
        activityId: 'model-small',
        activityType: { name: 'invokeModel' },
        input: { payloads: [plain(smallInput)] },
      },
    },
    {
      eventId: '5',
      activityTaskCompletedEventAttributes: {
        scheduledEventId: '4',
        result: { payloads: [plain(smallResult)] },
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
        activityId: 'model-sealed',
        activityType: { name: 'invokeModel' },
        input: { payloads: [plain(smallInput)] },
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
  /** Denies `temporal.workflow.read`; every other permission is allowed. */
  denyRead?: boolean;
  events?: () => unknown[];
  historyPage?: (req: any) => { events: unknown[]; nextPageToken?: Uint8Array };
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
    async (req: any) => {
      if (options.historyPage) {
        const page = options.historyPage(req);
        return {
          history: { events: page.events },
          nextPageToken: page.nextPageToken ?? new Uint8Array(),
        } as any;
      }
      return {
        history: { events: (options.events ?? events)() },
        nextPageToken: new Uint8Array(),
      } as any;
    },
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result:
          options.denyRead && r.permission.name === 'temporal.workflow.read'
            ? AuthorizeResult.DENY
            : AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
    ],
  });
  return { server: await withOpenApiValidation(server) };
}

const path = (rest: string) =>
  `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run${rest}?entityRef=${ref}`;

/** The events of a history of `test-fixtures/llm-integrations`. */
function integrationEvents(name: string): any[] {
  return readHistoryFixture('llm-integrations', name).events;
}

const decoded = (payload: any) =>
  JSON.parse(Buffer.from(payload.data, 'base64').toString());

describe('LLM routes', () => {
  it('shows model calls of the official adapters', async () => {
    const { server } = await start({});
    const graph = await request(server).get(path('/graph'));
    expect(graph.status).toBe(200);
    const small = graph.body.nodes.find(
      (n: { stepId?: string }) => n.stepId === 'model-small',
    );
    expect(small.llm).toMatchObject({
      framework: 'vercel-ai-sdk',
      model: 'gpt-small',
    });
    const res = await request(server).get(path('/llm-calls/4'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      framework: 'vercel-ai-sdk',
      record: { requestModel: 'gpt-small' },
    });
    // One call per step: no call name, position or count.
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'activityId',
        'activityType',
        'framework',
        'nodeId',
        'raw',
        'record',
        'status',
      ].sort(),
    );
  });

  it('says where a record stored in External Storage is, without reading it', async () => {
    const { server } = await start({});
    const res = await request(server).get(path('/llm-calls/2'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nodeId: 'activity-2',
      activityId: 'model-big',
      activityType: 'invokeModel',
      status: 'Completed',
      unavailable: expect.stringMatching(/External Storage/),
      external: {
        store: 's3',
        bucket: 'payloads',
        key: stored.key,
        sha256: stored.sha256,
      },
    });
    expect(res.body.record).toBeUndefined();
    expect(res.body.raw).toBeUndefined();
  });

  it('explains records it cannot read', async () => {
    const { server } = await start({});
    const sealed = await request(server).get(path('/llm-calls/8'));
    expect(sealed.status).toBe(200);
    expect(sealed.body.record).toBeUndefined();
    expect(sealed.body.unavailable).toMatch(/codec/);
    expect((await request(server).get(path('/llm-calls/6'))).status).toBe(404);
    const missing = await request(server).get(path('/llm-calls/99'));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('No model call 99 in this run');
    expect((await request(server).get(path('/llm-calls/x2'))).status).toBe(400);
  });

  it('explains when a model call is beyond the history truncation limit', async () => {
    const pageSize = 500;
    const filler = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        eventId: String(from + i),
        workflowTaskCompletedEventAttributes: {},
      }));
    const { server } = await start({
      historyPage: req => {
        const page =
          req.nextPageToken && req.nextPageToken.length > 0
            ? Number(Buffer.from(req.nextPageToken).toString('utf8'))
            : 0;
        const startEvent = page * pageSize + 1;
        const endEvent = (page + 1) * pageSize;
        return {
          events:
            page === 0
              ? [...events(), ...filler(10, endEvent)]
              : filler(startEvent, endEvent),
          nextPageToken: Buffer.from(String(page + 1)),
        };
      },
    });

    const beyond = await request(server).get(path('/llm-calls/5002'));
    expect(beyond.status).toBe(404);
    expect(beyond.body.error).toMatchObject({
      name: 'NotFoundError',
      message:
        'Model call 5002 was not found within the first 5000 history events of this run; the history was truncated',
    });

    for (const id of ['6', '1']) {
      const notModel = await request(server).get(path(`/llm-calls/${id}`));
      expect(notModel.status).toBe(404);
      expect(notModel.body.error.message).toBe(
        `No model call ${id} in this run`,
      );
    }

    const ok = await request(server).get(path('/llm-calls/4'));
    expect(ok.status).toBe(200);
    expect(ok.body.record.requestModel).toBe('gpt-small');
  });

  it('needs the read permission for the record', async () => {
    const { server } = await start({ denyRead: true });
    expect((await request(server).get(path('/llm-calls/2'))).status).toBe(403);
  });

  it('shows summaries in the graph', async () => {
    const { server } = await start({});
    const res = await request(server).get(path('/graph'));
    expect(res.status).toBe(200);
    const byId = (id: string) => res.body.nodes.find((n: any) => n.id === id);
    expect(byId('activity-4').llm).toMatchObject({
      record: 'available',
      model: 'gpt-small',
      usage: { inputTokens: 10 },
    });
    // Stored in External Storage: there is nothing to read.
    expect(byId('activity-2').llm.record).toBe('unreadable');
    expect(byId('activity-8').llm.record).toBe('unreadable');
    expect(byId('activity-6').llm).toBeUndefined();
  });

  it('shows a model call whose input is in External Storage without its model name', async () => {
    const history = integrationEvents('openai-agents-agent');
    const scheduled = history.find(
      (e: any) => e.eventId === '17',
    ).activityTaskScheduledEventAttributes;
    const { payload } = await storeExternally(
      memoryS3(),
      decoded(scheduled.input.payloads[0]),
      { workflowId: 'openai-input' },
    );
    scheduled.input = { payloads: [payload] };

    const { server } = await start({
      events: () => structuredClone(history),
    });
    const graph = await request(server).get(path('/graph'));
    expect(graph.status).toBe(200);
    const node = (id: string) => graph.body.nodes.find((n: any) => n.id === id);
    // The model name is only in the input.
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
    const res = await request(server).get(path('/llm-calls/17'));
    expect(res.status).toBe(200);
    expect(res.body.record.requestModel).toBeUndefined();
  });
});
