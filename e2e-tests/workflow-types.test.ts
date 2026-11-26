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
 * The Workflows tab of the Temporal page: one row for each TemporalWorkflow
 * entity of the example catalog (examples/entities.yaml), with the numbers
 * of its runs, in the light and the dark theme.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

function sidebarLink(page: Page) {
  return page
    .getByRole('link', { name: 'Temporal', exact: true })
    .and(page.locator(':not([href*="/catalog/"])'))
    .first();
}

async function signIn(page: Page, theme: string) {
  // The browser reports a ResizeObserver loop when the table gets a column
  // while the menu is open. The notice is harmless, but the development
  // server shows it in an overlay that takes every click.
  await page.addInitScript(() => {
    window.addEventListener('error', event => {
      if (event.message?.includes('ResizeObserver loop')) {
        event.stopImmediatePropagation();
      }
    });
  });
  if (theme === 'dark') {
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
  await expect(sidebarLink(page)).toBeVisible({ timeout: 120_000 });
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

for (const theme of ['light', 'dark']) {
  test(`the Workflows tab lists the workflow types with their numbers (${theme})`, async ({
    page,
  }) => {
    await signIn(page, theme);
    await sidebarLink(page).click();
    await expect(page.locator('body')).toHaveAttribute(
      'data-theme-mode',
      theme,
    );
    // The Workflows tab is the default.
    await expect(
      page.getByRole('tab', { name: 'Workflows', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    const workflows = table(page, 'Workflows');
    const payment = workflows
      .getByRole('row')
      .filter({ hasText: 'Example payment workflow' });
    await expect(payment).toHaveCount(1, { timeout: 60_000 });
    // The example payment workflow fails: the third number is not 0.
    await expect(payment.getByTestId('overview-counts')).toHaveText(
      /^\d+ \/ \d+ \/ [1-9]\d*$/,
      { timeout: 60_000 },
    );
    await expect(payment.getByRole('link', { name: 'guests' })).toBeVisible();
    await expect(payment).toContainText('Failed');
    const order = workflows
      .getByRole('row')
      .filter({ hasText: 'Example order workflow' });
    await expect(order.getByTestId('overview-counts')).toHaveText(
      /^\d+ \/ [1-9]\d* \/ \d+$/,
    );
    await expect(page.getByTestId('overview-updated')).toContainText('Updated');
    await shot(page, `overview-01-workflows-tab-${theme}`);

    // The optional columns.
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Lifecycle' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(
      workflows.getByRole('columnheader', { name: 'Lifecycle' }),
    ).toBeVisible();
    await expect(payment).toContainText('experimental');
    await shot(page, `overview-02-columns-${theme}`);

    // A row opens its entity.
    await payment.getByText('Charges a card').click();
    await page.waitForURL(
      /\/catalog\/default\/temporalworkflow\/example-payment-workflow/,
    );

    // The Executions tab keeps the list of every run.
    await sidebarLink(page).click();
    await page.getByRole('tab', { name: 'Executions', exact: true }).click();
    await expect(table(page, 'Workflow executions')).toBeVisible();
    expect(page.url()).toContain('tab=executions');
  });
}
