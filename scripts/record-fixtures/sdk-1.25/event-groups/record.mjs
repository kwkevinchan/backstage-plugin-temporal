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
const CODEC_TASK_QUEUE = 'event-groups-codec';
// Plain-text sample that must not appear in a recorded encrypted history.
const CODEC_SECRET = 'S3CR3T-明文-42';

function plainScenario(name, workflowType, args = [], extra) {
  return async ({ client, address, outFile }) => {
    const handle = await client.workflow.start(workflowType, {
      taskQueue: TASK_QUEUE,
      workflowId: `rec-${name}-${Date.now()}`,
      args,
    });
    if (extra?.beforeResult) await extra.beforeResult(handle);
    await handle.result();
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile,
      sanitizeOptions: { taskQueue: TASK_QUEUE },
    });
  };
}

const SCENARIOS = {
  'loop-ts-sdk-1.25': plainScenario('loop-125', 'groupLoop', [{}], {
    async beforeResult(handle) {
      await new Promise(r => setTimeout(r, 2300));
      await handle.signal('hint', '多寫一個例子');
    },
  }),
  flat: plainScenario('flat', 'flatGroup'),
  parallel: plainScenario('parallel', 'parallelGroups'),
  ambiguous: plainScenario('ambiguous', 'ambiguousGroups'),
  'no-label-ts-sdk-1.25': plainScenario('no-label', 'labelSizes', [
    { labelBytes: 0 },
  ]),
  'long-label': plainScenario('long-label', 'labelSizes', [
    { labelBytes: 4000 },
  ]),
  'continue-as-new': plainScenario('can', 'continueAsNewGroups', [
    { nextRound: 1, maxRounds: 5, perRun: 2 },
  ]),
  'child-local-activity': async ({ client, address, outDir }) => {
    const suffix = Date.now();
    const prefix = `rec-child-${suffix}`;
    const handle = await client.workflow.start('groupsWithChildren', {
      taskQueue: TASK_QUEUE,
      workflowId: `rec-child-parent-${suffix}`,
      args: [{ childIdPrefix: prefix }],
    });
    await handle.result();
    const renameWorkflowIds = {
      [`${prefix}.child-2`]: 'event-groups-child.child-2',
      [`${prefix}.child-opt`]: 'event-groups-child.child-opt',
    };
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile: join(outDir, 'event-groups', 'child-local-activity.json'),
      sanitizeOptions: { taskQueue: TASK_QUEUE, renameWorkflowIds },
    });
    const child = client.workflow.getHandle(`${prefix}.child-2`);
    exportAndSanitize({
      address,
      workflowId: `${prefix}.child-2`,
      runId: (await child.describe()).runId,
      outFile: join(outDir, 'event-groups', 'child-local-activity.child.json'),
      sanitizeOptions: { taskQueue: TASK_QUEUE, renameWorkflowIds },
    });
  },
  'codec-loop': async ({ client, address, outFile }) => {
    const handle = await client.workflow.start('groupLoop', {
      taskQueue: CODEC_TASK_QUEUE,
      workflowId: `rec-codec-loop-${Date.now()}`,
      args: [{ topic: `codec ${CODEC_SECRET}` }],
      staticSummary: `static summary 明文：${CODEC_SECRET}`,
    });
    await handle.result();
    exportAndSanitize({
      address,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      outFile,
      sanitizeOptions: { taskQueue: CODEC_TASK_QUEUE },
    });
  },
};

const { outDir, only, address } = parseRunnerArgs(process.argv.slice(2));
const selected = only ? [only] : Object.keys(SCENARIOS);
for (const name of selected) {
  if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
}

const plainNames = selected.filter(n => n !== 'codec-loop');
const codecNames = selected.filter(n => n === 'codec-loop');

if (plainNames.length > 0) {
  await runWithWorker({
    runtime,
    address,
    taskQueue: TASK_QUEUE,
    workflowsPath: join(HERE, 'workflows.js'),
    activities: activities.default ?? activities,
    async run({ client }) {
      for (const name of plainNames) {
        await SCENARIOS[name]({
          client,
          address,
          outDir,
          outFile: join(outDir, 'event-groups', `${name}.json`),
        });
      }
    },
  });
}

if (codecNames.length > 0) {
  await runWithWorker({
    runtime,
    address,
    taskQueue: CODEC_TASK_QUEUE,
    workflowsPath: join(HERE, 'workflows.js'),
    activities: activities.default ?? activities,
    useCodec: true,
    async run({ client }) {
      await SCENARIOS['codec-loop']({
        client,
        address,
        outFile: join(outDir, 'event-groups', 'codec-loop.json'),
      });
    },
  });
}
