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

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, Locator, Page, test } from '@playwright/test';

/*
 * LLM steps: the example worker runs agentWorkflow (four rounds of model
 * call and tools, with loop markers; a tool fails once and is retried, one
 * runs as a local activity, the last answer is stored in S3) and
 * mixedAgentWorkflow (ordinary activities, model calls, two tools in
 * parallel and a child workflow). No model is called.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

function graph(page: Page) {
  return page.getByTestId('workflow-graph');
}

/** Waits until the graph has stopped moving (relayout and pan animations). */
async function graphSettled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => {
        const viewport = document.querySelector('.react-flow__viewport');
        const nodes = [...document.querySelectorAll('.react-flow__node')].map(
          n => (n as HTMLElement).style.transform,
        );
        return `${
          viewport ? getComputedStyle(viewport).transform : ''
        }|${nodes}`;
      });
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await graphSettled(page);
  await page.screenshot({
    path: join(shotDir, `llm-${name}.png`),
    fullPage: true,
  });
}

/** Font sizes of the text drawn in the graph, at its zoom. */
async function drawnFontSizes(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport');
    const zoom = viewport
      ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
      : 1;
    return [...document.querySelectorAll('.react-flow__node [data-llm] span')]
      .filter(e => (e.textContent ?? '').trim() !== '')
      .map(e => parseFloat(getComputedStyle(e).fontSize) * zoom);
  });
}

async function openRun(page: Page, workflowType: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
  await expect(
    page.getByRole('link', { name: 'Workflows', exact: true }).first(),
  ).toBeVisible({ timeout: 120_000 });
  await page.goto('/catalog/default/component/example-orders');
  await page
    .getByRole('tab', { name: 'Temporal', exact: true })
    .or(page.getByRole('link', { name: 'Temporal', exact: true }))
    .first()
    .click();
  const runs = table(page, 'Workflows');
  await expect(runs.getByText(workflowType).first()).toBeVisible({
    timeout: 120_000,
  });
  await runs
    .getByRole('row')
    .filter({ hasText: workflowType })
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(graph(page)).toBeVisible();
}

function modelCall(page: Page, name: RegExp | string = /^Model call/) {
  return graph(page).getByRole('button', { name });
}

function section(page: Page, id: string): Locator {
  return page.getByTestId(id);
}

test('LLM steps: agent graph, LLM panel, tool cards, Loops tokens, timeline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openRun(page, 'agentWorkflow');

  // The loop box, expanded to round 2: a model call and its three tools.
  await page.getByTestId('loop-agent').click();
  const controls = page.getByTestId('loop-controls-agent');
  await expect(controls.getByTestId('loop-round')).toContainText('Round 4');
  await controls.getByRole('button', { name: 'Previous round' }).click();
  await controls.getByRole('button', { name: 'Previous round' }).click();
  await expect(controls.getByTestId('loop-round')).toContainText('Round 2');
  const call = modelCall(page, /^Model call callModel, fake-reasoner/);
  await expect(call).toBeVisible();
  await expect(call).toContainText('fake-reasoner-1-2026-11');
  await expect(call).toContainText(/\d+ in · \d+ out · [\d.]+m?s · 3 tools/);
  const tools = graph(page).locator('[data-llm="tool"]');
  await expect(tools).toHaveCount(3);
  await expect(
    graph(page).getByRole('button', {
      name: /^Tool call read_file, Completed, attempt 2/,
    }),
  ).toBeVisible();
  await expect(
    graph(page).getByRole('button', { name: /^Tool call glossary/ }),
  ).toBeVisible();
  // Arrows from the model call to its tools are drawn as tool arrows.
  await expect(
    graph(page).locator('.react-flow__edge.temporal-llm-tool-edge'),
  ).toHaveCount(3);
  for (const size of await drawnFontSizes(page)) {
    expect(size).toBeGreaterThanOrEqual(12);
  }
  await shot(page, '01-agent-graph-round');

  // The LLM panel: input, thinking (collapsed), output, tool calls, usage.
  await call.click();
  const panel = page.getByTestId('llm-panel');
  await expect(panel).toBeVisible();
  const input = section(page, 'llm-input');
  await expect(input.getByTestId('llm-message').first()).toHaveAttribute(
    'data-role',
    'system',
  );
  await expect(input).toContainText('Explain payload storage');
  const thinking = page.getByTestId('llm-thinking-details');
  await expect(thinking).not.toHaveAttribute('open', '');
  await thinking.locator('summary').click();
  await expect(thinking).toContainText('I should read both');
  await expect(section(page, 'llm-output')).toContainText(
    'Reading the two documents.',
  );
  const cards = section(page, 'llm-tools').getByTestId('llm-tool-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('read_file');
  await expect(cards.first()).toContainText('docs/flaky.md');
  await expect(cards.first()).toContainText('Attempt 2');
  await expect(cards.nth(2)).toContainText('glossary');
  await expect(section(page, 'llm-usage')).toContainText('Input tokens');
  await expect(section(page, 'llm-usage')).toContainText('Reasoning tokens');
  for (const name of ['input', 'thinking', 'output', 'tool calls', 'usage']) {
    await expect(
      page.getByRole('button', { name: `Copy ${name}` }),
    ).toBeVisible();
  }
  await shot(page, '02-llm-panel');
  await page.getByTestId('step-drawer').screenshot({
    path: join(shotDir, 'llm-03-llm-panel-close.png'),
  });

  // A tool card goes to its step; the step goes back to the model call.
  await cards
    .first()
    .getByRole('button', { name: 'Go to the step of read_file' })
    .click();
  const drawer = page.getByTestId('step-drawer');
  await expect(
    drawer.getByRole('heading', { name: 'read_file' }),
  ).toBeVisible();
  await expect(drawer.getByTestId('tool-of-call')).toContainText('call_2a');
  await expect(drawer.getByTestId('step-attempts')).toContainText(
    'File server busy',
  );
  await shot(page, '04-tool-step');
  await drawer.getByRole('button', { name: /^Model call r2/ }).click();
  await expect(page.getByTestId('llm-panel')).toContainText('LLM call r2');

  // The raw record.
  await page.getByText('Raw JSON', { exact: true }).click();
  await expect(section(page, 'llm-raw')).toContainText('gen_ai.input.messages');
  await page.getByText('Raw JSON', { exact: true }).click();

  // The last round: the answer is stored in S3 (when the worker uses it).
  await controls.getByRole('button', { name: 'Next round' }).click();
  await controls.getByRole('button', { name: 'Next round' }).click();
  await expect(controls.getByTestId('loop-round')).toContainText('Round 4');
  await modelCall(page, /^Model call callModel/).click();
  const output = section(page, 'llm-output');
  await expect(output).toContainText('# Report: payload storage');
  await expect(output.getByRole('button', { name: /Show all/ })).toBeVisible();
  await expect(section(page, 'llm-tools')).toContainText('asked for no tools');

  // The Loops tab: tokens of each round and of the loop.
  await page.getByRole('tab', { name: 'Loops' }).click();
  const loops = page.getByTestId('loop-table-agent');
  await expect(
    loops.getByRole('columnheader', { name: 'Tokens' }),
  ).toBeVisible();
  for (const round of [1, 2, 3, 4]) {
    await expect(loops.getByTestId(`round-tokens-${round}`)).toContainText(
      /\d+(\.\d)?k? in · \d+(\.\d)?k? out/,
    );
  }
  await expect(loops.getByTestId('loop-tokens-total')).toContainText('Tokens:');
  await expect(loops.getByLabel('Model call')).toHaveCount(4);
  await page.getByTestId('workflow-loops').scrollIntoViewIfNeeded();
  await shot(page, '05-loops-tokens');

  // The Timeline: model and tool calls have their own icons and outline.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const timeline = page.getByTestId('workflow-timeline');
  await timeline.getByRole('button', { name: 'Expand rounds' }).click();
  await expect(timeline.getByLabel('Model call').first()).toBeVisible();
  await expect(timeline.locator('[data-llm="call"]').first()).toBeVisible();
  await expect(timeline.locator('[data-llm="tool"]').first()).toBeVisible();
  await shot(page, '06-timeline');
  expect(errors).toEqual([]);
});

test('LLM steps: a mixed workflow with parallel tools and a child workflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await openRun(page, 'mixedAgentWorkflow');
  // Ordinary steps keep their boxes.
  await expect(
    graph(page).getByRole('button', { name: /^loadTicket, Completed/ }),
  ).toBeVisible();
  await expect(
    graph(page).getByRole('button', { name: /^postAnswer, Completed/ }),
  ).toBeVisible();
  // Two model calls; the first asks for two tools that run in parallel.
  await expect(modelCall(page)).toHaveCount(2);
  const search = graph(page).getByRole('button', { name: /^Tool call search/ });
  const read = graph(page).getByRole('button', {
    name: /^Tool call read_file/,
  });
  await expect(search).toBeVisible();
  await expect(read).toBeVisible();
  await graphSettled(page);
  const a = (await search.boundingBox())!;
  const b = (await read.boundingBox())!;
  // Parallel branches: the same column, one above the other.
  expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);
  expect(Math.abs(a.y - b.y)).toBeGreaterThan(20);
  await shot(page, '07-mixed-parallel');
  // The child workflow is an ordinary step with a link to its run.
  const child = graph(page).getByRole('button', {
    name: /^summarizeResultsWorkflow, Completed/,
  });
  await child.click();
  const drawer = page.getByTestId('step-drawer');
  await expect(drawer).toContainText('Child workflow');
  await expect(drawer.getByRole('link', { name: /-summary$/ })).toBeVisible();
  await shot(page, '08-mixed-child');
  await drawer.getByRole('link', { name: /-summary$/ }).click();
  await expect(
    graph(page).getByRole('button', { name: /^postAnswer, Completed/ }),
  ).toBeVisible();
  // A workflow without LLM steps has no LLM boxes.
  await expect(graph(page).locator('[data-llm]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('LLM steps in the dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
  });
  await openRun(page, 'agentWorkflow');
  await expect(page.locator('body')).toHaveAttribute('data-theme-mode', 'dark');
  await page.getByTestId('loop-agent').click();
  const controls = page.getByTestId('loop-controls-agent');
  await controls.getByRole('button', { name: 'Previous round' }).click();
  await controls.getByRole('button', { name: 'Previous round' }).click();
  await modelCall(page, /^Model call callModel/).click();
  await page.getByTestId('llm-thinking-details').locator('summary').click();
  await expect(
    section(page, 'llm-tools').getByTestId('llm-tool-card'),
  ).toHaveCount(3);
  await shot(page, '09-dark-llm-panel');
});
