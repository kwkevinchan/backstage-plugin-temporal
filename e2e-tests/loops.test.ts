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
import { expect, Page, test } from '@playwright/test';

/*
 * Loops (generate, check, revise): the example worker runs
 * draftReviewWorkflow (done in round 4 of 5) and longRefineWorkflow (25
 * rounds over three runs, continue-as-new every 10 rounds). Screenshots in
 * the light and the dark theme.
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

function loopBox(page: Page, name: string) {
  return page.getByTestId(`loop-${name}`);
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

/** Boxes of the graph that are not fully inside its visible area. */
async function boxesOutsideGraph(page: Page): Promise<string[]> {
  const area = await graph(page).boundingBox();
  if (!area) return ['(no graph)'];
  const outside: string[] = [];
  for (const box of await graph(page)
    .locator('.react-flow__node')
    .getByRole('button')
    .all()) {
    const b = await box.boundingBox();
    const name = (await box.getAttribute('aria-label')) ?? '?';
    if (
      !b ||
      b.x < area.x - 1 ||
      b.y < area.y - 1 ||
      b.x + b.width > area.x + area.width + 1 ||
      b.y + b.height > area.y + area.height + 1
    ) {
      outside.push(name);
    }
  }
  return outside;
}

async function shot(page: Page, name: string, theme: string) {
  mkdirSync(shotDir, { recursive: true });
  await graphSettled(page);
  await page.screenshot({
    path: join(shotDir, `${theme}-${name}.png`),
    fullPage: true,
  });
}

async function openTemporalTab(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
  const entityLink = page.getByRole('link', {
    name: /example-orders|Example orders service/,
  });
  await expect(entityLink.first()).toBeVisible({ timeout: 120_000 });
  await entityLink.first().click();
  await page
    .getByRole('tab', { name: 'Temporal', exact: true })
    .or(page.getByRole('link', { name: 'Temporal', exact: true }))
    .first()
    .click();
  const runs = table(page, 'Workflows');
  await expect(runs).toBeVisible();
  return runs;
}

async function openRun(runs: ReturnType<typeof table>, workflowType: string) {
  await runs
    .getByRole('row')
    .filter({ hasText: workflowType })
    .first()
    .getByRole('link')
    .first()
    .click();
}

for (const theme of ['light', 'dark']) {
  test(`loops: collapsed, expanded, rounds and the Loops tab (${theme})`, async ({
    page,
  }) => {
    if (theme === 'dark') {
      await page.addInitScript(() => {
        window.localStorage.setItem('theme', 'dark');
      });
    }
    const consoleErrors: string[] = [];
    page.on('pageerror', error => consoleErrors.push(String(error)));
    const runs = await openTemporalTab(page);

    // 1. The draft and review loop, collapsed into one box.
    await openRun(runs, 'draftReviewWorkflow');
    const box = loopBox(page, 'draft-review');
    await expect(box).toHaveAttribute(
      'aria-label',
      'Loop draft-review, round 4 of 5, done',
    );
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(
      graph(page).getByRole('button', { name: /^publishDraft, Completed/ }),
    ).toBeVisible();
    await expect(
      graph(page).getByRole('button', { name: /^llmDraft/ }),
    ).toHaveCount(0);
    await shot(page, 'loops-01-collapsed', theme);

    // 2. Expanded: the steps of the last round, then an earlier round.
    await box.click();
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    const controls = page.getByTestId('loop-controls-draft-review');
    await expect(controls.getByTestId('loop-round')).toHaveText('Round 4 of 5');
    await expect(
      graph(page).getByRole('button', { name: /^llmReview, Completed/ }),
    ).toHaveCount(1);
    await graphSettled(page);
    expect(await boxesOutsideGraph(page)).toEqual([]);
    await shot(page, 'loops-02-expanded-round-4', theme);
    await controls.getByRole('button', { name: 'Previous round' }).click();
    await expect(controls.getByTestId('loop-round')).toHaveText('Round 3 of 5');
    // The pause between rounds belongs to the round.
    await expect(
      graph(page).getByRole('button', { name: /^Timer/ }),
    ).toHaveCount(1);
    await shot(page, 'loops-03-expanded-round-3', theme);

    // 3. The Loops tab: one row per round with decision and score; a row
    // opens its round in the graph.
    await page.getByRole('tab', { name: 'Loops' }).click();
    const rounds = table(page, 'Rounds of draft-review');
    await expect(rounds.getByRole('row')).toHaveCount(5);
    await expect(rounds).toContainText('revise');
    await expect(rounds).toContainText('accept');
    await expect(rounds).toContainText('0.92');
    await page.getByTestId('workflow-loops').scrollIntoViewIfNeeded();
    await shot(page, 'loops-04-tab', theme);
    await rounds.getByRole('row').filter({ hasText: '0.62' }).click();
    await expect(controls.getByTestId('loop-round')).toHaveText('Round 2 of 5');

    // 4. The long loop: three runs, 25 rounds counted across them.
    await page.getByRole('link', { name: '← All workflows' }).click();
    await openRun(runs, 'longRefineWorkflow');
    await expect(page.getByTestId('workflow-run-chain')).toContainText(
      'Run 3 of 3',
    );
    const refine = loopBox(page, 'refine');
    await expect(refine).toHaveAttribute(
      'aria-label',
      'Loop refine, round 25 of 25, out of rounds',
    );
    await shot(page, 'loops-05-long-collapsed', theme);
    await page.getByRole('tab', { name: 'Loops' }).click();
    const longRounds = table(page, 'Rounds of refine');
    await expect(longRounds.getByRole('row')).toHaveCount(26);
    await expect(page.getByTestId('workflow-loops')).toContainText(
      '3 runs (continue as new)',
    );
    await expect(longRounds.getByRole('link', { name: 'Run 1' })).toHaveCount(
      10,
    );
    await page.getByTestId('workflow-loops').scrollIntoViewIfNeeded();
    await shot(page, 'loops-06-long-tab', theme);

    // 5. A round of an earlier run opens that run, expanded to the round.
    await longRounds
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: '5', exact: true }) })
      .getByRole('link', { name: 'Run 1' })
      .click();
    await expect(page.getByTestId('workflow-run-chain')).toContainText(
      'Run 1 of 3',
    );
    await expect(refine).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByTestId('loop-controls-refine').getByTestId('loop-round'),
    ).toHaveText('Round 5 of 25');
    await shot(page, 'loops-07-earlier-run-round-5', theme);
    expect(consoleErrors).toEqual([]);
  });
}
