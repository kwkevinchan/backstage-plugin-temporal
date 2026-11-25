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

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLIENT_EVENT_ATTRS = new Set([
  'workflowExecutionStartedEventAttributes',
  'workflowExecutionSignaledEventAttributes',
  'workflowExecutionCancelRequestedEventAttributes',
]);

const SKIP_RECURSE_KEYS = new Set(['payloads', 'data', 'metadata']);

function sanitizeNode(value, inClientAttrs, options) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeNode(item, inClientAttrs, options));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SKIP_RECURSE_KEYS.has(key)) {
      out[key] = raw;
      continue;
    }
    if (key === 'identity' && typeof raw === 'string' && raw.length > 0) {
      out[key] = inClientAttrs ? 'client' : 'worker@host';
      continue;
    }
    if (key === 'stackTrace' && typeof raw === 'string' && raw.length > 0) {
      out[key] = raw.split(/\r?\n/, 1)[0];
      continue;
    }
    const childClient = inClientAttrs || CLIENT_EVENT_ATTRS.has(key);
    out[key] = sanitizeNode(raw, childClient, options);
  }

  if (
    options.workflowType &&
    out.workflowType &&
    typeof out.workflowType.name === 'string'
  ) {
    out.workflowType = { ...out.workflowType, name: options.workflowType };
  }
  if (
    options.taskQueue &&
    out.taskQueue &&
    typeof out.taskQueue.name === 'string'
  ) {
    out.taskQueue = { ...out.taskQueue, name: options.taskQueue };
  }
  if (
    typeof out.workflowId === 'string' &&
    options.renameWorkflowIds &&
    options.renameWorkflowIds[out.workflowId]
  ) {
    out.workflowId = options.renameWorkflowIds[out.workflowId];
  }
  if (
    out.workflowType &&
    typeof out.workflowType.name === 'string' &&
    options.renameChildTypes &&
    options.renameChildTypes[out.workflowType.name]
  ) {
    out.workflowType = {
      ...out.workflowType,
      name: options.renameChildTypes[out.workflowType.name],
    };
  }
  return out;
}

/**
 * Sanitizes an exported `temporal workflow show --output json` history object:
 * - replaces client `identity` fields with `client` and worker `identity`
 *   fields with `worker@host`;
 * - truncates every failure `stackTrace` to its first line (stripping local
 *   file paths);
 * - optionally renames `workflowType`, `taskQueue`, child workflow types, and
 *   workflow IDs;
 * - leaves all encoded payload subtrees untouched.
 */
export function sanitizeHistory(history, options = {}) {
  if (!history || !Array.isArray(history.events)) {
    throw new Error('Expected an object with an `events` array.');
  }
  return {
    ...history,
    events: history.events.map(event => {
      const sanitized = sanitizeNode(event, false, options);
      // Do not overwrite child initiation `workflowType` with the parent `--workflow-type`.
      if (
        options.workflowType &&
        event.startChildWorkflowExecutionInitiatedEventAttributes?.workflowType
          ?.name &&
        sanitized.startChildWorkflowExecutionInitiatedEventAttributes
          ?.workflowType
      ) {
        const orig =
          event.startChildWorkflowExecutionInitiatedEventAttributes.workflowType
            .name;
        const mapped = options.renameChildTypes?.[orig] ?? orig;
        sanitized.startChildWorkflowExecutionInitiatedEventAttributes.workflowType =
          {
            ...sanitized.startChildWorkflowExecutionInitiatedEventAttributes
              .workflowType,
            name: mapped,
          };
      }
      return sanitized;
    }),
  };
}

function parseArgs(argv) {
  const opts = {
    renameWorkflowIds: {},
    renameChildTypes: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.inFile = argv[++i];
    else if (arg === '--out') opts.outFile = argv[++i];
    else if (arg === '--workflow-type') opts.workflowType = argv[++i];
    else if (arg === '--task-queue') opts.taskQueue = argv[++i];
    else if (arg === '--rename-workflow-id') {
      const pair = argv[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0)
        opts.renameWorkflowIds[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--rename-child-type') {
      const pair = argv[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) opts.renameChildTypes[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        'Usage: node sanitize.mjs [--in file.json] [--out file.json]',
        '  [--workflow-type name] [--task-queue name]',
        '  [--rename-workflow-id old=new] [--rename-child-type old=new]',
      ].join('\n'),
    );
    process.exit(0);
  }
  const input = opts.inFile
    ? readFileSync(opts.inFile, 'utf8')
    : readFileSync(0, 'utf8');
  const sanitized = sanitizeHistory(JSON.parse(input), opts);
  const text = `${JSON.stringify(sanitized, null, 2)}\n`;
  if (opts.outFile) {
    writeFileSync(opts.outFile, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
}
