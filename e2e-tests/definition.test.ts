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
 * The Definition tab of TemporalWorkflow entities: the YAML of
 * examples/workflows/order-fulfillment.yaml next to its graph, selection
 * in both directions, links for a workflow written in code, and (with
 * SMOKE_ZIGFLOW, when Zigflow ran the example) a run on top of the graph.
 * Screenshots in the light and the dark theme.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, theme: string) {
  if (theme === 'dark') {
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
  await expect(
    page.getByRole('link', { name: 'Workflows', exact: true }).first(),
  ).toBeVisible({ timeout: 120_000 });
}

async function openDefinition(page: Page, name: string) {
  await page.goto(`/catalog/default/temporalworkflow/${name}`);
  await page
    .getByRole('tab', { name: 'Definition', exact: true })
    .or(page.getByRole('link', { name: 'Definition', exact: true }))
    .first()
    .click();
}

/**
 * A line of the YAML, scrolled into the editor first: CodeMirror renders only
 * the lines near the visible part.
 */
async function yamlLine(page: Page, line: number) {
  const yaml = page.getByTestId('definition-yaml');
  await yaml.locator('.cm-scroller').evaluate((scroller, n) => {
    const lineHeight = parseFloat(getComputedStyle(scroller).lineHeight) || 20;
    scroller.scrollTop = Math.max(0, (n - 5) * lineHeight);
  }, line);
  const element = yaml.locator(`[data-line="${line}"]`);
  await element.waitFor();
  return element;
}

/** True when the whole box is inside the area of the graph. */
async function insideGraph(page: Page, box: Locator) {
  const area = await page.getByTestId('definition-graph').boundingBox();
  const rect = await box.boundingBox();
  if (!area || !rect) return false;
  return (
    rect.x >= area.x - 1 &&
    rect.y >= area.y - 1 &&
    rect.x + rect.width <= area.x + area.width + 1 &&
    rect.y + rect.height <= area.y + area.height + 1
  );
}

/** Font size of the smallest text in the graph, on screen. */
async function smallestGraphText(page: Page) {
  return page.getByTestId('definition-graph').evaluate(graph => {
    const viewport = graph.querySelector<HTMLElement>('.react-flow__viewport');
    const zoom = viewport
      ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
      : 1;
    let smallest = Infinity;
    for (const element of graph.querySelectorAll<HTMLElement>(
      '.react-flow__node span',
    )) {
      if (!element.textContent?.trim()) continue;
      smallest = Math.min(
        smallest,
        parseFloat(getComputedStyle(element).fontSize) * zoom,
      );
    }
    return smallest;
  });
}

for (const theme of ['light', 'dark']) {
  test(`definition: YAML and graph select each other (${theme})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await signIn(page, theme);
    await openDefinition(page, 'example-yaml-order-workflow');
    const yaml = page.getByTestId('definition-yaml');
    await expect(yaml).toContainText('workflowType: order-fulfillment', {
      timeout: 60_000,
    });
    const graph = page.getByTestId('definition-graph');
    await expect(graph).toBeVisible();
    for (const box of [
      '/do/0/validate',
      '/do/1/packItems',
      '/do/2/checks',
      '/do/2/checks#join',
      '/do/3/waitForPayment',
      '/do/4/charge',
      '/do/4/charge#catch',
      '/do/5/cooldown',
      '/do/6/notify',
      '/do/7/route',
    ]) {
      await expect(page.getByTestId(`definition-node-${box}`)).toBeVisible();
    }
    // The view settles after the graph is laid out for the width of its area.
    await expect.poll(() => smallestGraphText(page)).toBeGreaterThanOrEqual(12);
    await shot(page, `${theme}-definition-01-overview`);

    // A box marks its lines in the YAML and scrolls to them.
    await page.getByTestId('definition-node-/do/4/charge').click();
    const band = page.getByTestId('definition-yaml-band');
    await expect(band).toHaveAttribute('data-start', '78');
    await expect(band).toBeInViewport();
    // The band is the line itself; it lines up with its number in the gutter
    // and covers the lines of the task (78–96) and nothing else.
    const bandBox = await band.boundingBox();
    const numberBox = await yaml
      .locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^78$/ })
      .boundingBox();
    expect(bandBox).not.toBeNull();
    expect(numberBox).not.toBeNull();
    expect(Math.abs(numberBox!.y - bandBox!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(numberBox!.height - bandBox!.height)).toBeLessThanOrEqual(
      1,
    );
    await expect(yaml.locator('.cm-line.tp-yaml-band')).toHaveCount(19);
    // The band has a color in both themes (a missing token makes it clear).
    expect(
      await band.evaluate(e => getComputedStyle(e).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('definition-task')).toContainText('78–96');
    await shot(page, `${theme}-definition-02-box-selects-lines`);

    // A box whose first line is already visible does not scroll the YAML.
    const scroller = yaml.locator('.cm-scroller');
    const scrollTop = await scroller.evaluate(s => s.scrollTop);
    await page.getByTestId('definition-node-/do/5/cooldown').click();
    await expect(band).toHaveAttribute('data-start', '98');
    expect(await scroller.evaluate(s => s.scrollTop)).toBe(scrollTop);

    // A line of the YAML selects the innermost task around it.
    await (await yamlLine(page, 41)).click();
    await expect(
      page.getByTestId('definition-node-/do/1/packItems/do/0/pack'),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(band).toHaveAttribute('data-start', '38');
    await shot(page, `${theme}-definition-03-line-selects-box`);
    expect(errors).toEqual([]);
  });
}

test('definition: a workflow written in code links to its source', async ({
  page,
}) => {
  await signIn(page, 'light');
  await openDefinition(page, 'example-order-workflow');
  const card = page.getByTestId('definition-source-links');
  await expect(card).toBeVisible();
  await expect(card.getByRole('link', { name: /Source code/ })).toHaveAttribute(
    'href',
    /packages\/example-worker\/src\/$/,
  );
  await shot(page, 'light-definition-04-code-workflow');
});

test.describe('definition with a Zigflow run', () => {
  test.skip(!process.env.SMOKE_ZIGFLOW, 'SMOKE_ZIGFLOW is not set');

  for (const theme of ['light', 'dark']) {
    test(`marks the tasks of a run (${theme})`, async ({ page }) => {
      await signIn(page, theme);
      await openDefinition(page, 'example-yaml-order-workflow');
      await expect(page.getByTestId('definition-graph')).toBeVisible({
        timeout: 60_000,
      });
      // The completed express order.
      await page.getByRole('button', { name: /Show a run/ }).click();
      await page
        .getByRole('option', { name: /Completed · example-yaml-order-/ })
        .first()
        .click();
      await expect(page.getByRole('listbox')).toBeHidden();
      const node = (pointer: string) =>
        page.getByTestId(`definition-node-${pointer}`);
      await expect(node('/do/0/validate')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      await expect(node('/do/1/packItems/do/0/pack')).toContainText('3 times');
      await expect(node('/do/2/checks/fork/branches/0/fraud')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      await expect(node('/do/3/waitForPayment')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      await expect(node('/do/4/charge/try/0/chargeCard')).toHaveAttribute(
        'data-mark',
        'Failed',
      );
      await expect(node('/do/4/charge/catch/do/0/refund')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      await expect(node('/do/8/expressShipping')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      await expect(node('/do/5/cooldown')).not.toHaveAttribute('data-mark');
      await expect(page.getByTestId('definition-legend')).toBeVisible();
      await shot(page, `${theme}-definition-05-run-completed`);

      // The unpaid order: failed while it waited for the payment.
      await page.getByRole('button', { name: /Show a run/ }).click();
      await page
        .getByRole('option', { name: /Failed · example-yaml-unpaid-/ })
        .first()
        .click();
      await expect(page.getByRole('listbox')).toBeHidden();
      await expect(node('/do/3/waitForPayment')).toHaveAttribute(
        'data-mark',
        'NotReached',
      );
      await expect(node('/do/4/charge/try/0/chargeCard')).toHaveAttribute(
        'data-mark',
        'NotReached',
      );
      await expect(node('/do/0/validate')).toHaveAttribute(
        'data-mark',
        'Completed',
      );
      // The line of chargeCard moves the graph to its box.
      await (await yamlLine(page, 82)).click();
      await expect(node('/do/4/charge/try/0/chargeCard')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // The graph pans to the box (an animation of 200 ms): the box ends up
      // inside the graph area. The area itself may be below the fold of the
      // window, so the window viewport is not checked.
      await expect
        .poll(() => insideGraph(page, node('/do/4/charge/try/0/chargeCard')))
        .toBe(true);
      await page.getByTestId('definition-graph').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('definition-task')).toContainText(
        'Not reached',
      );
      await shot(page, `${theme}-definition-06-run-failed`);
    });
  }
});
