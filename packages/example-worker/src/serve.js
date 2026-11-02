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

// Runs the example worker until it is stopped (Ctrl+C), without starting
// workflows. Workflows started from Backstage (Start workflow, Rerun) and
// signals, updates and queries need a running worker.
const { NativeConnection, Worker } = require('@temporalio/worker');
const activities = require('./activities');
const { payloadStorage } = require('./payloads');

const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
const taskQueue = 'backstage-example';

async function main() {
  // Same data converter as `start`: the S3 payload codec when configured.
  const storage = await payloadStorage();
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    dataConverter: storage?.dataConverter,
  });
  console.log(`Worker polling ${taskQueue} on ${address}`);
  // Worker.run stops on SIGINT and SIGTERM.
  await worker.run();
  await connection.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
