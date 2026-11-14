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
 * Writes `plugins/temporal-frontend/src/components/graph/layoutBaseline.ts`:
 * layouts of `layoutSteps` as it was at commit 58296d1, before the frames
 * of the event groups, for the test that graphs without frames are laid
 * out as before. Run it from a clone with that commit:
 *
 *   node scripts/layout-baseline.mjs
 *
 * It reads `layout.ts` of that commit with `git show`, puts it next to the
 * current one for the time it runs, and removes it again.
 */

import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '58296d1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const graphDir = join(root, 'plugins/temporal-frontend/src/components/graph');
const require = createRequire(import.meta.url);
require('@backstage/cli/config/nodeTransform.cjs');
const prettier = require('prettier');

const old = join(graphDir, 'baselineLayout.tmp.ts');
writeFileSync(
  old,
  execFileSync(
    'git',
    [
      'show',
      `${COMMIT}:plugins/temporal-frontend/src/components/graph/layout.ts`,
    ],
    { cwd: root },
  ),
);
let layoutSteps;
try {
  ({ layoutSteps } = require(old));
} finally {
  rmSync(old);
}

const link = ids =>
  ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
const chain = (n, sizes = {}) => {
  const ids = [
    'start',
    ...Array.from({ length: n }, (_, i) => `a${i + 1}`),
    'end',
  ];
  return {
    nodes: ids.map(id => (sizes[id] ? { id, size: sizes[id] } : { id })),
    edges: link(ids),
  };
};
const branch = () => ({
  nodes: ['start', 'a', 'b1', 'b2', 'c1', 'c2', 'c3', 'join', 'end'].map(
    id => ({ id }),
  ),
  edges: [
    ['start', 'a'],
    ['a', 'b1'],
    ['b1', 'b2'],
    ['a', 'c1'],
    ['c1', 'c2'],
    ['c2', 'c3'],
    ['b2', 'join'],
    ['c3', 'join'],
    ['join', 'end'],
  ].map(([source, target]) => ({ source, target })),
});
const llm = { width: 240, height: 86 };
const tool = { width: 180, height: 52 };
const graphs = [
  ['chain30', chain(30)],
  ['branch', branch()],
  [
    'sized',
    chain(12, {
      a1: llm,
      a2: tool,
      a4: llm,
      a5: tool,
      a7: llm,
      a8: tool,
      a10: llm,
      a11: tool,
      end: llm,
    }),
  ],
  ['chain5', chain(5)],
  // A box as large as an expanded loop.
  ['wide', chain(6, { a3: { width: 1400, height: 600 } })],
];

const copy = graph => JSON.parse(JSON.stringify(graph));
const cases = [];
const record = (name, graph, width, direction) => {
  const g = copy(graph);
  const l = layoutSteps(
    g.nodes,
    g.edges,
    width,
    direction ? { direction } : {},
  );
  cases.push({
    name,
    ...graph,
    width: width ?? null,
    ...(direction ? { direction } : {}),
    layout: {
      positions: [...l.positions],
      sizes: l.sizes
        ? [...l.sizes].map(([id, s]) => [
            id,
            { width: s.width, height: s.height },
          ])
        : null,
      width: l.width,
      height: l.height,
      wrapped: l.wrapped,
      rowGaps: l.rowGaps ?? null,
    },
  });
};
for (const [name, graph] of graphs) {
  for (const width of [undefined, 400, 900, 1400]) record(name, graph, width);
  record(name, graph, 900, 'TB');
}

const header = (await import('node:fs'))
  .readFileSync(join(root, 'scripts/sync-common.mjs'), 'utf8')
  .split('\n')
  .slice(1, 16)
  .join('\n');
const file = join(graphDir, 'layoutBaseline.ts');
const source = `${header}

// Layouts of \`layoutSteps\` at commit ${COMMIT}, before the frames of the
// event groups, for the test that graphs without frames are laid out as
// before. Written by \`node scripts/layout-baseline.mjs\`.

export const layoutBaseline = ${JSON.stringify(cases)};
`;
writeFileSync(
  file,
  await prettier.format(source, {
    ...((await prettier.resolveConfig(file)) ?? {}),
    filepath: file,
  }),
);
