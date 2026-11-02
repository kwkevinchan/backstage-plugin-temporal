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
 * Keeps the frontend copy of the shared definitions in step with the
 * backend.
 *
 * Backstage does not let a frontend plugin import a backend plugin (or the
 * other way round), so the permissions, types, annotation constants and API
 * paths live in both packages. The backend has the original
 * (`plugins/temporal-backend/src/common`); the frontend has a copy
 * (`plugins/temporal/src/common`) with the same files, each with a note
 * after the license header. Tests (`*.test.ts`) stay in the backend.
 *
 * Usage:
 *   node scripts/sync-common.mjs           # write the frontend copy
 *   node scripts/sync-common.mjs --check   # fail when the copy differs (CI)
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
const SOURCE = 'plugins/temporal-backend/src/common';
const TARGET = 'plugins/temporal/src/common';
const HEADER_END = ' */\n';

/** The frontend copy of one backend file. */
export function copyOf(name, text) {
  const note =
    `\n// Copy of ${SOURCE}/${name}, written by scripts/sync-common.mjs.\n` +
    '// Edit the backend file and run `yarn sync:common`.\n';
  const end = text.indexOf(HEADER_END);
  if (!text.startsWith('/*') || end < 0) {
    throw new Error(`${SOURCE}/${name} has no license header`);
  }
  const at = end + HEADER_END.length;
  return text.slice(0, at) + note + text.slice(at);
}

function sourceFiles() {
  return readdirSync(join(root, SOURCE))
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();
}

function main() {
  const check = process.argv.includes('--check');
  const expected = new Map(
    sourceFiles().map(f => [
      f,
      copyOf(f, readFileSync(join(root, SOURCE, f), 'utf8')),
    ]),
  );
  const targetDir = join(root, TARGET);
  const present = existsSync(targetDir) ? readdirSync(targetDir).sort() : [];
  const problems = [];

  for (const [name, text] of expected) {
    const path = join(targetDir, name);
    const actual = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (actual === text) continue;
    if (check) {
      problems.push(
        actual === undefined
          ? `${TARGET}/${name} is missing`
          : `${TARGET}/${name} differs from ${SOURCE}/${name}`,
      );
    } else {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(path, text);
      console.log(`wrote ${TARGET}/${name}`);
    }
  }
  for (const name of present) {
    if (expected.has(name)) continue;
    if (check) problems.push(`${TARGET}/${name} has no backend original`);
    else {
      rmSync(join(targetDir, name));
      console.log(`removed ${TARGET}/${name}`);
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(
      'The frontend copy of the shared definitions is out of date. Edit the backend files and run `yarn sync:common`.',
    );
    process.exit(1);
  }
  if (check) {
    console.log(`${TARGET} matches ${SOURCE} (${expected.size} files)`);
  }
}

main();
