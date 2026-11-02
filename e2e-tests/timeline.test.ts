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
 * The Timeline tab: a failed run with retries, a running run whose bars
 * grow until now, and the rounds of a loop. Hover, select, drag to zoom.
 * Screenshots in the light and the dark theme.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

/** The Timeline tab with the step panel next to it. */
async function shot(page: Page, name: string, theme: string) {
  mkdirSync(shotDir, { recursive: true });
  const tab = page
    .getByTestId('workflow-timeline')
    .locator('xpath=ancestor::*[@role="tabpanel"][1]');
  await tab.scrollIntoViewIfNeeded();
  await tab.screenshot({ path: join(shotDir, `${theme}-${name}.png`) });
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

async function openTimeline(page: Page) {
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const timeline = page.getByTestId('workflow-timeline');
  await expect(timeline).toBeVisible();
  await timeline.scrollIntoViewIfNeeded();
  return timeline;
}

/** Font sizes of the timeline text, in pixels. */
async function smallestFont(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="workflow-timeline"]');
    let min = Infinity;
    root?.querySelectorAll('*').forEach(el => {
      const text = [...el.childNodes].some(
        n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (text) {
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
    });
    return min;
  });
}

for (const theme of ['light', 'dark']) {
  test(`timeline: bars, hover, panel, zoom, live and loops (${theme})`, async ({
    page,
  }) => {
    if (theme === 'dark') {
      await page.addInitScript(() => {
        window.localStorage.setItem('theme', 'dark');
      });
    }
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    const runs = await openTemporalTab(page);

    // 1. A failed run: the failed step is red, retries are counted.
    await openRun(runs, 'paymentWorkflow');
    let timeline = await openTimeline(page);
    const failed = timeline.getByRole('button', { name: /, Failed/ }).first();
    await expect(failed).toBeVisible();
    await expect(failed).toHaveAttribute('data-tone', 'danger');
    expect(await smallestFont(page)).toBeGreaterThanOrEqual(12);
    await shot(page, 'timeline-01-failed', theme);

    // 2. Hover shows the details; a click opens the step panel.
    await failed.hover();
    await expect(page.getByTestId('timeline-tooltip')).toBeVisible();
    await shot(page, 'timeline-02-hover', theme);
    await failed.click();
    const drawer = page.getByTestId('step-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Failed');
    await shot(page, 'timeline-03-panel', theme);
    await drawer.getByRole('button', { name: 'Close step details' }).click();

    // 3. Drag across the chart to zoom in, then back to the whole run.
    const axis = page.getByTestId('timeline-axis');
    const box = (await axis.boundingBox())!;
    const y = box.y + box.height + 40;
    await page.mouse.move(box.x + box.width * 0.1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 5 });
    await page.mouse.up();
    const wholeRun = timeline.getByRole('button', { name: 'Whole run' });
    await expect(wholeRun).toBeEnabled();
    await shot(page, 'timeline-04-zoomed', theme);
    await wholeRun.click();
    await expect(wholeRun).toBeDisabled();

    // 4. A running run: the open step ends at now and grows.
    await page.getByRole('link', { name: '← All workflows' }).click();
    await openRun(runs, 'deploymentWorkflow');
    timeline = await openTimeline(page);
    await expect(page.getByTestId('timeline-now')).toBeVisible();
    const open = timeline.locator('[data-open="true"]').last();
    await expect(open).toBeVisible();
    const label = async () => (await open.getAttribute('aria-label')) ?? '';
    const before = await label();
    await expect.poll(label, { timeout: 15_000 }).not.toBe(before);
    await shot(page, 'timeline-05-running', theme);

    // 5. A loop: rounds grouped, the latest open, others collapsed.
    await page.getByRole('link', { name: '← All workflows' }).click();
    await openRun(runs, 'draftReviewWorkflow');
    timeline = await openTimeline(page);
    const round1 = page.getByTestId('timeline-round-draft-review/1');
    const toggle = round1.getByRole('button', { name: /Round 1 of 5/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page
        .getByTestId('timeline-round-draft-review/4')
        .getByRole('button', { name: /Round 4 of 5/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    await shot(page, 'timeline-06-loop', theme);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await shot(page, 'timeline-07-loop-expanded', theme);

    expect(errors).toEqual([]);
  });
}
