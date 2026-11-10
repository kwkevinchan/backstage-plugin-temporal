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

/**
 * Workflow controls: start a ticket workflow from its TemporalWorkflow
 * entity, signal it, query it, update it, run the custom Escalate action,
 * cancel it, rerun it and terminate the rerun; then start a workflow from
 * the Workflows page. Needs a running example worker
 * (`yarn workspace example-worker serve`). Runs after temporal.test.ts
 * (files run in name order), so the workflows it starts do not push the
 * example workflows off the first page of the Workflows list.
 */
const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

function isIgnoredConsoleError(text: string): boolean {
  if (
    /Failed to load resource: the server responded with a status of (401|400)/.test(
      text,
    )
  ) {
    return true;
  }
  const fromOurCode = /plugins\/temporal|backstage-plugin-temporal/.test(text);
  return text.startsWith('Warning: ') && !fromOurCode;
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !isIgnoredConsoleError(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error}`));
  page.on('response', response => {
    if (response.status() >= 500) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  mkdirSync(shotDir, { recursive: true });
  return async (name: string) => {
    await page.screenshot({
      path: join(shotDir, `${name}.png`),
      fullPage: true,
      // Dialogs open with an animation; take them when they are in place.
      animations: 'disabled',
    });
    expect(errors, `errors before ${name}`).toEqual([]);
  };
}

function entityTab(page: Page, name: string) {
  return page
    .getByRole('tab', { name, exact: true })
    .or(page.getByRole('link', { name, exact: true }))
    .first();
}

async function signIn(page: Page) {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeVisible();
  await enter.click();
  await page.waitForURL(/\/catalog|\/$/);
}

function summary(page: Page) {
  return page.getByTestId('workflow-summary');
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** Opens a signal, update or query dialog and fills it in. */
async function fillMessage(
  page: Page,
  button: string,
  field: string,
  name: string,
  /** JSON arguments, or a value for the form field of a described handler. */
  args: string | { field: string; value: string },
) {
  await page.getByRole('button', { name: button, exact: true }).click();
  const nameField = dialog(page).getByRole('combobox', { name: field });
  await expect(nameField).toBeVisible();
  // The handler names come from the workflow; wait for the first one.
  await expect(nameField).not.toHaveValue('');
  await nameField.fill(name);
  // Tab closes the list of names, which hides the rest of the dialog.
  await nameField.press('Tab');
  if (typeof args === 'string') {
    await dialog(page)
      .getByRole('textbox', { name: 'Arguments (JSON)' })
      .fill(args);
  } else {
    // spec.messages gives this handler an input schema: a form.
    await dialog(page)
      .getByTestId('message-form')
      .getByRole('textbox', { name: args.field })
      .fill(args.value);
  }
}

async function closeDialog(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await expect(dialog(page)).toHaveCount(0);
}

async function startTicket(page: Page, workflowId: string) {
  await page.goto('/catalog/default/temporalworkflow/example-ticket-workflow');
  const tab = entityTab(page, 'Temporal');
  const enter = page.getByRole('button', { name: 'Enter' });
  // A full page load can show the sign-in page again before the session
  // is restored; the catalog may still be reading the example entities.
  await expect(tab.or(enter)).toBeVisible({ timeout: 120_000 });
  if (await enter.isVisible()) {
    await enter.click();
    await page.goto(
      '/catalog/default/temporalworkflow/example-ticket-workflow',
    );
  }
  await expect(tab).toBeVisible({ timeout: 120_000 });
  await tab.click();
  await page.getByRole('button', { name: 'Start workflow' }).click();
  const input = dialog(page).getByRole('textbox', { name: 'Input (JSON)' });
  await expect(input).toHaveValue(/Printer is out of paper/);
  await dialog(page)
    .getByRole('textbox', { name: 'Workflow ID' })
    .fill(workflowId);
}

test('starts, signals, queries, updates, cancels and reruns a workflow', async ({
  page,
}) => {
  const shot = watch(page);
  await signIn(page);
  const id = `e2e-ticket-${Date.now().toString(36)}`;

  // 1. Start workflow on the TemporalWorkflow entity, with its example input.
  await startTicket(page, id);
  await shot('30-start-dialog');
  await dialog(page)
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/workflows/${id}/runs/`));
  await expect(summary(page)).toContainText('ticketWorkflow');
  await expect(summary(page)).toContainText('Running');
  await shot('31-started');

  // 2. A signal adds a note.
  await fillMessage(page, 'Signal…', 'Signal name', 'addNote', {
    field: 'Note',
    value: 'Checked the paper tray',
  });
  await shot('32-signal-dialog');
  await dialog(page).getByRole('button', { name: 'Send signal' }).click();
  await expect(
    dialog(page).getByTestId('workflow-signal-result'),
  ).toContainText('Signal addNote sent');
  await closeDialog(page);

  // 3. The query shows the note.
  await fillMessage(page, 'Query…', 'Query name', 'state', '[]');
  await dialog(page).getByRole('button', { name: 'Run query' }).click();
  const queryResult = dialog(page).getByTestId('workflow-query-result');
  await expect(queryResult).toContainText('Checked the paper tray');
  await expect(queryResult).toContainText('normal');
  await shot('33-query-result');
  await closeDialog(page);

  // 4. The update validator rejects a bad priority, then takes a good one.
  await fillMessage(
    page,
    'Update…',
    'Update name',
    'setPriority',
    '["urgent"]',
  );
  await dialog(page).getByRole('button', { name: 'Send update' }).click();
  await expect(dialog(page).getByTestId('temporal-error')).toContainText(
    'priority must be one of low, normal, high',
  );
  await shot('34-update-rejected');
  await dialog(page)
    .getByRole('textbox', { name: 'Arguments (JSON)' })
    .fill('["low"]');
  await dialog(page).getByRole('button', { name: 'Send update' }).click();
  await expect(
    dialog(page).getByTestId('workflow-update-result'),
  ).toContainText('"previous": "normal"');
  await shot('35-update-result');
  await closeDialog(page);

  // 5. The custom Escalate action of the backend module.
  await page.getByRole('button', { name: 'Escalate' }).click();
  await dialog(page).getByRole('button', { name: 'Escalate' }).click();
  await expect(page.getByTestId('workflow-action-result')).toContainText(
    '"priority": "high"',
  );
  await shot('36-custom-action');
  await closeDialog(page);
  await fillMessage(page, 'Query…', 'Query name', 'state', '[]');
  await dialog(page).getByRole('button', { name: 'Run query' }).click();
  await expect(dialog(page).getByTestId('workflow-query-result')).toContainText(
    'Escalated by user:default/guest',
  );
  await closeDialog(page);

  // 6. Cancel: the workflow closes as Canceled.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await shot('37-cancel-dialog');
  await dialog(page).getByRole('button', { name: 'Cancel workflow' }).click();
  await expect(summary(page)).toContainText('Canceled', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Signal…' })).toHaveCount(0);
  await shot('38-canceled');

  // 7. Rerun opens the new workflow, which runs with the same input.
  await page.getByRole('button', { name: 'Rerun' }).click();
  await dialog(page).getByRole('button', { name: 'Rerun' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/workflows/${id}-rerun-[a-z0-9]+/runs/`),
  );
  await expect(summary(page)).toContainText('Running');
  await fillMessage(page, 'Query…', 'Query name', 'state', '[]');
  await dialog(page).getByRole('button', { name: 'Run query' }).click();
  await expect(dialog(page).getByTestId('workflow-query-result')).toContainText(
    'Printer is out of paper',
  );
  await closeDialog(page);
  await shot('39-rerun');

  // 8. Terminate needs a reason.
  await page.getByRole('button', { name: 'Terminate', exact: true }).click();
  const terminate = dialog(page).getByRole('button', { name: 'Terminate' });
  await expect(terminate).toBeDisabled();
  await dialog(page)
    .getByRole('textbox', { name: /Reason/ })
    .fill('e2e cleanup');
  await shot('40-terminate-dialog');
  await terminate.click();
  await expect(summary(page)).toContainText('Terminated', { timeout: 60_000 });
  await shot('41-terminated');

  // 9. Start workflow on the Workflows page asks for the type and queue.
  await page
    .getByRole('link', { name: 'Workflows', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Start workflow' }).click();
  await dialog(page)
    .getByRole('textbox', { name: /Workflow type/ })
    .fill('ticketWorkflow');
  await dialog(page)
    .getByRole('textbox', { name: /Task queue/ })
    .fill('backstage-example');
  await dialog(page)
    .getByRole('textbox', { name: 'Input (JSON)' })
    .fill('{"title": "From the Workflows page"}');
  await shot('42-workflows-page-start');
  await dialog(page)
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(summary(page)).toContainText('ticketWorkflow');
  await expect(summary(page)).toContainText('Running');
  await page.getByRole('button', { name: 'Terminate', exact: true }).click();
  await dialog(page)
    .getByRole('textbox', { name: /Reason/ })
    .fill('e2e cleanup');
  await dialog(page).getByRole('button', { name: 'Terminate' }).click();
  await expect(summary(page)).toContainText('Terminated', { timeout: 60_000 });
  await shot('43-workflows-page-terminated');
});

test('shows the workflow controls in the dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark');
  });
  const shot = watch(page);
  await signIn(page);
  const id = `e2e-dark-ticket-${Date.now().toString(36)}`;
  await startTicket(page, id);
  await expect(page.locator('body')).toHaveAttribute('data-theme-mode', 'dark');
  await shot('dark-30-start-dialog');
  await dialog(page)
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(summary(page)).toContainText('Running');
  await shot('dark-31-started');
  await fillMessage(page, 'Signal…', 'Signal name', 'addNote', {
    field: 'Note',
    value: 'A dark note',
  });
  await dialog(page).getByRole('button', { name: 'Send signal' }).click();
  await expect(
    dialog(page).getByTestId('workflow-signal-result'),
  ).toBeVisible();
  await shot('dark-32-signal-sent');
  await closeDialog(page);
  await fillMessage(
    page,
    'Update…',
    'Update name',
    'setPriority',
    '["urgent"]',
  );
  await dialog(page).getByRole('button', { name: 'Send update' }).click();
  await expect(dialog(page).getByTestId('temporal-error')).toBeVisible();
  await shot('dark-33-update-rejected');
  await closeDialog(page);
  await fillMessage(page, 'Query…', 'Query name', 'state', '[]');
  await dialog(page).getByRole('button', { name: 'Run query' }).click();
  await expect(dialog(page).getByTestId('workflow-query-result')).toContainText(
    'A dark note',
  );
  await shot('dark-34-query-result');
  await closeDialog(page);
  await page.getByRole('button', { name: 'Terminate', exact: true }).click();
  await dialog(page)
    .getByRole('textbox', { name: /Reason/ })
    .fill('e2e cleanup');
  await shot('dark-35-terminate-dialog');
  await dialog(page).getByRole('button', { name: 'Terminate' }).click();
  await expect(summary(page)).toContainText('Terminated', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Rerun' }).click();
  await shot('dark-36-rerun-dialog');
  await dialog(page)
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
});
