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
 * The Temporal page: the Workflow ID and Run ID columns, and the workflow
 * type as a link to the TemporalWorkflow entity of the example catalog
 * (examples/entities.yaml), in the list and on the details of a run.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);
const paymentEntity =
  '/catalog/default/temporalworkflow/example-payment-workflow';

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
  await expect(
    page
      .getByRole('link', { name: 'Temporal', exact: true })
      .and(page.locator(':not([href*="/catalog/"])'))
      .first(),
  ).toBeVisible({ timeout: 120_000 });
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

/** The page is not wider than the window: no horizontal scroll bar. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return (
      Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the Temporal page lists the run ID and links the workflow type', async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole('link', { name: 'Temporal', exact: true })
    .and(page.locator(':not([href*="/catalog/"])'))
    .first()
    .click();
  await openExecutionsTab(page);
  await page
    .getByRole('textbox', { name: 'Workflow ID starts with' })
    .fill('example-payment-');
  await page.getByRole('button', { name: 'Search' }).click();
  const list = table(page, 'Workflow executions');
  const row = list
    .getByRole('row')
    .filter({ hasText: 'paymentWorkflow' })
    .first();
  await expect(row).toBeVisible();

  // The columns follow the Temporal UI: Workflow ID, Run ID, then the type.
  await expect(list.getByRole('columnheader')).toContainText([
    'Status',
    'Workflow ID',
    'Run ID',
    'Workflow type',
  ]);
  const runLink = row.getByTestId('run-id');
  const runId = await runLink.getAttribute('title');
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(runLink).toHaveText(runId!.slice(0, 8));
  // Both links open the details of the run.
  const open = await row.getByRole('link').first().getAttribute('href');
  await expect(runLink).toHaveAttribute('href', open!);
  expect(open).toContain(`/runs/${runId}`);

  // The catalog of the example app has an entity for this workflow type
  // and task queue, so the type is a link.
  await expect(
    row.getByRole('link', { name: 'paymentWorkflow' }),
  ).toHaveAttribute('href', paymentEntity);

  await shot(page, 'list-02-workflows-page-run-id');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'list-03-workflows-page-run-id-narrow');
  await page.setViewportSize({ width: 1440, height: 900 });

  // The details of the run link the type too, with no entity opened.
  await runLink.click();
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(
    page.getByRole('link', { name: 'paymentWorkflow', exact: true }),
  ).toHaveAttribute('href', paymentEntity);
});

/** The Executions tab of the Temporal page; the Workflows tab is the default. */
async function openExecutionsTab(page: Page) {
  await page.getByRole('tab', { name: 'Executions', exact: true }).click();
}
