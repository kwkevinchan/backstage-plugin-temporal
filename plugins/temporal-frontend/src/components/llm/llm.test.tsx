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

import { fireEvent, screen, within } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { temporalApiRef } from '../../extensions';
import {
  graphResponse,
  llmCallResponse,
  llmGraphResponse,
  mockTemporalApi,
} from '../../testData';
import { WorkflowGraph } from '../graph/WorkflowGraph';
import { layoutSteps, stepSize, visibleSteps } from '../graph/layout';
import { StepDrawer } from '../StepDrawer';
import type { WorkflowGraphResponse } from '../../common';
import {
  formatCallDuration,
  formatTokens,
  llmBoxTitle,
  llmCallName,
  llmStatsText,
} from './llmText';

const node = (id: string) => llmGraphResponse.nodes.find(n => n.id === id)!;
const ref = { namespace: 'default', workflowId: 'agent-1', runId: 'run-1' };

async function renderDrawer(
  id: string,
  options: {
    api?: ReturnType<typeof mockTemporalApi>;
  } = {},
) {
  const api = options.api ?? mockTemporalApi();
  const onSelectStep = jest.fn();
  await renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api]]}>
      <StepDrawer
        step={node(id)}
        workflowHref={() => '/x'}
        onClose={() => {}}
        nodes={llmGraphResponse.nodes}
        workflowRef={ref}
        entityRef="component:default/agents"
        onSelectStep={onSelectStep}
      />
    </TestApiProvider>,
  );
  return { api, onSelectStep };
}

describe('LLM text', () => {
  it('formats tokens, durations and the stats line', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(1240)).toBe('1.2k');
    expect(formatTokens(15400)).toBe('15k');
    expect(formatTokens(1_250_000)).toBe('1.3M');
    expect(formatCallDuration(340)).toBe('340ms');
    expect(formatCallDuration(1500)).toBe('1.5s');
    expect(llmStatsText(node('activity-5').llm!)).toBe(
      '1.2k in · 96 out · 1.5s · 1 tool',
    );
  });
});

describe('LLM steps in the graph', () => {
  it('draws model calls with model, tokens, duration and tools, and tool calls as small boxes', async () => {
    await renderInTestApp(
      <WorkflowGraph graph={llmGraphResponse} onSelect={() => {}} />,
    );
    const call = screen.getByTestId('step-activity-5');
    expect(call).toHaveAttribute('data-llm', 'call');
    expect(call).toHaveTextContent('r1');
    expect(call).toHaveTextContent('fake-reasoner-1');
    expect(call).toHaveTextContent('1.2k in · 96 out · 1.5s · 1 tool');
    const tool = screen.getByTestId('step-activity-8');
    expect(tool).toHaveAttribute('data-llm', 'tool');
    expect(tool).toHaveTextContent('search');
    expect(tool).toHaveTextContent('×2');
    expect(tool).toHaveTextContent('Completed');
  });

  it('gives model and tool calls their own sizes, other steps keep theirs', () => {
    expect(stepSize(node('activity-5'))).toEqual({ width: 240, height: 86 });
    expect(stepSize(node('activity-8'))).toEqual({ width: 180, height: 52 });
    expect(stepSize(node('start'))).toEqual({ width: 220, height: 64 });
    // A workflow without LLM steps is laid out without sizes, as before.
    const visible = visibleSteps(graphResponse.nodes, graphResponse.edges);
    expect(visible.nodes.every(n => !n.llm && !n.tool)).toBe(true);
    const plain = layoutSteps(visible.nodes, visible.edges, 600);
    expect(plain.sizes).toBeUndefined();
  });
});

describe('LLM panel', () => {
  it('shows input, thinking, output, tool calls and usage', async () => {
    const { api, onSelectStep } = await renderDrawer('activity-5');
    expect(api.getLlmCall).toHaveBeenCalledWith(ref, 'activity-5', {
      entityRef: 'component:default/agents',
    });
    const input = await screen.findByTestId('llm-input');
    const messages = within(input).getAllByTestId('llm-message');
    expect(messages.map(m => m.getAttribute('data-role'))).toEqual([
      'system',
      'user',
    ]);
    // Long text starts collapsed.
    expect(
      within(messages[1]).getByRole('button', { name: /Show all/ }),
    ).toBeInTheDocument();
    // Thinking is collapsed by default.
    const thinking = screen.getByTestId('llm-thinking-details');
    expect(thinking).not.toHaveAttribute('open');
    expect(thinking).toHaveTextContent('I should search the docs first.');
    expect(screen.getByTestId('llm-output')).toHaveTextContent('Searching.');
    expect(screen.getByTestId('llm-output')).not.toHaveTextContent(
      'I should search',
    );
    // Tool calls: the step of the tool the model asked for.
    const cards = within(screen.getByTestId('llm-tools')).getAllByTestId(
      'llm-tool-card',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('search');
    expect(cards[0]).toHaveTextContent('"query": "storage"');
    expect(cards[0]).toHaveTextContent('Attempt 2');
    expect(cards[0]).toHaveTextContent('hits');
    fireEvent.click(
      within(cards[0]).getByRole('button', {
        name: 'Go to the step of search',
      }),
    );
    expect(onSelectStep).toHaveBeenCalledWith('activity-8');
    const usage = screen.getByTestId('llm-usage');
    expect(usage).toHaveTextContent('Input tokens1.2k');
    expect(usage).toHaveTextContent('Reasoning tokens40');
    expect(usage).toHaveTextContent('Cached input800');
    expect(usage).toHaveTextContent('Cache write440');
    expect(usage).toHaveTextContent('Duration1.5s');
    // What the call was sent with and the ID of the response.
    expect(screen.getByTestId('llm-framework')).toHaveTextContent(
      'vercel-ai-sdk',
    );
    expect(screen.getByTestId('llm-response-id')).toHaveTextContent(
      'resp_9f2c',
    );
    expect(screen.getByTestId('llm-parameters')).toHaveTextContent(
      'maxOutputTokens',
    );
    expect(screen.getByTestId('llm-tool-definitions')).toHaveTextContent(
      'Tool definitions (1)',
    );
    // Every section has a copy button.
    for (const name of [
      'input',
      'thinking',
      'output',
      'tool calls',
      'usage',
      'details',
    ]) {
      expect(
        screen.getByRole('button', { name: `Copy ${name}` }),
      ).toBeInTheDocument();
    }
    // The raw record.
    fireEvent.click(screen.getByRole('switch', { name: 'Raw JSON' }));
    expect(screen.getByTestId('llm-raw')).toHaveTextContent(
      'gen_ai.request.model',
    );
    expect(screen.queryByTestId('llm-input')).not.toBeInTheDocument();
  });

  it('says why a record cannot be shown', async () => {
    const api = mockTemporalApi();
    (api.getLlmCall as jest.Mock).mockResolvedValue({
      ...llmCallResponse,
      record: undefined,
      raw: undefined,
      unavailable: 'The result is encoded by a payload codec.',
    });
    await renderDrawer('activity-5', { api });
    expect(await screen.findByTestId('llm-unavailable')).toHaveTextContent(
      'payload codec',
    );
  });

  it('shows file parts by name, ID or MIME type, never as undefined', async () => {
    const api = mockTemporalApi();
    (api.getLlmCall as jest.Mock).mockResolvedValue({
      ...llmCallResponse,
      record: {
        ...llmCallResponse.record,
        inputMessages: [
          {
            role: 'user',
            parts: [
              { type: 'file', mime_type: 'application/pdf', name: 'a.pdf' },
              { type: 'file', modality: 'image', file_id: 'file-9' },
              { type: 'file', mime_type: 'text/plain' },
              { type: 'file' },
            ],
          },
        ],
      },
    });
    await renderDrawer('activity-5', { api });
    const input = await screen.findByTestId('llm-input');
    const text = input.textContent ?? '';
    expect(text).toContain('file: a.pdf (application/pdf)');
    expect(text).toContain('image: file-9');
    expect(text).toContain('file (text/plain)');
    expect(text).not.toContain('undefined');
  });

  it('leaves out the details and the cache write tile that the record lacks', async () => {
    const api = mockTemporalApi();
    const {
      responseId: _responseId,
      parameters: _parameters,
      toolDefinitions: _toolDefinitions,
      ...bare
    } = llmCallResponse.record!;
    (api.getLlmCall as jest.Mock).mockResolvedValue({
      ...llmCallResponse,
      record: { ...bare, usage: { inputTokens: 5 } },
    });
    await renderDrawer('activity-5', { api });
    expect(await screen.findByTestId('llm-input')).toBeInTheDocument();
    expect(screen.queryByTestId('llm-details')).toBeNull();
    expect(screen.getByTestId('llm-usage')).not.toHaveTextContent(
      'Cache write',
    );
  });

  it('shows where a record in External Storage is', async () => {
    const api = mockTemporalApi();
    (api.getLlmCall as jest.Mock).mockResolvedValue({
      ...llmCallResponse,
      record: undefined,
      raw: undefined,
      unavailable: 'The record is stored in External Storage.',
      external: {
        store: 's3',
        bucket: 'payloads',
        key: 'v0/d/sha256/abc',
        size: 4096,
        sha256: 'a'.repeat(64),
      },
    });
    await renderDrawer('activity-5', { api });
    expect(await screen.findByTestId('llm-unavailable')).toHaveTextContent(
      'External Storage',
    );
    expect(screen.getByTestId('external-location')).toHaveTextContent(
      's3://payloads/v0/d/sha256/abc',
    );
    expect(screen.queryByTestId('llm-output')).toBeNull();
  });

  it('links a tool call back to its model call', async () => {
    const { api, onSelectStep } = await renderDrawer('activity-8');
    expect(api.getLlmCall).not.toHaveBeenCalled();
    const panel = screen.getByTestId('tool-of-call');
    expect(panel).toHaveTextContent('call_1a');
    fireEvent.click(
      within(panel).getByRole('button', { name: /Model call r1/ }),
    );
    expect(onSelectStep).toHaveBeenCalledWith('activity-5');
    expect(screen.getByTestId('step-output')).toHaveTextContent('hits');
  });
});

/** A model call of an official integration: no call name, no provider. */
const officialGraph: WorkflowGraphResponse = {
  status: 'Completed',
  completedSteps: 2,
  totalSteps: 2,
  truncated: false,
  edges: [{ id: 'm->t', source: 'activity-11', target: 'activity-17' }],
  nodes: [
    {
      id: 'activity-11',
      kind: 'activity',
      name: 'invokeModel',
      summary: 'plan call',
      status: 'Completed',
      events: [],
      llm: {
        framework: 'vercel-ai-sdk',
        record: 'available',
        model: 'fake-model-2026-11',
        usage: { inputTokens: 121, outputTokens: 30 },
        reasoning: true,
        toolCalls: [
          {
            id: 'call_1',
            name: 'search_docs',
            nodeId: 'activity-17',
            status: 'Completed',
            inferred: true,
          },
        ],
      },
    },
    {
      id: 'activity-17',
      kind: 'activity',
      name: 'searchDocs',
      status: 'Completed',
      events: [],
      tool: {
        toolCallId: 'call_1',
        llmNodeId: 'activity-11',
        name: 'search_docs',
        inferred: true,
      },
    },
  ],
};

describe('Model calls of the official integrations', () => {
  it('are titled by the summary, else the model', () => {
    const [call] = officialGraph.nodes;
    expect(llmCallName(call)).toBe('plan call');
    expect(llmBoxTitle(call)).toBe('plan call');
    const { summary: _summary, ...withoutSummary } = call;
    expect(llmBoxTitle(withoutSummary)).toBe('fake-model-2026-11');
    expect(llmCallName(node('activity-5'))).toBe('r1');
  });

  it('mark an inferred tool link', async () => {
    await renderInTestApp(
      <WorkflowGraph graph={officialGraph} onSelect={() => {}} />,
    );
    expect(screen.getByTestId('step-activity-11')).toHaveTextContent(
      'plan call',
    );
    const tool = screen.getByTestId('step-activity-17');
    expect(tool).toHaveTextContent('search_docs');
    expect(tool).toHaveTextContent('Inferred link');
  });
});
