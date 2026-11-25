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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { sanitizeHistory } from '../sanitize.mjs';
import { createEncryptionCodec } from './encryption-codec.mjs';

/** Resolves the Temporal CLI binary path (`TEMPORAL_CLI`, PATH, or ~/.temporalio/bin). */
export function temporalCliPath() {
  if (process.env.TEMPORAL_CLI) return process.env.TEMPORAL_CLI;
  const local = join(process.env.HOME ?? '', '.temporalio', 'bin', 'temporal');
  return existsSync(local) ? local : 'temporal';
}

/** Parses common `--out-dir`, `--only`, and `--address` runner flags. */
export function parseRunnerArgs(argv) {
  let outDir = '/tmp/recorded-fixtures';
  let only;
  let address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') outDir = resolve(argv[++i]);
    else if (arg === '--only') only = argv[++i];
    else if (arg === '--address') address = argv[++i];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { outDir, only, address };
}

/**
 * Loads `@temporalio/client`, `@temporalio/worker`, and the bundled `Payload`
 * protobuf type from a standalone SDK directory (`sdk-1.24` or `sdk-1.25`).
 */
export function loadSdkRuntime(sdkPkgJsonUrl) {
  const sdkRequire = createRequire(sdkPkgJsonUrl);
  const clientPkg = sdkRequire('@temporalio/client');
  const workerPkg = sdkRequire('@temporalio/worker');
  const commonPkgPath = sdkRequire.resolve('@temporalio/common/package.json');
  const commonRequire = createRequire(commonPkgPath);
  const protoPkg = commonRequire('@temporalio/proto');
  return {
    sdkRequire,
    Connection: clientPkg.Connection,
    Client: clientPkg.Client,
    NativeConnection: workerPkg.NativeConnection,
    Worker: workerPkg.Worker,
    Payload: protoPkg.temporal.api.common.v1.Payload,
  };
}

/**
 * Exports a workflow run via `temporal workflow show --output json`, sanitizes
 * identities and stack traces with `sanitizeHistory`, and writes `outFile`.
 */
export function exportAndSanitize({
  address,
  workflowId,
  runId,
  outFile,
  sanitizeOptions,
}) {
  const args = [
    '--address',
    address,
    'workflow',
    'show',
    '--workflow-id',
    workflowId,
  ];
  if (runId) args.push('--run-id', runId);
  args.push('--output', 'json');

  const raw = execFileSync(temporalCliPath(), args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const sanitized = sanitizeHistory(JSON.parse(raw), sanitizeOptions);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  console.log(`Recorded ${outFile} (${sanitized.events.length} events)`);
}

/**
 * Boots an ephemeral worker for `taskQueue`, runs `run({ client, connection })`,
 * and shuts down the worker and Temporal connections cleanly.
 */
export async function runWithWorker({
  runtime,
  address,
  taskQueue,
  workflowsPath,
  activities,
  workerPlugins = [],
  clientPlugins = [],
  useCodec = false,
  run,
}) {
  const dataConverter = useCodec
    ? { payloadCodecs: [createEncryptionCodec({ Payload: runtime.Payload })] }
    : undefined;
  const nativeConn = await runtime.NativeConnection.connect({ address });
  const conn = await runtime.Connection.connect({ address });
  const client = new runtime.Client({
    connection: conn,
    dataConverter,
    plugins: clientPlugins,
  });
  const worker = await runtime.Worker.create({
    connection: nativeConn,
    namespace: 'default',
    taskQueue,
    workflowsPath,
    activities,
    dataConverter,
    plugins: workerPlugins,
  });

  const runPromise = worker.run();
  try {
    await run({ client, worker });
  } finally {
    worker.shutdown();
    await runPromise;
    await nativeConn.close();
    await conn.close();
  }
}
