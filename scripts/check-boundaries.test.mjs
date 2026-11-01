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
 * Self test for check-boundaries.mjs. Forbidden samples are assembled at
 * runtime so that none of them appear verbatim in the repository.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  parseDenylist,
  scanDiff,
  scanText,
} from './check-boundaries.mjs';

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-boundaries.mjs',
);
const j = (...parts) => parts.join('');
const rnd = n => 'A1b2C3d4E5'.repeat(Math.ceil(n / 10)).slice(0, n);

const samples = {
  'windows-user-path': j('C:', '\\', 'Users', '\\someone\\project'),
  'wsl-mount-path': j('cd /', 'mnt', '/c/', 'work'),
  'private-key': j('-----', 'BEGIN OPENSSH PRIVATE KEY', '-----'),
  'github-token': j('gh', 'p_', rnd(36)),
  'npm-token': j('np', 'm_', rnd(36)),
  'github-packages-registry': j('registry=https://npm', '.pkg.', 'github.com'),
  'private-package': j('backstage-plugins', '-', 'workflow'),
  'local-user-name': j('home/', 'kw', 'kev', '/'),
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

for (const [rule, text] of Object.entries(samples)) {
  test(`rule ${rule} catches its sample`, () => {
    const hits = scanText(text, 'sample', RULES).map(f => f.rule);
    assert.ok(hits.includes(rule), `expected ${rule}, got ${hits.join(',')}`);
  });
}

test('clean text passes', () => {
  const clean = [
    '@kwkevinchan/backstage-plugin-temporal',
    'https://registry.npmjs.org',
    '/home/runner/work',
    'npm_config_cache',
    'C:Users is not a path',
  ].join('\n');
  assert.deepEqual(scanText(clean, 'clean', RULES), []);
});

test('rule sources do not match themselves', () => {
  const source = RULES.map(r => r.pattern.source).join('\n');
  assert.deepEqual(scanText(source, 'rules', RULES), []);
});

test('denylist terms are matched case-insensitively and redacted', () => {
  const rules = parseDenylist(
    '# comment\nSecretProject, other.term\nre:inter?nal-\\d+\n',
  );
  assert.equal(rules.length, 3);
  const f = scanText(
    'see secretproject and OTHER.TERM and internal-42',
    'x',
    rules,
  );
  assert.deepEqual(
    f.map(x => x.rule),
    ['denylist-1', 'denylist-2', 'denylist-3'],
  );
  assert.ok(f.every(x => x.excerpt === '<redacted>'));
  assert.deepEqual(scanText('otherXterm', 'x', rules), []);
});

test('diff scan only looks at added lines', () => {
  const bad = samples['wsl-mount-path'];
  const diff = [
    '+++ b/file.txt',
    '@@ -1,2 +1,2 @@',
    `-${bad}`,
    '+fine',
    ` ${'context'}`,
    `+${bad}`,
  ].join('\n');
  const f = scanDiff(diff, RULES);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 3);
});

// End to end: run the CLI against a throwaway git repository.
const dir = mkdtempSync(join(tmpdir(), 'boundary-selftest-'));
try {
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, BOUNDARY_DENYLIST: '', HOME: dir, ...env },
    });
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'selftest');
  g('config', 'user.email', '1+selftest@users.noreply.github.com');
  writeFileSync(join(dir, 'ok.txt'), 'nothing to see\n');
  g('add', '.');
  g('commit', '-q', '-m', 'clean commit');

  test('CLI passes on a clean repository', () => {
    const r = run(['--tracked']);
    assert.equal(r.status, 0, r.stderr);
  });

  test('CLI denylist from environment fails without printing the term', () => {
    const term = j('Zebra', 'Quartz');
    writeFileSync(join(dir, 'ok.txt'), `mentions ${term.toLowerCase()}\n`);
    const r = run(['--file', 'ok.txt'], { BOUNDARY_DENYLIST: term });
    assert.equal(r.status, 1);
    assert.ok(
      !`${r.stdout}${r.stderr}`.toLowerCase().includes(term.toLowerCase()),
    );
    writeFileSync(join(dir, 'ok.txt'), 'nothing to see\n');
  });

  for (const [rule, text] of Object.entries(samples)) {
    test(`CLI fails on tracked file with ${rule}`, () => {
      writeFileSync(join(dir, 'bad.txt'), `${text}\n`);
      g('add', 'bad.txt');
      const r = run(['--tracked']);
      assert.equal(r.status, 1, `expected failure for ${rule}`);
      assert.match(r.stderr, new RegExp(`\\[${rule}\\]`));
      const s = run(['--staged']);
      assert.equal(s.status, 1, `expected staged failure for ${rule}`);
      g('rm', '-q', '--cached', 'bad.txt');
    });
  }

  test('CLI range scan catches commit messages and non-noreply emails', () => {
    g(
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `touch ${samples['wsl-mount-path']}`,
    );
    let r = run(['--range', 'HEAD~1..HEAD']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[wsl-mount-path\]/);
    g(
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'clean',
      '--author',
      'X <x@example.com>',
    );
    r = run(['--range', 'HEAD~1..HEAD']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\[non-noreply-email\]/);
  });

  test('CLI message file check', () => {
    const msg = join(dir, 'MSG');
    writeFileSync(msg, `subject\n\n${samples['private-package']}\n`);
    assert.equal(run(['--message-file', msg]).status, 1);
    writeFileSync(msg, 'subject\n# ignored comment line\n');
    assert.equal(run(['--message-file', msg]).status, 0);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`check-boundaries self test: ${passed} passed`);
