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

/**
 * A table. Tables of @backstage/ui are React Aria grids; tables of
 * Backstage core components are plain tables.
 */
function table(page: Page, name: string) {
  return page
    .getByRole('grid', { name, exact: true })
    .or(page.getByRole('table', { name, exact: true }))
    .first();
}

/** Signs in as the guest and waits for the catalog. */
async function signIn(page: Page) {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeVisible();
  await enter.click();
  await page.waitForURL(/\/catalog|\/$/);
}

/** A step box in the workflow graph. */
function step(page: Page, name: RegExp) {
  return page.getByTestId('workflow-graph').getByRole('button', { name });
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

function shooter(page: Page, watched: ReturnType<typeof watchPage>) {
  mkdirSync(shotDir, { recursive: true });
  // Takes a screenshot and fails fast on errors seen so far.
  return async (name: string) => {
    await page.screenshot({
      path: join(shotDir, `${name}.png`),
      fullPage: true,
    });
    expect(watched.serverErrors, `backend 5xx responses (${name})`).toEqual([]);
    expect(watched.consoleErrors, `browser console errors (${name})`).toEqual(
      [],
    );
  };
}

/**
 * Font sizes of the step boxes as drawn on screen: the CSS font size times
 * the zoom of the graph.
 */
async function drawnFontSizes(page: Page): Promise<number[]> {
  return page.getByTestId('workflow-graph').evaluate(graph => {
    const viewport = graph.querySelector('.react-flow__viewport');
    const transform = viewport ? getComputedStyle(viewport).transform : '';
    const scale =
      transform && transform !== 'none'
        ? new DOMMatrixReadOnly(transform).a
        : 1;
    const texts = graph.querySelectorAll('button span');
    return [...texts]
      .filter(t => t.textContent?.trim())
      .map(t => parseFloat(getComputedStyle(t).fontSize) * scale);
  });
}

/** True when the element is fully inside the graph area. */
async function insideGraph(page: Page, name: RegExp): Promise<boolean> {
  const graph = await page.getByTestId('workflow-graph').boundingBox();
  const box = await step(page, name).boundingBox();
  if (!graph || !box) return false;
  return (
    box.x >= graph.x - 1 &&
    box.y >= graph.y - 1 &&
    box.x + box.width <= graph.x + graph.width + 1 &&
    box.y + box.height <= graph.y + graph.height + 1
  );
}

/** Waits until the graph has stopped moving (pan and zoom animations). */
async function graphSettled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page
        .locator('.react-flow__viewport')
        .first()
        .evaluate(v => getComputedStyle(v).transform);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

/** Opens the run of a workflow type from a workflow list. */
async function openRun(list: ReturnType<typeof table>, workflowType: string) {
  await list
    .getByRole('row')
    .filter({ hasText: workflowType })
    .first()
    .getByRole('link')
    .first()
    .click();
}

test('sign in, open the Temporal tab and the step graph of workflows', async ({
  page,
}) => {
  const watched = watchPage(page);
  const shot = shooter(page, watched);

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

  // 4. Temporal tab with the workflow list and the progress of each run.
  await temporalTab.click();
  await expect(
    page.getByRole('heading', { name: 'Temporal workflows' }),
  ).toBeVisible();
  const runs = table(page, 'Workflows');
  await expect(runs).toBeVisible();
  await expect(runs.getByText('Failed').first()).toBeVisible();
  await expect(
    runs
      .getByRole('row')
      .filter({ hasText: 'paymentWorkflow' })
      .first()
      .getByTestId('workflow-progress'),
  ).toContainText('Failed at chargeCard');
  await shot('04-temporal-tab');

  // 5. A failed workflow: the graph, then the failed step with its input
  // and error in the panel.
  await openRun(runs, 'paymentWorkflow');
  await expect(page.getByTestId('workflow-graph')).toBeVisible();
  await expect(page.getByTestId('workflow-current')).toHaveText(
    'Failed at chargeCard',
  );
  await expect(
    page.getByRole('button', { name: 'Copy workflow ID' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open in Temporal UI/ }),
  ).toBeVisible();
  await shot('05-workflow-failed-graph');
  await step(page, /^chargeCard, Failed/).click();
  const drawer = page.getByTestId('step-drawer');
  await expect(drawer.getByTestId('step-input')).toContainText('cardLast4');
  await expect(drawer.getByTestId('step-error')).toContainText(
    'Card ending 4242 was declined',
  );
  await shot('06-workflow-failed-step');

  // 6. Events, grouped by step, then the raw history.
  await page.getByRole('tab', { name: 'Events' }).click();
  const grouped = page.getByTestId('grouped-events');
  await expect(grouped).toContainText('chargeCard');
  await expect(grouped).toContainText('ActivityTaskScheduled');
  await grouped.scrollIntoViewIfNeeded();
  await shot('07-workflow-events-grouped');
  await page.getByRole('radio', { name: 'Raw' }).click();
  await expect(
    table(page, 'Event history').getByText('WorkflowExecutionStarted'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByText('Caused by').first()).toBeVisible();

  // 7. A running workflow with a retrying activity.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await expect(runs).toBeVisible();
  await openRun(runs, 'deploymentWorkflow');
  await expect(
    step(page, /^waitForUpstream, (Retrying|Running)/),
  ).toBeVisible();
  await expect(page.getByTestId('workflow-current')).toContainText(
    'waitForUpstream',
  );
  await expect(
    page.getByRole('switch', { name: 'Auto refresh' }),
  ).toBeChecked();
  await shot('08-workflow-running');

  // 8. Parallel steps, retries, a timer and a child workflow.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await openRun(runs, 'fulfillmentWorkflow');
  await expect(step(page, /^pickItems, Completed/)).toBeVisible();
  await expect(step(page, /^printLabel, Completed/)).toBeVisible();
  await expect(step(page, /^bookCourier, Completed, attempt 3/)).toBeVisible();
  await expect(step(page, /^Timer 2s, Completed/)).toBeVisible();
  await shot('09-workflow-fulfillment');
  await step(page, /^notifyCustomerWorkflow, Completed/).click();
  await page.getByTestId('step-drawer').getByRole('link').first().click();
  await expect(page.getByTestId('workflow-summary')).toContainText(
    'notifyCustomerWorkflow',
  );
  await shot('10-child-workflow');

  // 9. A workflow that waits for approval.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await openRun(runs, 'approvalWorkflow');
  // The wait has a time limit: the hint comes first, the timer is the
  // time limit, in words and not as a UTC timestamp.
  const current = page.getByTestId('workflow-current');
  await expect(current).toContainText('Waiting for approval');
  await expect(current).toContainText(/times out in 23h \d+m/);
  await expect(current).not.toContainText(/Timer fires at|\d{4}-\d\d-\d\dT/);
  await expect(step(page, /^comment, Completed/)).toBeVisible();
  // The timer box is titled with the wait and says when it times out.
  await expect(step(page, /^Waiting for approval, Waiting/)).toContainText(
    /Times out in 23h \d+m/,
  );
  await graphSettled(page);
  await shot('11-workflow-waiting');

  // 10. A long run: twelve stages with a patch marker before each one. It
  // opens at a readable size from its first step, without the markers.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await openRun(runs, 'pipelineWorkflow');
  await expect(step(page, /^notifyTeam, Completed/)).toBeVisible();
  await graphSettled(page);
  expect(await insideGraph(page, /^Start, Completed/)).toBe(true);
  // Start, twelve stages and the end; no markers.
  await expect(
    page.getByTestId('workflow-graph').locator('.react-flow__node'),
  ).toHaveCount(14);
  for (const size of await drawnFontSizes(page)) {
    expect(size).toBeGreaterThanOrEqual(12);
  }
  await shot('20-long-workflow');
  // The panel opens without shrinking the graph; the step stays in view.
  await step(page, /^notifyTeam, Completed/).click();
  await expect(page.getByTestId('step-drawer')).toContainText('notifyTeam');
  await graphSettled(page);
  for (const size of await drawnFontSizes(page)) {
    expect(size).toBeGreaterThanOrEqual(12);
  }
  expect(await insideGraph(page, /^notifyTeam, Completed/)).toBe(true);
  await shot('21-long-workflow-panel');
  // "Whole graph" zooms out to every step; markers can be shown.
  await page.getByRole('button', { name: 'Whole graph' }).click();
  await graphSettled(page);
  expect(await insideGraph(page, /^Start, Completed/)).toBe(true);
  expect(await insideGraph(page, /^End, Completed/)).toBe(true);
  await page.getByRole('button', { name: 'Close step details' }).click();
  await page.getByText('Show markers', { exact: true }).click();
  await expect(step(page, /^core_patch, Completed/).first()).toBeVisible();
  await graphSettled(page);
  await shot('22-long-workflow-markers');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByTestId('grouped-events')).toContainText('core_patch');

  // 11. The tab does not depend on the kind: a Resource with the annotations.
  await page.goto('/catalog/default/resource/example-order-jobs');
  await entityTab(page, 'Temporal').click();
  const resourceTable = table(page, 'Workflows');
  await expect(resourceTable.getByText('orderWorkflow').first()).toBeVisible();
  await expect(resourceTable).not.toContainText('paymentWorkflow');
  await shot('12-resource-temporal-tab');

  // 12. Catalog, kind picker set to TemporalWorkflow, then a workflow entity.
  await page.goto(catalogPath);
  await page.getByRole('button', { name: 'Component', exact: true }).click();
  await page.getByRole('option', { name: 'TemporalWorkflow' }).click();
  const workflowLink = page.getByRole('link', {
    name: /Example order workflow|example-order-workflow/,
  });
  await expect(workflowLink.first()).toBeVisible();
  await shot('13-catalog-temporal-workflows');
  await workflowLink.first().click();
  await expect(
    page.getByText('Temporal workflow', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('orderWorkflow').first()).toBeVisible();
  await shot('14-temporal-workflow-entity');

  // 13. Its Temporal tab: summary, recent run statistics and the runs.
  await entityTab(page, 'Temporal').click();
  await expect(
    page.getByRole('heading', { name: 'Recent runs' }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Succeeded' })).toBeVisible();
  const entityRuns = table(page, 'Workflows');
  await expect(entityRuns.getByText('orderWorkflow').first()).toBeVisible();
  await expect(entityRuns).not.toContainText('paymentWorkflow');
  await shot('15-temporal-workflow-runs');

  // 14. A run of the workflow entity.
  await openRun(entityRuns, 'orderWorkflow');
  await expect(step(page, /^reserveStock, Completed/)).toBeVisible();
  await shot('16-temporal-workflow-run');

  // 15. A component that depends on the workflow entities: the entities and
  // the merged runs (its own annotation and the two workflow entities).
  await page.goto('/catalog/default/component/example-checkout');
  await entityTab(page, 'Temporal').click();
  const workflowEntities = table(page, 'Workflow entities');
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
  const merged = table(page, 'Workflows');
  await expect(merged.getByText('deploymentWorkflow').first()).toBeVisible();
  await expect(merged.getByText('paymentWorkflow').first()).toBeVisible();
  await expect(merged.getByText('orderWorkflow').first()).toBeVisible();
  await shot('17-component-related-workflows');

  // 16. Workflows page from the sidebar: every workflow, then one of them,
  // with the shared workflow action.
  await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .click();
  const all = table(page, 'All workflows');
  await expect(all.getByText('paymentWorkflow').first()).toBeVisible();
  await expect(all.getByTestId('workflow-progress').first()).toBeVisible();
  await expectPageMargins(page, all);
  await shot('18-workflows-page');
  await page
    .getByRole('textbox', { name: 'Workflow ID starts with' })
    .fill('example-payment-');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(all).not.toContainText('orderWorkflow');
  await openRun(all, 'paymentWorkflow');
  await expect(page.getByTestId('workflow-current')).toHaveText(
    'Failed at chargeCard',
  );
  await expect(
    page.getByRole('button', { name: 'Copy workflow ID' }),
  ).toBeVisible();
  await step(page, /^chargeCard, Failed/).click();
  await expect(page.getByTestId('step-error')).toContainText(
    'Card ending 4242 was declined',
  );
  await expectPageMargins(page, page.getByTestId('workflow-summary'));
  await shot('19-workflows-page-detail');

  // 17. A workflow that continues as new is listed once, with its latest
  // run; the switch lists every run.
  await page.getByRole('link', { name: '← All workflows' }).click();
  await page
    .getByRole('textbox', { name: 'Workflow ID starts with' })
    .fill('example-poll-');
  await page.getByRole('button', { name: 'Search' }).click();
  const pollRows = all.getByRole('row').filter({ hasText: 'pollWorkflow' });
  await expect(pollRows).toHaveCount(1);
  await expect(pollRows.first()).toContainText('Completed');
  await shot('23-continue-as-new-latest');
  await page.getByText('Show all runs', { exact: true }).click();
  await expect(pollRows).toHaveCount(4);
  await expect(all.getByText('Continued as new').first()).toBeVisible();
  await shot('24-continue-as-new-all-runs');
  await page.getByText('Show all runs', { exact: true }).click();
  await expect(pollRows).toHaveCount(1);
  await openRun(all, 'pollWorkflow');
  const chain = page.getByTestId('workflow-run-chain');
  await expect(chain).toContainText('Run 4 of 4');
  await chain.getByRole('link', { name: /Previous run/ }).click();
  await expect(chain).toContainText('Run 3 of 4');
  await expect(chain.getByRole('link', { name: /Next run/ })).toBeVisible();
  await graphSettled(page);
  await shot('25-continue-as-new-run');
});

/**
 * The content of a page is not flush with the sidebar or the right edge of
 * the window.
 */
async function expectPageMargins(
  page: Page,
  content: ReturnType<Page['locator']>,
) {
  const sidebar = await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .boundingBox();
  const box = await content.boundingBox();
  const width = page.viewportSize()!.width;
  expect(sidebar).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x - (sidebar!.x + sidebar!.width)).toBeGreaterThanOrEqual(16);
  expect(width - (box!.x + box!.width)).toBeGreaterThanOrEqual(16);
}

test('shows the details page in the dark theme', async ({ page }) => {
  // The app theme API keeps the chosen theme in local storage.
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
  });
  const watched = watchPage(page);
  const shot = shooter(page, watched);
  await signIn(page);
  await page.goto('/catalog/default/component/example-orders');
  await entityTab(page, 'Temporal').click();
  await expect(page.locator('body')).toHaveAttribute('data-theme-mode', 'dark');
  const runs = table(page, 'Workflows');
  await expect(runs.getByText('paymentWorkflow').first()).toBeVisible();
  await shot('dark-01-temporal-tab');
  await openRun(runs, 'paymentWorkflow');
  await step(page, /^chargeCard, Failed/).click();
  await expect(page.getByTestId('step-error')).toContainText(
    'Card ending 4242 was declined',
  );
  await shot('dark-02-workflow-failed-step');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByTestId('grouped-events')).toContainText('chargeCard');
  await shot('dark-03-workflow-events-grouped');
  await page.getByRole('link', { name: '← All workflows' }).click();
  await openRun(runs, 'fulfillmentWorkflow');
  await expect(step(page, /^bookCourier, Completed, attempt 3/)).toBeVisible();
  await shot('dark-04-workflow-fulfillment');
  await openRunFromWorkflowsPage(page, 'deploymentWorkflow');
  await expect(step(page, /^waitForUpstream/)).toBeVisible();
  await shot('dark-05-workflows-page-running');
  await openRunFromWorkflowsPage(page, 'pipelineWorkflow');
  await step(page, /^deployProduction, Completed/).click();
  await expect(page.getByTestId('step-drawer')).toContainText(
    'deployProduction',
  );
  await graphSettled(page);
  for (const size of await drawnFontSizes(page)) {
    expect(size).toBeGreaterThanOrEqual(12);
  }
  await shot('dark-06-long-workflow-panel');
  await openRunFromWorkflowsPage(page, 'approvalWorkflow');
  await expect(page.getByTestId('workflow-current')).toContainText(
    'Waiting for approval',
  );
  await graphSettled(page);
  await shot('dark-07-workflow-waiting');
  await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .click();
  await page.getByText('Show all runs', { exact: true }).click();
  await expect(
    table(page, 'All workflows').getByText('Continued as new').first(),
  ).toBeVisible();
  await shot('dark-08-workflows-page-all-runs');
});

/** Opens a run from the Workflows page in the sidebar. */
async function openRunFromWorkflowsPage(page: Page, workflowType: string) {
  await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .click();
  const all = table(page, 'All workflows');
  await expect(all.getByText(workflowType).first()).toBeVisible();
  await openRun(all, workflowType);
}
