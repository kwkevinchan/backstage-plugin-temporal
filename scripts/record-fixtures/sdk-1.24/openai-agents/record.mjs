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
import { createFakeOpenAIModelProvider } from './fake-model.mjs';
import {
  exportAndSanitize,
  loadSdkRuntime,
  parseRunnerArgs,
  runWithWorker,
} from '../../common/record-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const runtime = loadSdkRuntime(new URL('../package.json', import.meta.url));
const { OpenAIAgentsPlugin } = runtime.sdkRequire('@temporalio/openai-agents');
const TASK_QUEUE = 'openai-agents';

const SCENARIOS = {
  'openai-agents-agent': 'openAiAgent',
  'openai-agents-parallel-tools': 'openAiParallel',
  'openai-agents-reasoning': 'openAiReasoning',
  'openai-agents-streaming': 'openAiStream',
  'openai-agents-summary': 'openAiSummary',
};

const { outDir, only, address } = parseRunnerArgs(process.argv.slice(2));
const selected = only ? [only] : Object.keys(SCENARIOS);
for (const name of selected) {
  if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
}

const plugin = new OpenAIAgentsPlugin({
  modelProvider: createFakeOpenAIModelProvider(),
});

await runWithWorker({
  runtime,
  address,
  taskQueue: TASK_QUEUE,
  workflowsPath: join(HERE, 'workflows.js'),
  activities: activities.default ?? activities,
  workerPlugins: [plugin],
  clientPlugins: [plugin],
  async run({ client }) {
    for (const name of selected) {
      const workflowType = SCENARIOS[name];
      const handle = await client.workflow.start(workflowType, {
        taskQueue: TASK_QUEUE,
        workflowId: `rec-${name}-${Date.now()}`,
        args: [],
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
