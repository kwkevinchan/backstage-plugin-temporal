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
 * Exercises the workflow views under TEMPORAL_E2E_POLICY=no-history, where
 * both `temporal.workflow.history.read` (entity-scoped) and
 * `temporal.workflow.history.list` (standalone Workflows page) are denied:
 * - step inputs and results are hidden from the step drawer;
 * - the Raw history toggle in the Events tab is disabled (Grouped remains);
 * - failure views show only the outermost failure message with the notice that
 *   stack trace and causes require history permission.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

test.skip(
  process.env.TEMPORAL_E2E_POLICY !== 'no-history',
  'TEMPORAL_E2E_POLICY is not set to no-history',
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
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

function step(page: Page, name: RegExp) {
  return page.getByTestId('workflow-graph').getByRole('button', { name });
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(/\/catalog|\/$/);
}

async function openRun(runs: ReturnType<typeof table>, workflowType: string) {
  const row = runs.getByRole('row').filter({ hasText: workflowType }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByRole('link').first().click();
}

function watchErrors(page: Page) {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  return { pageErrors, serverErrors };
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({
    path: join(shotDir, `${name}.png`),
    fullPage: true,
  });
}

async function verifyPaymentWithoutHistory(page: Page, withShots: boolean) {
  await expect(page.getByTestId('workflow-graph')).toBeVisible();
  await expect(page.getByTestId('workflow-current')).toContainText(
    'Failed at chargeCard',
  );

  await step(page, /^chargeCard, Failed/).click();
  const drawer = page.getByTestId('step-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('step-input')).toHaveCount(0);
  await expect(drawer.getByTestId('step-output')).toHaveCount(0);
  await expect(drawer).toContainText(
    'Inputs and results are hidden: they need the permission to read the event history.',
  );
  await expect(drawer).not.toContainText('cardLast4');

  const stepError = drawer.getByTestId('step-error');
  await expect(stepError).toContainText('Card ending 4242 was declined');
  await expect(stepError.getByTestId('failure-level')).toHaveCount(1);
  await expect(stepError).not.toContainText('Caused by');
  await expect(stepError.getByText('Stack trace', { exact: true })).toHaveCount(
    0,
  );
  await expect(stepError.getByTestId('failure-details-hidden')).toContainText(
    'The stack trace and the causes are hidden: they need the permission to read the event history.',
  );
  if (withShots) await shot(page, 'no-history-01-failed-step');

  await page.getByRole('button', { name: 'Close step details' }).click();

  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByTestId('grouped-events')).toContainText('chargeCard');
  await expect(page.getByRole('radio', { name: 'Raw' })).toBeDisabled();
  if (withShots) await shot(page, 'no-history-02-events-raw-disabled');

  await page.getByRole('tab', { name: 'Details' }).click();
  const detailsPanel = page.getByRole('tabpanel', { name: 'Details' });
  await expect(detailsPanel.getByTestId('failure-level')).toHaveCount(1);
  await expect(detailsPanel).toContainText('could not be completed');
  await expect(detailsPanel).not.toContainText('Caused by');
  await expect(detailsPanel).not.toContainText('Activity task failed');
  await expect(
    detailsPanel.getByText('Stack trace', { exact: true }),
  ).toHaveCount(0);
  await expect(
    detailsPanel.getByTestId('failure-details-hidden'),
  ).toContainText(
    'The stack trace and the causes are hidden: they need the permission to read the event history.',
  );
  if (withShots) await shot(page, 'no-history-03-details-failure');
}

test('hides inputs, results, raw history, stack traces and causes when history permissions are denied', async ({
  page,
}) => {
  const { pageErrors, serverErrors } = watchErrors(page);
  await signIn(page);

  // 1. Entity Temporal tab (temporal.workflow.history.read denied).
  const entityLink = page.getByRole('link', {
    name: /example-orders|Example orders service/,
  });
  await expect(entityLink.first()).toBeVisible({ timeout: 120_000 });
  await entityLink.first().click();
  await entityTab(page, 'Temporal').click();

  const runs = table(page, 'Workflow executions');
  await expect(runs).toBeVisible();
  await openRun(runs, 'paymentWorkflow');
  await verifyPaymentWithoutHistory(page, true);

  // Completed run: neither activity nor workflow end exposes input or result.
  await page.getByRole('link', { name: '← Workflow executions' }).click();
  await expect(runs).toBeVisible();
  await openRun(runs, 'orderWorkflow');
  await expect(page.getByTestId('workflow-graph')).toBeVisible();

  await step(page, /^reserveStock, Completed/).click();
  const drawer = page.getByTestId('step-drawer');
  await expect(drawer.getByTestId('step-input')).toHaveCount(0);
  await expect(drawer.getByTestId('step-output')).toHaveCount(0);
  await expect(drawer).toContainText('Inputs and results are hidden');
  await expect(drawer).not.toContainText('BOOK-1');

  await step(page, /^End, Completed/).click();
  await expect(drawer.getByTestId('step-output')).toHaveCount(0);
  await expect(drawer).toContainText('Inputs and results are hidden');
  await expect(drawer).not.toContainText('confirmed');

  // 2. Standalone Workflows page (temporal.workflow.history.list denied).
  await page.goto('/temporal?workflowType=paymentWorkflow');
  const standaloneRuns = table(page, 'Workflow executions');
  await expect(standaloneRuns).toBeVisible();
  await openRun(standaloneRuns, 'paymentWorkflow');
  await verifyPaymentWithoutHistory(page, false);

  expect(serverErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
