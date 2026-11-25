#!/usr/bin/env node
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

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as activities from './activities.js';
import {
  exportAndSanitize,
  loadSdkRuntime,
  parseRunnerArgs,
  runWithWorker,
} from '../../common/record-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const runtime = loadSdkRuntime(new URL('../package.json', import.meta.url));
const TASK_QUEUE = 'event-groups';

const SCENARIOS = {
  'loop-ts-sdk-1.24': async ({ client, address, outFile }) => {
    const handle = await client.workflow.start('groupLoop', {
      taskQueue: TASK_QUEUE,
      workflowId: `rec-loop-124-${Date.now()}`,
      args: [{}],
    });
    // Round 1 ends after its 2 s sleep; the signal at 2.3 s lands in round 2.
    await new Promise(r => setTimeout(r, 2300));
    await handle.signal('hint', '多寫一個例子');
    await handle.result();
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile,
      sanitizeOptions: { taskQueue: TASK_QUEUE },
    });
  },
  'no-id-ts-sdk-1.24': async ({ client, address, outFile }) => {
    const handle = await client.workflow.start('groupWithoutId', {
      taskQueue: TASK_QUEUE,
      workflowId: `rec-noid-124-${Date.now()}`,
      args: [],
    });
    await handle.result();
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile,
      sanitizeOptions: { taskQueue: TASK_QUEUE },
    });
  },
};

const { outDir, only, address } = parseRunnerArgs(process.argv.slice(2));
const selected = only ? [only] : Object.keys(SCENARIOS);
for (const name of selected) {
  if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
}

await runWithWorker({
  runtime,
  address,
  taskQueue: TASK_QUEUE,
  workflowsPath: join(HERE, 'workflows.js'),
  activities: activities.default ?? activities,
  async run({ client }) {
    for (const name of selected) {
      await SCENARIOS[name]({
        client,
        address,
        outFile: join(outDir, 'event-groups', `${name}.json`),
      });
    }
  },
});
