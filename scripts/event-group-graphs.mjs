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

/**
 * Writes the graph responses of the frontend tests of the event groups.
 *
 * The frontend tests do not run backend code, so this script reads some
 * recorded histories of `test-fixtures/` with the backend's graph builder
 * (`buildWorkflowGraph`, with the built-in LLM adapters) and writes each
 * graph response to `plugins/temporal-frontend/src/testGraphs/<name>.ts`.
 * Run it again when the backend changes the shape of the graph:
 *
 *   yarn sync:test-graphs         writes the files
 *   yarn sync:test-graphs:check   fails when a file is out of date
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Loads the TypeScript sources of the backend.
require('@backstage/cli/config/nodeTransform.cjs');
const { buildWorkflowGraph } = require(join(
  root,
  'plugins/temporal-backend/src/services/graph.ts',
));
// Reads a recorded history as the backend tests do: with its times and
// durations in the form the backend reads from Temporal.
const { readHistoryFixture } = require(join(
  root,
  'plugins/temporal-backend/src/__testUtils__/fixtures.ts',
));
const prettier = require('prettier');

const outDir = join(root, 'plugins/temporal-frontend/src/testGraphs');

/** The graphs: export name, recorded history and options. */
const graphs = [
  {
    name: 'loopGraph',
    fixture: 'event-groups/loop-ts-sdk-1.25.json',
    about:
      'a loop of three rounds, each round a group inside the loop group, a signal handler group and a group of one step',
  },
  {
    name: 'loopGraphPayloadsHidden',
    fixture: 'event-groups/loop-ts-sdk-1.25.json',
    about: 'the same run for a caller without the permission to read payloads',
    includePayloads: false,
  },
  {
    name: 'parallelGraph',
    fixture: 'event-groups/parallel.json',
    about:
      'two groups in parallel, one with a nested group, then two groups that share a step without one being inside the other',
  },
  {
    name: 'ambiguousGraph',
    fixture: 'event-groups/ambiguous.json',
    about: 'groups given as options to single steps, read as nesting',
  },
  {
    name: 'codecLoopGraph',
    fixture: 'event-groups/codec-loop.json',
    about: 'the loop with labels encrypted by a payload codec',
  },
  {
    name: 'agentGraph',
    fixture: 'llm-integrations/vercel-ai-sdk-agent.json',
    about:
      'an agent of the official Vercel AI SDK integration: two rounds, each a group with model calls and tool calls',
  },
];

/** The status of the run, from its last event. */
function runStatus(events) {
  const last = events[events.length - 1]?.eventType ?? '';
  const statuses = {
    EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED: 'Completed',
    EVENT_TYPE_WORKFLOW_EXECUTION_FAILED: 'Failed',
    EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT: 'TimedOut',
    EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED: 'Canceled',
    EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED: 'Terminated',
    EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW: 'ContinuedAsNew',
  };
  return statuses[last] ?? 'Running';
}

const header = readFileSync(join(root, 'scripts/sync-common.mjs'), 'utf8')
  .split('\n')
  .slice(1, 16)
  .join('\n');

const check = process.argv.includes('--check');
const stale = [];
for (const graph of graphs) {
  const [dir, file] = graph.fixture.split('/');
  const { events } = readHistoryFixture(dir, file.replace(/\.json$/, ''));
  const response = buildWorkflowGraph(events, {
    namespace: 'default',
    workflowId: 'wf',
    status: runStatus(events),
    truncated: false,
    includePayloads: graph.includePayloads ?? true,
  });
  const source = [
    header,
    '',
    `// Written by scripts/event-group-graphs.mjs from test-fixtures/${graph.fixture}:`,
    `// ${graph.about}. Run \`yarn sync:test-graphs\` to write it again.`,
    '',
    "import type { WorkflowGraphResponse } from '../common';",
    '',
    `export const ${graph.name}: WorkflowGraphResponse = ${JSON.stringify(
      response,
    )};`,
    '',
  ].join('\n');
  const out = join(outDir, `${graph.name}.ts`);
  const options = (await prettier.resolveConfig(out)) ?? {};
  const formatted = await prettier.format(source, {
    ...options,
    filepath: out,
  });
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== formatted) {
      stale.push(relative(root, out));
    }
  } else {
    writeFileSync(out, formatted);
  }
}
if (stale.length > 0) {
  console.error(
    `Out of date, run \`yarn sync:test-graphs\`:\n${stale
      .map(f => `  ${f}`)
      .join('\n')}`,
  );
  process.exit(1);
}
