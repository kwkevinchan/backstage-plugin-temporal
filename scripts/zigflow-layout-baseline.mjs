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
 * Generates `definitionLayoutBaseline.ts` for the Zigflow module: lays out
 * `test-fixtures/definitions/every-task.yaml` with `buildDefinitionGraph` and
 * the current `layoutSteps(..., { direction: "TB" })`. Re-run after any
 * intentional change to the TB layout or definition graph:
 *
 *   node scripts/zigflow-layout-baseline.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zigflowDefDir = join(
  root,
  'plugins/temporal-module-zigflow/src/components/definition',
);
const require = createRequire(import.meta.url);
require('@backstage/cli/config/nodeTransform.cjs');
const prettier = require('prettier');
const { parse } = require(require.resolve('yaml', {
  paths: [join(root, 'plugins/temporal-module-zigflow'), root],
}));

const { buildDefinitionGraph } = require(join(zigflowDefDir, 'dslGraph.ts'));
const { boxSize, layoutSteps } = require(join(
  root,
  'plugins/temporal-frontend/src/components/graph/layout.ts',
));

const fixturePath = join(root, 'test-fixtures/definitions/every-task.yaml');
const document = parse(readFileSync(fixturePath, 'utf8'));
const graph = buildDefinitionGraph(document);
const layout = layoutSteps(graph.nodes, graph.edges, undefined, {
  direction: 'TB',
});

const baseline = {
  width: layout.width,
  height: layout.height,
  wrapped: layout.wrapped,
  nodes: graph.nodes.map(node => ({
    id: node.id,
    position: layout.positions.get(node.id),
    size: boxSize(layout, node.id),
  })),
};

const licenseHeader = readFileSync(
  join(root, 'scripts/sync-common.mjs'),
  'utf8',
)
  .split('\n')
  .slice(1, 16)
  .join('\n');

const target = join(zigflowDefDir, 'definitionLayoutBaseline.ts');
const source = `${licenseHeader}

// Layout produced by running \`buildDefinitionGraph\` and \`layoutSteps(...,
// { direction: 'TB' })\` on \`test-fixtures/definitions/every-task.yaml\`.
// Written by \`node scripts/zigflow-layout-baseline.mjs\`.

export const definitionLayoutBaseline = ${JSON.stringify(baseline)};
`;

writeFileSync(
  target,
  await prettier.format(source, {
    ...((await prettier.resolveConfig(target)) ?? {}),
    filepath: target,
  }),
);
console.log(
  `Wrote ${target} (${baseline.nodes.length} nodes, ${baseline.width}x${baseline.height})`,
);
