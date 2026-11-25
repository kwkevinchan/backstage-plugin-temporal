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
const CODEC_TASK_QUEUE = 'ai-sdk-encrypted';

const PLAIN_SCENARIOS = {
  'vercel-ai-sdk-parallel-tools': { workflowType: 'aiSdkParallel', args: [] },
  'vercel-ai-sdk-streaming': { workflowType: 'aiSdkStream', args: [] },
  'vercel-ai-sdk-summary': {
    workflowType: 'aiSdkSummary',
    args: [{ summary: 'plan call' }],
  },
};

const ALL_NAMES = [
  ...Object.keys(PLAIN_SCENARIOS),
  'codec-vercel-ai-sdk-agent',
];

const { outDir, only, address } = parseRunnerArgs(process.argv.slice(2));
const selected = only ? [only] : ALL_NAMES;
for (const name of selected) {
  if (!ALL_NAMES.includes(name)) throw new Error(`Unknown scenario: ${name}`);
}

const plainSelected = selected.filter(n => n !== 'codec-vercel-ai-sdk-agent');
const runCodec = selected.includes('codec-vercel-ai-sdk-agent');

if (plainSelected.length > 0) {
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
      for (const name of plainSelected) {
        const spec = PLAIN_SCENARIOS[name];
        const handle = await client.workflow.start(spec.workflowType, {
          taskQueue: TASK_QUEUE,
          workflowId: `rec-${name}-${Date.now()}`,
          args: spec.args,
        });
        await handle.result();
        exportAndSanitize({
          address,
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          outFile: join(outDir, 'llm-integrations', `${name}.json`),
          sanitizeOptions: { taskQueue: TASK_QUEUE },
        });
      }
    },
  });
}

if (runCodec) {
  const plugin = new AiSdkPlugin({
    modelProvider: createFakeVercelModelProvider(),
    mcpClientFactories: createFakeMcpFactories({ z, failFirstCall: true }),
  });
  await runWithWorker({
    runtime,
    address,
    taskQueue: CODEC_TASK_QUEUE,
    workflowsPath: join(HERE, 'workflows.js'),
    activities: activities.default ?? activities,
    workerPlugins: [plugin],
    useCodec: true,
    async run({ client }) {
      const handle = await client.workflow.start('aiSdkSummary', {
        taskQueue: CODEC_TASK_QUEUE,
        workflowId: `rec-codec-aisdk-${Date.now()}`,
        args: [{ encrypted: true }],
      });
      await handle.result();
      exportAndSanitize({
        address,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        outFile: join(
          outDir,
          'llm-integrations',
          'codec-vercel-ai-sdk-agent.json',
        ),
        sanitizeOptions: {
          workflowType: 'aiSdkAgent',
          taskQueue: CODEC_TASK_QUEUE,
        },
      });
    },
  });
}
