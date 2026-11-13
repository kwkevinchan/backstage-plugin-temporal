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
 * Keeps the frontend copies of the shared definitions in step with the
 * backend originals.
 *
 * Backstage does not let a frontend plugin import a backend plugin (or the
 * other way round), and the frontend and the backend each ship as one
 * package. So the definitions both sides need (permissions, API types and
 * paths, annotations, the `TemporalWorkflow` entity) live in the backend
 * package, and the frontend package has a copy of each file with a note
 * after the license header. Tests (`*.test.ts`) stay in the backend. The
 * pairs:
 *
 *   plugins/temporal-backend/src/common → plugins/temporal-frontend/src/common
 *   plugins/temporal-backend-module-zigflow/src/common → plugins/temporal-module-zigflow/src/common
 *
 * Usage:
 *   node scripts/sync-common.mjs           # write the frontend copies
 *   node scripts/sync-common.mjs --check   # fail when a copy differs (CI)
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAIRS = [
  [
    'plugins/temporal-backend/src/common',
    'plugins/temporal-frontend/src/common',
  ],
  [
    'plugins/temporal-backend-module-zigflow/src/common',
    'plugins/temporal-module-zigflow/src/common',
  ],
];
const HEADER_END = ' */\n';

/** The frontend copy of one backend file. */
function copyOf(name, text, source) {
  const note =
    `\n// Copy of ${source}/${name}, written by scripts/sync-common.mjs.\n` +
    '// Edit the backend file and run `yarn sync:common`.\n';
  const end = text.indexOf(HEADER_END);
  if (!text.startsWith('/*') || end < 0) {
    throw new Error(`${source}/${name} has no license header`);
  }
  const at = end + HEADER_END.length;
  return text.slice(0, at) + note + text.slice(at);
}

function sourceFiles(source) {
  return readdirSync(join(root, source))
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();
}

function main() {
  const check = process.argv.includes('--check');
  let failed = false;
  for (const [source, target] of PAIRS) {
    failed = syncPair(source, target, check) || failed;
  }
  if (failed) {
    console.error(
      'The frontend copy of the shared definitions is out of date. Edit the backend files and run `yarn sync:common`.',
    );
    process.exit(1);
  }
}

/** Writes or checks one copy; true when the check found a difference. */
function syncPair(source, target, check) {
  const expected = new Map(
    sourceFiles(source).map(f => [
      f,
      copyOf(f, readFileSync(join(root, source, f), 'utf8'), source),
    ]),
  );
  const targetDir = join(root, target);
  const present = existsSync(targetDir) ? readdirSync(targetDir).sort() : [];
  const problems = [];

  for (const [name, text] of expected) {
    const path = join(targetDir, name);
    const actual = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (actual === text) continue;
    if (check) {
      problems.push(
        actual === undefined
          ? `${target}/${name} is missing`
          : `${target}/${name} differs from ${source}/${name}`,
      );
    } else {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(path, text);
      console.log(`wrote ${target}/${name}`);
    }
  }
  for (const name of present) {
    if (expected.has(name)) continue;
    if (check) problems.push(`${target}/${name} has no backend original`);
    else {
      rmSync(join(targetDir, name));
      console.log(`removed ${target}/${name}`);
    }
  }

  for (const p of problems) console.error(p);
  if (check && problems.length === 0) {
    console.log(`${target} matches ${source} (${expected.size} files)`);
  }
  return problems.length > 0;
}

main();
