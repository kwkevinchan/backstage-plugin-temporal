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

import { defineConfig } from '@playwright/test';

/**
 * Smoke test of one development app against the development backend.
 *
 *   SMOKE_APP=app yarn test:e2e        # legacy frontend system
 *   SMOKE_APP=app-next yarn test:e2e   # new frontend system
 *
 * The backend needs a reachable Temporal server with the example workflows
 * (`yarn workspace example-worker start`). Screenshots of every step go to
 * SMOKE_SHOT_DIR (default e2e-test-results/<app>). SMOKE_APP_URL and
 * SMOKE_BACKEND_URL point at servers on other ports (start them yourself,
 * with the same ports in the app config). The S3 payload test runs when
 * SMOKE_S3 is set (see e2e-tests/payloads.test.ts).
 */
const app = process.env.SMOKE_APP ?? 'app';
const appUrl = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const backendUrl = process.env.SMOKE_BACKEND_URL ?? 'http://localhost:7007';
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e-tests',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `e2e-test-report/${app}` }],
  ],
  webServer: [
    {
      command: `yarn workspace ${app} start`,
      url: appUrl,
      reuseExistingServer: !ci,
      timeout: 600_000,
    },
    {
      command: 'yarn workspace backend start',
      url: `${backendUrl}/.backstage/health/v1/readiness`,
      reuseExistingServer: !ci,
      timeout: 600_000,
    },
  ],
  use: {
    baseURL: appUrl,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: `node_modules/.cache/e2e-test-results/${app}`,
  projects: [{ name: app }],
});
