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
import {
  createFakeMcpFactories,
  createFakeVercelModelProvider,
} from '../../common/vercel-ai-fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const runtime = loadSdkRuntime(new URL('../package.json', import.meta.url));
const { AiSdkPlugin } = runtime.sdkRequire('@temporalio/vercel-ai-sdk');
const { z } = runtime.sdkRequire('zod');
const TASK_QUEUE = 'ai-sdk-agents';

const { outDir, only, address } = parseRunnerArgs(process.argv.slice(2));
if (only && only !== 'vercel-ai-sdk-agent') {
  throw new Error(`Unknown scenario: ${only}`);
}

const plugin = new AiSdkPlugin({
  modelProvider: createFakeVercelModelProvider(),
  mcpClientFactories: createFakeMcpFactories({ z, failFirstCall: true }),
});

await runWithWorker({
  runtime,
  address,
  taskQueue: TASK_QUEUE,
  workflowsPath: join(HERE, 'workflows.js'),
  activities: activities.default ?? activities,
  workerPlugins: [plugin],
  async run({ client }) {
    const handle = await client.workflow.start('aiSdkAgent', {
      taskQueue: TASK_QUEUE,
      workflowId: `rec-vercel-agent-${Date.now()}`,
      args: [{ rounds: 2 }],
    });
    await handle.result();
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile: join(outDir, 'llm-integrations', 'vercel-ai-sdk-agent.json'),
      sanitizeOptions: { taskQueue: TASK_QUEUE },
    });
  },
});
