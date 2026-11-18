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
 * Payloads in Temporal External Storage. The backend does not read the
 * bucket: the test needs an S3-compatible service (for example RustFS) only
 * for the example worker, started with PAYLOAD_S3_ENDPOINT, so that
 * `reportWorkflow` ran with its large payloads stored. The "Open" link is
 * checked against `temporal.externalStorage.objectUrl` when the app is
 * started with it (for example through
 * APP_CONFIG_temporal_externalStorage_objectUrl).
 * Runs only when SMOKE_S3 is set.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);
const objectUrl = process.env.APP_CONFIG_temporal_externalStorage_objectUrl;

test.skip(!process.env.SMOKE_S3, 'SMOKE_S3 is not set');

function step(page: Page, name: RegExp) {
  return page.getByTestId('workflow-graph').getByRole('button', { name });
}

/** Waits until the graph has stopped moving (relayout and pan animations). */
async function graphSettled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => {
        const viewport = document.querySelector('.react-flow__viewport');
        const nodes = [...document.querySelectorAll('.react-flow__node')].map(
          n => (n as HTMLElement).style.transform,
        );
        return `${
          viewport ? getComputedStyle(viewport).transform : ''
        }|${nodes}`;
      });
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

/** Boxes of the graph not fully inside its area, or under the step panel. */
async function boxesOutsideGraph(page: Page): Promise<string[]> {
  const area = await page.getByTestId('workflow-graph').boundingBox();
  const drawer = await page.getByTestId('step-drawer').boundingBox();
  if (!area) return ['(no graph)'];
  const outside: string[] = [];
  for (const box of await page
    .getByTestId('workflow-graph')
    .locator('.react-flow__node')
    .getByRole('button')
    .all()) {
    const b = await box.boundingBox();
    const name = (await box.getAttribute('aria-label')) ?? '?';
    const inside =
      b !== null &&
      b.x >= area.x - 1 &&
      b.y >= area.y - 1 &&
      b.x + b.width <= area.x + area.width + 1 &&
      b.y + b.height <= area.y + area.height + 1;
    const underPanel =
      b !== null &&
      drawer !== null &&
      b.x + b.width > drawer.x + 1 &&
      b.x < drawer.x + drawer.width - 1 &&
      b.y + b.height > drawer.y + 1 &&
      b.y < drawer.y + drawer.height - 1;
    if (!inside || underPanel) outside.push(name);
  }
  return outside;
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

test('large payloads stored in S3: the location is shown, the content is not', async ({
  page,
}) => {
  const serverErrors: string[] = [];
  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

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
  const runs = page
    .getByRole('grid', { name: 'Workflow executions', exact: true })
    .or(page.getByRole('table', { name: 'Workflow executions', exact: true }))
    .first();
  await runs
    .getByRole('row')
    .filter({ hasText: 'reportWorkflow' })
    .first()
    .getByRole('link')
    .first()
    .click();

  const output = page.getByTestId('step-drawer').getByTestId('step-output');
  const bucket = process.env.PAYLOAD_S3_BUCKET ?? 'temporal-payloads';

  // About 1 MB of JSON: where it is stored, and none of its content.
  await step(page, /^buildReport, Completed/).click();
  const stored = output.getByTestId('external-payload');
  await expect(stored).toContainText('Stored in External Storage');
  await expect(stored).toContainText(/1(\.\d)? MB/);
  await expect(stored.getByTestId('external-location')).toContainText(
    new RegExp(`^s3://${bucket}/v0/`),
  );
  await expect(stored.getByTestId('external-sha256')).toContainText(
    /SHA-256 [0-9a-f]{64}/,
  );
  await expect(output).not.toContainText('weekly-sales');
  await expect(output.getByRole('button', { name: 'Download' })).toHaveCount(0);
  await expect(
    stored.getByRole('button', { name: 'Copy location' }),
  ).toBeVisible();
  const open = stored.getByRole('link', { name: 'Open' });
  if (objectUrl) {
    const location = await stored.getByTestId('external-location').innerText();
    const key = location.slice(`s3://${bucket}/`.length);
    await expect(open).toHaveAttribute(
      'href',
      objectUrl
        .replace('{bucket}', encodeURIComponent(bucket))
        .replace('{key}', encodeURIComponent(key)),
    );
  } else {
    await expect(open).toHaveCount(0);
  }
  // A graph of three activities: with the panel open, it is laid out for
  // the narrower area and every box stays in view.
  await expect.poll(() => boxesOutsideGraph(page)).toEqual([]);
  await graphSettled(page);
  expect(await boxesOutsideGraph(page)).toEqual([]);
  await shot(page, '30-s3-large-json');

  // About 180 KiB of JSON: the location too, not the data.
  await step(page, /^summarizeReport, Completed/).click();
  await expect(output.getByTestId('external-payload')).toContainText(
    'Stored in External Storage',
  );
  await expect(output).not.toContainText('SKU-0001');
  await shot(page, '31-s3-reference');

  // A PNG: no image is drawn.
  await step(page, /^renderChart, Completed/).click();
  await expect(output.getByTestId('external-payload')).toBeVisible();
  await expect(output.locator('img')).toHaveCount(0);
  await shot(page, '32-s3-image');

  expect(serverErrors).toEqual([]);
});
