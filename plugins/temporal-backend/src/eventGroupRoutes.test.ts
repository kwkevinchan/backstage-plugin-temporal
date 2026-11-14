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
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { readHistoryFixture } from './__testUtils__/fixtures';
import { withOpenApiValidation } from './__testUtils__/openapi';

const ref = 'component:default/orders';
const graphPath = `/api/temporal/namespaces/default/workflows/wf-1/graph?entityRef=${ref}`;

/** The events of a history of `test-fixtures/<dir>`. */
function fixture(name: string, dir = 'event-groups'): any[] {
  return readHistoryFixture(dir, name).events;
}

async function start(options: {
  history: boolean;
  events: any[];
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
        history: { events: structuredClone(options.events) },
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
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      mockServices.rootConfig.factory({
        data: {
          temporal: { experimental: { aiWorkflows: options.ai !== false } },
        },
      }),
    ],
  });
  return withOpenApiValidation(server);
}

describe('event groups in the graph route', () => {
  it('shows the groups, their labels and their tokens without the history permission', async () => {
    const server = await start({
      history: false,
      events: fixture('loop-ts-sdk-1.25'),
    });
    const res = await request(server).get(graphPath);
    expect(res.status).toBe(200);
    expect(res.body.payloadsHidden).toBe(true);
    const loop = res.body.eventGroups.find(
      (g: any) => g.key === 'label:loop:draft-review',
    );
    // Structure and the label, like the summary of a step.
    expect(loop).toMatchObject({
      kind: 'label',
      name: 'Loop draft-review',
      status: 'Completed',
      children: [
        'label:loop:draft-review:1',
        'label:loop:draft-review:2',
        'label:loop:draft-review:3',
      ],
    });
    expect(loop.nodeIds).toHaveLength(9);
    const step = res.body.nodes.find((n: any) => n.id === 'activity-16');
    expect(step.groups).toEqual([
      'label:loop:draft-review',
      'label:loop:draft-review:1',
    ]);
    expect(step.summary).toBe('review round 1');
    // No inputs or results.
    expect(step.input).toBeUndefined();
    expect(step.result).toBeUndefined();
    const body = JSON.stringify(res.body);
    for (const text of ['第 1 版', '還不夠具體', '多寫一個例子']) {
      expect(body).not.toContain(text);
    }

    const agent = await start({
      history: false,
      events: fixture('vercel-ai-sdk-agent', 'llm-integrations'),
    });
    const agentRes = await request(agent).get(graphPath);
    expect(agentRes.status).toBe(200);
    const round = agentRes.body.eventGroups.find(
      (g: any) => g.key === 'label:loop:agent:1',
    );
    expect(round).toMatchObject({
      name: 'agent · round 1',
      llmCalls: 3,
      usage: { inputTokens: 643, outputTokens: 90 },
    });
  });

  it('shows the same groups with the history permission', async () => {
    const events = fixture('loop-ts-sdk-1.25');
    const reader = await request(await start({ history: false, events })).get(
      graphPath,
    );
    const historyReader = await request(
      await start({ history: true, events }),
    ).get(graphPath);
    expect(historyReader.status).toBe(200);
    expect(historyReader.body.payloadsHidden).toBe(false);
    expect(historyReader.body.eventGroups).toEqual(reader.body.eventGroups);
  });

  it('shows the groups with the experimental views off', async () => {
    const res = await request(
      await start({
        history: false,
        ai: false,
        events: fixture('codec-loop'),
      }),
    ).get(graphPath);
    expect(res.status).toBe(200);
    expect(res.body.loops).toBeUndefined();
    expect(res.body.eventGroups).toHaveLength(5);
    expect(res.body.eventGroups[0]).toMatchObject({
      key: 'label:loop:draft-review',
      name: 'loop:draft-review',
      labelUnreadable: true,
    });
  });

  it('answers as before for a run without groups', async () => {
    const events = fixture('loop-ts-sdk-1.25');
    const stripped = events.map(({ eventGroupMarkers: _m, ...e }) => e);
    const plain = await request(
      await start({ history: true, events: stripped }),
    ).get(graphPath);
    expect(plain.status).toBe(200);
    expect(plain.body).not.toHaveProperty('eventGroups');
    expect(plain.body).not.toHaveProperty('eventGroupsTruncated');
    expect(plain.body.nodes.some((n: any) => 'groups' in n)).toBe(false);

    const grouped = await request(await start({ history: true, events })).get(
      graphPath,
    );
    const { eventGroups: _g, ...rest } = grouped.body;
    expect({
      ...rest,
      nodes: rest.nodes.map(({ groups: _n, ...n }: any) => n),
    }).toEqual(plain.body);
  });
});
