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

/*
 * Starts runs of the YAML example workflow order-fulfillment
 * (examples/workflows/order-fulfillment.yaml), which Zigflow runs on the
 * backstage-zigflow task queue, and runs the worker of its activities
 * (backstage-example) until they are done:
 *
 *   - an express order: completes; the card is declined and refunded, an
 *     express courier is booked (switch target, a child workflow)
 *   - an order without payment: fails when nobody sends paymentReceived
 *
 * Needs a Zigflow worker with the files of examples/workflows, for example:
 *
 *   docker run --rm --network host -e TEMPORAL_ADDRESS=localhost:7233 \
 *     -e DISABLE_TELEMETRY=true -e CONVERT_FAILURE_DATA=false \
 *     -e WORKFLOW_FILE= -e WORKFLOW_DIRECTORY=/app/workflows \
 *     -v "$PWD/examples/workflows:/app/workflows:ro" \
 *     ghcr.io/zigflow/zigflow:0.18.0-core run
 */
const { Client, Connection } = require('@temporalio/client');
const { NativeConnection, Worker } = require('@temporalio/worker');
const activities = require('./activities');

const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
const zigflowQueue = 'backstage-zigflow';
const activityQueue = 'backstage-example';

async function main() {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  const suffix = Date.now().toString(36);
  const express = await client.workflow.start('order-fulfillment', {
    taskQueue: zigflowQueue,
    workflowId: `example-yaml-order-${suffix}`,
    args: [
      {
        orderId: `order-${suffix}`,
        items: ['BOOK-1', 'PEN-2', 'MUG-3'],
        express: true,
      },
    ],
  });
  const unpaid = await client.workflow.start('order-fulfillment', {
    taskQueue: zigflowQueue,
    workflowId: `example-yaml-unpaid-${suffix}`,
    args: [{ orderId: `order-${suffix}-u`, items: ['BOOK-1'], express: false }],
  });
  console.log(`Started ${express.workflowId} and ${unpaid.workflowId}`);

  const workerConnection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace,
    taskQueue: activityQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });
  await worker.runUntil(async () => {
    // The payment service: a signal once the checks are done.
    await new Promise(resolve => setTimeout(resolve, 4000));
    await express.signal('paymentReceived', { amount: 42 });
    console.log(
      `order-fulfillment result: ${JSON.stringify(await express.result())}`,
    );
    await unpaid.result().then(
      () => console.log('The unpaid order unexpectedly completed'),
      err => console.log(`The unpaid order failed as expected: ${err.message}`),
    );
  });
  await workerConnection.close();
  await connection.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
