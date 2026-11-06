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
 * Workflow lists keep their page, filters and page size when a workflow is
 * opened and the user comes back with the browser or the "All workflows"
 * link. Five rows per page, so the example workflows fill two pages.
 */

// A short window, so the list scrolls and the scroll position is checked.
test.use({ viewport: { width: 1440, height: 520 } });

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
  // Signed in once the app shows its sidebar.
  await expect(
    page.getByRole('link', { name: 'Workflows', exact: true }).first(),
  ).toBeVisible({ timeout: 120_000 });
}

/**
 * Workflow IDs of the rows, in order: the links of the "Workflow ID"
 * column. Other links (the entity of a run) are left out, and IDs need
 * not follow a pattern (Zigflow runs have generated IDs).
 */
async function rowIds(page: Page, name: string): Promise<string[]> {
  const list = table(page, name);
  await expect(list.getByRole('link').first()).toBeVisible();
  await expect(list).not.toHaveAttribute('aria-busy', 'true');
  return list.getByRole('row').evaluateAll(rows => {
    const [head, ...body] = rows;
    const column = [...head.querySelectorAll('th, [role="columnheader"]')]
      .map(cell => cell.textContent?.trim())
      .indexOf('Workflow ID');
    return body
      .map(row => {
        const cells = row.querySelectorAll('td, [role="gridcell"]');
        return cells[column]?.querySelector('a')?.textContent?.trim() ?? '';
      })
      .filter(id => id !== '');
  });
}

async function checkList(page: Page, name: string, listUrl: string) {
  await page.goto(listUrl);
  const list = table(page, name);
  await expect(list.getByRole('link').first()).toBeVisible({
    timeout: 120_000,
  });
  const first = await rowIds(page, name);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('list-page')).toHaveText('Page 2');
  await expect.poll(() => rowIds(page, name)).not.toEqual(first);
  const second = await rowIds(page, name);
  expect(second.length).toBeGreaterThan(0);
  const url = page.url();
  expect(url).toContain('page=2');
  expect(url).toContain('pageSize=5');
  expect(url).toContain('allRuns=true');

  // Open a workflow from the list, come back with the browser: same page,
  // same rows, same scroll position.
  const pager = page.getByRole('button', { name: 'Next page' });
  const row = list.getByRole('link', { name: second[0], exact: true }).first();
  await pager.scrollIntoViewIfNeeded();
  await row.scrollIntoViewIfNeeded();
  const before = (await pager.boundingBox())!.y;
  const scrolled = await page.evaluate(() => {
    let max = window.scrollY;
    for (const e of document.querySelectorAll('*')) {
      max = Math.max(max, (e as HTMLElement).scrollTop);
    }
    return max;
  });
  expect(scrolled).toBeGreaterThan(0);
  await row.click();
  await expect(page.getByTestId('workflow-graph')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('list-page')).toHaveText('Page 2');
  await expect.poll(() => rowIds(page, name)).toEqual(second);
  expect(page.url()).toBe(url);
  await expect(
    page.getByRole('switch', { name: 'Show all runs' }),
  ).toBeChecked();
  await expect
    .poll(async () => Math.abs((await pager.boundingBox())!.y - before))
    .toBeLessThanOrEqual(30);

  // Open it again, come back with the "All workflows" link.
  await list
    .getByRole('link', { name: second[0], exact: true })
    .first()
    .click();
  await expect(page.getByTestId('workflow-graph')).toBeVisible();
  await page.getByTestId('back-to-list').click();
  await expect(page.getByTestId('list-page')).toHaveText('Page 2');
  await expect.poll(() => rowIds(page, name)).toEqual(second);
  expect(page.url()).toBe(url);
  await expect(page.getByTestId('list-lost-page')).toHaveCount(0);
  return second;
}

test('the Workflows page comes back to the same page', async ({ page }) => {
  await signIn(page);
  await checkList(
    page,
    'Workflow executions',
    '/temporal?allRuns=true&pageSize=5',
  );
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({
    path: join(shotDir, 'list-01-workflows-page-2.png'),
    fullPage: true,
  });
});

test('the Temporal tab comes back to the same page', async ({ page }) => {
  await signIn(page);
  await checkList(
    page,
    'Workflow executions',
    '/catalog/default/component/example-orders/temporal?allRuns=true&pageSize=5',
  );
});
