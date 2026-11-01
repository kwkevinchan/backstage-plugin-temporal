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
 * Boundary scanner: keeps local paths, credentials, private registries and
 * other non-public material out of this public repository.
 *
 * Usage:
 *   node scripts/check-boundaries.mjs                 # all tracked files (default)
 *   node scripts/check-boundaries.mjs --staged        # staged changes (pre-commit)
 *   node scripts/check-boundaries.mjs --range A..B    # added lines + commit messages + authors in a range
 *   node scripts/check-boundaries.mjs --message-file F  # a commit message (commit-msg hook)
 *   node scripts/check-boundaries.mjs --file F...     # arbitrary files (used by the self test)
 *
 * Optional extra terms (a "denylist") are read from the BOUNDARY_DENYLIST
 * environment variable, or from ~/.config/boundary/denylist.txt. One term per
 * line (commas also separate terms), `#` starts a comment, matching is
 * case-insensitive. A line starting with `re:` is a regular expression.
 * The denylist itself never belongs in this repository, and matched denylist
 * terms are never printed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Patterns are written so that their own source text does not match them.
export const RULES = [
  {
    id: 'windows-user-path',
    description: 'Windows user profile path',
    pattern: /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}/gi,
  },
  {
    id: 'wsl-mount-path',
    description: 'WSL drive mount path',
    pattern: /\/mnt\/[a-z]\//g,
  },
  {
    id: 'private-key',
    description: 'Private key block',
    pattern: /-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-{5}/g,
    redact: true,
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
    redact: true,
  },
  {
    id: 'npm-token',
    description: 'npm token',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    redact: true,
  },
  {
    id: 'github-packages-registry',
    description:
      'GitHub Packages registry (this repository publishes to npmjs only)',
    pattern: /npm\.pkg\.github\.com/gi,
  },
  {
    id: 'private-package',
    description: 'Private package or repository name',
    pattern: /backstage-plugins-workflo[w]/gi,
  },
  {
    id: 'local-user-name',
    description: 'Local user name',
    pattern: /kwke[v](?!inchan)/gi,
  },
];

const ALLOWED_EMAIL = /(?:@users\.noreply\.github\.com|^noreply@github\.com)$/i;

/** Parses denylist text into rules. Terms are never echoed. */
export function parseDenylist(text) {
  const rules = [];
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const terms = line.startsWith('re:') ? [line] : line.split(',');
    for (const t of terms) {
      const term = t.trim();
      if (!term) continue;
      n += 1;
      const source = term.startsWith('re:')
        ? term.slice(3)
        : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push({
        id: `denylist-${n}`,
        description: 'Denylisted term',
        pattern: new RegExp(source, 'gi'),
        redact: true,
        hidden: true,
      });
    }
  }
  return rules;
}

export function loadDenylist(env = process.env) {
  if (env.BOUNDARY_DENYLIST && env.BOUNDARY_DENYLIST.trim()) {
    return parseDenylist(env.BOUNDARY_DENYLIST);
  }
  const file = join(homedir(), '.config', 'boundary', 'denylist.txt');
  if (existsSync(file)) {
    return parseDenylist(readFileSync(file, 'utf8'));
  }
  return [];
}

/** Returns findings for a block of text. `where` labels the source. */
export function scanText(text, where, rules) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(line);
      if (m) {
        findings.push({
          where,
          line: i + 1,
          rule: rule.id,
          description: rule.description,
          excerpt: rule.redact ? '<redacted>' : m[0],
        });
      }
    }
  });
  return findings;
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    ...opts,
  });
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function scanTracked(rules) {
  const findings = [];
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const file of files) {
    findings.push(...scanText(file, `path:${file}`, rules));
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    if (isBinary(buf)) continue;
    findings.push(...scanText(buf.toString('utf8'), file, rules));
  }
  return { findings, count: files.length };
}

function scanFiles(files, rules) {
  const findings = [];
  for (const file of files) {
    const buf = readFileSync(file);
    if (isBinary(buf)) continue;
    findings.push(...scanText(buf.toString('utf8'), file, rules));
  }
  return { findings, count: files.length };
}

/** Scans only the added lines of a unified diff. */
export function scanDiff(diff, rules) {
  const findings = [];
  let file = '<diff>';
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ (b\/)?/, '');
      findings.push(...scanText(file, `path:${file}`, rules));
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) - 1 : 0;
      continue;
    }
    if (line.startsWith('+')) {
      lineNo += 1;
      for (const f of scanText(line.slice(1), file, rules)) {
        findings.push({ ...f, line: lineNo });
      }
    } else if (!line.startsWith('-')) {
      lineNo += 1;
    }
  }
  return findings;
}

function scanRange(range, rules) {
  const findings = [];
  const diff = git(['diff', '--no-color', '--no-ext-diff', '-U0', range]);
  findings.push(...scanDiff(diff, rules));
  const log = git(['log', '--format=%H%x00%ae%x00%ce%x00%B%x1e', range]);
  let commits = 0;
  for (const entry of log.split('\x1e')) {
    const trimmed = entry.replace(/^\n/, '');
    if (!trimmed.trim()) continue;
    commits += 1;
    const [sha, author, committer, body = ''] = trimmed.split('\0');
    const label = `commit:${sha.slice(0, 12)}`;
    findings.push(...scanText(body, `${label} message`, rules));
    for (const [role, email] of [
      ['author', author],
      ['committer', committer],
    ]) {
      findings.push(...scanText(email, `${label} ${role}`, rules));
      if (!ALLOWED_EMAIL.test(email)) {
        findings.push({
          where: `${label} ${role}`,
          line: 1,
          rule: 'non-noreply-email',
          description: 'Commit email is not a GitHub noreply address',
          excerpt: '<redacted>',
        });
      }
    }
  }
  return { findings, count: commits };
}

function report(findings, label) {
  if (findings.length === 0) {
    console.log(`check-boundaries: ${label}: OK`);
    return 0;
  }
  console.error(`check-boundaries: ${label}: ${findings.length} finding(s)`);
  for (const f of findings) {
    console.error(
      `  ${f.where}:${f.line}  [${f.rule}] ${f.description}: ${f.excerpt}`,
    );
  }
  return 1;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const rules = [...RULES, ...loadDenylist(env)];
  const extra = rules.length - RULES.length;
  const suffix = extra ? ` (+${extra} denylist terms)` : '';
  const mode = argv[0] ?? '--tracked';
  switch (mode) {
    case '--tracked': {
      const { findings, count } = scanTracked(rules);
      return report(findings, `${count} tracked files${suffix}`);
    }
    case '--staged': {
      const diff = git([
        'diff',
        '--cached',
        '--no-color',
        '--no-ext-diff',
        '-U0',
      ]);
      return report(scanDiff(diff, rules), `staged changes${suffix}`);
    }
    case '--range': {
      if (!argv[1]) throw new Error('--range needs <base>..<head>');
      const { findings, count } = scanRange(argv[1], rules);
      return report(findings, `range ${argv[1]} (${count} commits)${suffix}`);
    }
    case '--message-file': {
      if (!argv[1]) throw new Error('--message-file needs a path');
      const text = readFileSync(argv[1], 'utf8')
        .split('\n')
        .filter(l => !l.startsWith('#'))
        .join('\n');
      return report(
        scanText(text, 'commit message', rules),
        `commit message${suffix}`,
      );
    }
    case '--file': {
      const { findings, count } = scanFiles(argv.slice(1), rules);
      return report(findings, `${count} files${suffix}`);
    }
    default:
      console.error(`check-boundaries: unknown option ${mode}`);
      return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
