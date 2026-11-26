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
 * Exercises the workflow views under TEMPORAL_E2E_POLICY=no-read, where
 * both `temporal.workflow.read` (entity-scoped) and `temporal.workflow.list`
 * (standalone Temporal page) are denied while the catalog stays readable:
 * - the entity's Temporal tab shows an error instead of its runs;
 * - the Temporal page shows an error instead of the runs of the namespace;
 * - the details page of a run opened by its URL shows an error, without its
 *   steps, inputs or results.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

test.skip(
  process.env.TEMPORAL_E2E_POLICY !== 'no-read',
  'TEMPORAL_E2E_POLICY is not set to no-read',
);

function entityTab(page: Page, name: string) {
  return page
    .getByRole('tab', { name, exact: true })
    .or(page.getByRole('link', { name, exact: true }))
    .first();
}

function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }));
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
}

function watchErrors(page: Page) {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const forbidden: string[] = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
    if (
      response.status() === 403 &&
      response.url().includes('/api/temporal/')
    ) {
      forbidden.push(response.url());
    }
  });
  return { pageErrors, serverErrors, forbidden };
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({
    path: join(shotDir, `${name}.png`),
    fullPage: true,
  });
}

test('shows no workflows when the read and list permissions are denied', async ({
  page,
}) => {
  const { pageErrors, serverErrors, forbidden } = watchErrors(page);
  await signIn(page);

  // 1. Entity Temporal tab (temporal.workflow.read denied).
  const entityLink = page.getByRole('link', {
    name: /example-orders|Example orders service/,
  });
  await expect(entityLink.first()).toBeVisible({ timeout: 120_000 });
  await entityLink.first().click();
  await entityTab(page, 'Temporal').click();
  await expect(page.getByTestId('temporal-error').first()).toBeVisible();
  await expect(table(page, 'Workflow executions')).toHaveCount(0);
  await expect(page.getByText('paymentWorkflow')).toHaveCount(0);
  await shot(page, 'no-read-01-entity-tab');

  // 2. Standalone Temporal page (temporal.workflow.list denied).
  await page.goto('/temporal');
  await expect(page.getByTestId('temporal-error').first()).toBeVisible();
  await expect(table(page, 'Workflow executions')).toHaveCount(0);
  await shot(page, 'no-read-02-workflows-page');

  // 3. The details page of a run opened by its URL: refused before the
  // workflow is read, so the answer does not depend on whether it exists.
  await page.goto(
    '/temporal/namespaces/default/workflows/example-payment-any/runs/any-run',
  );
  await expect(page.getByTestId('temporal-error').first()).toBeVisible();
  await expect(page.getByTestId('workflow-graph')).toHaveCount(0);
  await expect(page.getByTestId('step-input')).toHaveCount(0);
  await shot(page, 'no-read-03-run');

  expect(forbidden.length).toBeGreaterThan(0);
  expect(serverErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
