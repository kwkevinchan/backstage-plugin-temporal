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

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, Page, test } from '@playwright/test';

/*
 * Payloads stored in S3. Needs an S3-compatible service (for example
 * RustFS), `temporal.payloads.s3` in the backend config and the example
 * worker started with PAYLOAD_S3_ENDPOINT, so that `reportWorkflow` ran.
 * Runs only when SMOKE_S3 is set.
 */

const app = process.env.SMOKE_APP ?? 'app';
const shotDir = process.env.SMOKE_SHOT_DIR ?? join('e2e-test-results', app);

test.skip(!process.env.SMOKE_S3, 'SMOKE_S3 is not set');

function step(page: Page, name: RegExp) {
  return page.getByTestId('workflow-graph').getByRole('button', { name });
}

async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

test('large payloads stored in S3: preview, inline value, image and download', async ({
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
    .getByRole('grid', { name: 'Workflows', exact: true })
    .or(page.getByRole('table', { name: 'Workflows', exact: true }))
    .first();
  await runs
    .getByRole('row')
    .filter({ hasText: 'reportWorkflow' })
    .first()
    .getByRole('link')
    .first()
    .click();

  // About 1 MB of JSON: size, a preview and a download button.
  await step(page, /^buildReport, Completed/).click();
  const output = page.getByTestId('step-drawer').getByTestId('step-output');
  await expect(output.getByTestId('external-payload')).toContainText(
    'Stored in S3',
  );
  await expect(output).toContainText(/1(\.\d)? MB · application\/json/);
  await expect(output.getByTestId('payload-preview')).toContainText(
    '"reportId":"weekly-sales"',
  );
  await shot(page, '30-s3-large-json');
  const downloadPromise = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^payload-[0-9a-f]{16}\.json$/);
  const saved = join(shotDir, 'downloaded-report.json');
  await download.saveAs(saved);
  expect(statSync(saved).size).toBeGreaterThan(1024 * 1024);

  // About 180 KiB of JSON: shown inline, with the S3 note.
  await step(page, /^summarizeReport, Completed/).click();
  await expect(output).toContainText('SKU-0001');
  await expect(output).toContainText('Stored in S3');
  await shot(page, '31-s3-inline-json');

  // A PNG: shown as a thumbnail.
  await step(page, /^renderChart, Completed/).click();
  const thumbnail = output.getByTestId('payload-thumbnail');
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() =>
      thumbnail.evaluate(img => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(480);
  await shot(page, '32-s3-image');

  expect(serverErrors).toEqual([]);
});
