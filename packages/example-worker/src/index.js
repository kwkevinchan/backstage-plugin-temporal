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
 * Starts three example workflows on the `backstage-example` task queue and
 * runs a worker until the finished ones are done:
 *
 *   - orderWorkflow       completes
 *   - paymentWorkflow     fails, with a cause chain
 *   - deploymentWorkflow  stays running, with a pending activity that retries
 *
 * Environment: TEMPORAL_ADDRESS (default localhost:7233), TEMPORAL_NAMESPACE
 * (default `default`), ENTITY_REF_ATTRIBUTE (default BackstageEntityRef; set
 * to an empty string when the search attribute is not registered).
 */
const { Client, Connection } = require('@temporalio/client');
const { NativeConnection, Worker } = require('@temporalio/worker');
const activities = require('./activities');

const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
const entityRefAttribute =
  process.env.ENTITY_REF_ATTRIBUTE ?? 'BackstageEntityRef';
const taskQueue = 'backstage-example';
const entityRef = 'component:default/example-orders';

async function startAll(client, withSearchAttributes) {
  const suffix = Date.now().toString(36);
  const searchAttributes =
    withSearchAttributes && entityRefAttribute
      ? { [entityRefAttribute]: [entityRef] }
      : undefined;
  const common = { taskQueue, searchAttributes };
  return Promise.all([
    client.workflow.start('orderWorkflow', {
      ...common,
      workflowId: `example-order-${suffix}`,
      args: [{ orderId: `order-${suffix}`, sku: 'BOOK-1', quantity: 2 }],
    }),
    client.workflow.start('paymentWorkflow', {
      ...common,
      workflowId: `example-payment-${suffix}`,
      args: [{ paymentId: `pay-${suffix}`, cardLast4: '4242', amount: 42 }],
    }),
    client.workflow.start('deploymentWorkflow', {
      ...common,
      workflowId: `example-deployment-${suffix}`,
      args: [{ environment: 'staging', version: '1.2.3' }],
    }),
  ]);
}

async function main() {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  let handles;
  try {
    handles = await startAll(client, true);
  } catch (err) {
    if (!entityRefAttribute) throw err;
    console.warn(
      `Could not start with search attribute ${entityRefAttribute} (${err.message}); starting without it`,
    );
    handles = await startAll(client, false);
  }
  const [order, payment, deployment] = handles;
  for (const h of handles) console.log(`Started ${h.workflowId}`);

  const workerConnection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  await worker.runUntil(async () => {
    console.log(
      `orderWorkflow result: ${JSON.stringify(await order.result())}`,
    );
    await payment.result().then(
      () => console.log('paymentWorkflow unexpectedly succeeded'),
      err =>
        console.log(
          `paymentWorkflow failed as expected: ${err.cause?.message}`,
        ),
    );
    // Give the running workflow time to schedule its retrying activity.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const d = await deployment.describe();
      if ((d.raw.pendingActivities ?? []).length > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`deploymentWorkflow is running: ${deployment.workflowId}`);
  });
  await workerConnection.close();
  await connection.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
