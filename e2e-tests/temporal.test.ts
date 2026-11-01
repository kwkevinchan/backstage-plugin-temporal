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

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

/**
 * Console errors that are expected:
 * - the app probes for an existing session before sign-in, and the browser
 *   logs the 401 of that probe;
 * - React development warnings (logged with console.error) from upstream
 *   Backstage components. Warnings whose component stack points into this
 *   repository's plugins still fail the test.
 */
function isIgnoredConsoleError(text: string): boolean {
  if (
    /Failed to load resource: the server responded with a status of 401/.test(
      text,
    )
  ) {
    return true;
  }
  const fromOurCode = /plugins\/temporal|backstage-plugin-temporal/.test(text);
  return text.startsWith('Warning: ') && !fromOurCode;
}

/**
 * An entity page tab. In Backstage 1.56 the new frontend system renders the
 * entity tabs as links in the page header; the legacy system keeps tabs.
 */
function entityTab(page: Page, name: string) {
  return page
    .getByRole('tab', { name, exact: true })
    .or(page.getByRole('link', { name, exact: true }))
    .first();
}

function watchPage(page: Page) {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isIgnoredConsoleError(text)) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error}`));
  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  return { consoleErrors, serverErrors };
}

test('sign in, open the Temporal tab and a workflow', async ({ page }) => {
  mkdirSync(shotDir, { recursive: true });
  const watched = watchPage(page);
  // Takes a screenshot and fails fast on errors seen so far.
  const shot = async (name: string) => {
    await page.screenshot({
      path: join(shotDir, `${name}.png`),
      fullPage: true,
    });
    expect(watched.serverErrors, `backend 5xx responses (${name})`).toEqual([]);
    expect(watched.consoleErrors, `browser console errors (${name})`).toEqual(
      [],
    );
  };

  // 1. Start page with the sign-in card.
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeVisible();
  await shot('01-sign-in');

  // 2. Guest sign-in lands on the catalog.
  await enter.click();
  await page.waitForURL(/\/catalog|\/$/);
  const catalogPath = new URL(page.url()).pathname;
  const entityLink = page.getByRole('link', {
    name: /example-orders|Example orders service/,
  });
  // The catalog may still be reading the example entities.
  await expect(entityLink.first()).toBeVisible({ timeout: 120_000 });
  await shot('02-catalog');

  // 3. Entity page.
  await entityLink.first().click();
  const temporalTab = entityTab(page, 'Temporal');
  await expect(temporalTab).toBeVisible();
  await shot('03-entity');

  // 4. Temporal tab with the workflow list.
  await temporalTab.click();
  await expect(page.getByText('Temporal workflows')).toBeVisible();
  const table = page.getByRole('table', { name: 'Workflows', exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByText('Failed').first()).toBeVisible();
  await shot('04-temporal-tab');

  // 5. Details of a failed workflow: failure with cause chain and history.
  await table
    .getByRole('row')
    .filter({ hasText: 'paymentWorkflow' })
    .first()
    .getByRole('link')
    .click();
  await expect(page.getByText('Summary')).toBeVisible();
  await expect(page.getByText('Caused by').first()).toBeVisible();
  await expect(
    page.getByText('Card ending 4242 was declined', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy workflow ID' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open in Temporal UI/ }),
  ).toBeVisible();
  // Inputs and outputs: workflow input, and each activity's input and failure.
  const activities = page.getByRole('table', {
    name: 'Activities',
    exact: true,
  });
  await expect(
    activities.getByText('chargeCard', { exact: true }),
  ).toBeVisible();
  await expect(activities).toContainText('cardLast4');
  await expect(page.getByTestId('workflow-input')).toContainText('paymentId');
  const history = page.getByRole('table', { name: 'Event history' });
  await expect(history.getByText('WorkflowExecutionStarted')).toBeVisible();
  await shot('05-workflow-failed');
  await activities.scrollIntoViewIfNeeded();
  await shot('06-workflow-failed-inputs-outputs');

  // 6. Details of a running workflow with a pending activity.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await expect(table).toBeVisible();
  await table
    .getByRole('row')
    .filter({ hasText: 'deploymentWorkflow' })
    .first()
    .getByRole('link')
    .click();
  await expect(page.getByText('Pending activities')).toBeVisible();
  await expect(page.getByText('waitForUpstream').first()).toBeVisible();
  // A completed activity shows its result.
  await expect(
    page.getByRole('table', { name: 'Activities', exact: true }),
  ).toContainText('staging');
  await shot('07-workflow-running');

  // 8. The tab does not depend on the kind: a Resource with the annotations.
  await page.goto('/catalog/default/resource/example-order-jobs');
  await entityTab(page, 'Temporal').click();
  const resourceTable = page.getByRole('table', {
    name: 'Workflows',
    exact: true,
  });
  await expect(resourceTable.getByText('orderWorkflow').first()).toBeVisible();
  await expect(resourceTable).not.toContainText('paymentWorkflow');
  await shot('08-resource-temporal-tab');

  // 9. Catalog, kind picker set to TemporalWorkflow, then a workflow entity.
  await page.goto(catalogPath);
  await page.getByRole('button', { name: 'Component', exact: true }).click();
  await page.getByRole('option', { name: 'TemporalWorkflow' }).click();
  const workflowLink = page.getByRole('link', {
    name: /Example order workflow|example-order-workflow/,
  });
  await expect(workflowLink.first()).toBeVisible();
  await shot('09-catalog-temporal-workflows');
  await workflowLink.first().click();
  await expect(
    page.getByText('Temporal workflow', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('orderWorkflow').first()).toBeVisible();
  await shot('10-temporal-workflow-entity');

  // 10. Its Temporal tab: summary, recent run statistics and the runs.
  await entityTab(page, 'Temporal').click();
  await expect(page.getByText('Recent runs')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Succeeded' })).toBeVisible();
  const runs = page.getByRole('table', { name: 'Workflows', exact: true });
  await expect(runs.getByText('orderWorkflow').first()).toBeVisible();
  await expect(runs).not.toContainText('paymentWorkflow');
  await shot('11-temporal-workflow-runs');

  // 11. A run of the workflow entity.
  await runs.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page.getByText('Summary')).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Activities', exact: true }),
  ).toContainText('reserveStock');
  await shot('12-temporal-workflow-run');

  // 12. A component that depends on the workflow entities: the entities and
  // the merged runs (its own annotation and the two workflow entities).
  await page.goto('/catalog/default/component/example-checkout');
  await entityTab(page, 'Temporal').click();
  const workflowEntities = page.getByRole('table', {
    name: 'Workflow entities',
  });
  await expect(
    workflowEntities.getByRole('link', {
      name: /example-order-workflow|Example order workflow/,
    }),
  ).toBeVisible();
  await expect(
    workflowEntities.getByRole('link', {
      name: /example-payment-workflow|Example payment workflow/,
    }),
  ).toBeVisible();
  const merged = page.getByRole('table', { name: 'Workflows', exact: true });
  await expect(merged.getByText('deploymentWorkflow').first()).toBeVisible();
  await expect(merged.getByText('paymentWorkflow').first()).toBeVisible();
  await expect(merged.getByText('orderWorkflow').first()).toBeVisible();
  await shot('13-component-related-workflows');

  // 13. Workflows page from the sidebar: every workflow, then one of them.
  await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .click();
  const all = page.getByRole('table', { name: 'All workflows' });
  await expect(all.getByText('paymentWorkflow').first()).toBeVisible();
  await shot('14-workflows-page');
  await page
    .getByRole('textbox', { name: 'Workflow ID search' })
    .fill('example-payment-');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(all).not.toContainText('orderWorkflow');
  await all
    .getByRole('row')
    .filter({ hasText: 'paymentWorkflow' })
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(
    page.getByText('Card ending 4242 was declined', { exact: true }).first(),
  ).toBeVisible();
  await shot('15-workflows-page-detail');
});
