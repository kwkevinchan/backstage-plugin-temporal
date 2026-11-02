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
 * Starts example workflows on the `backstage-example` task queue and
 * runs a worker until the finished ones are done:
 *
 *   - orderWorkflow       completes
 *   - paymentWorkflow     fails, with a cause chain
 *   - deploymentWorkflow  stays running, with a pending activity that retries
 *   - fulfillmentWorkflow completes, with parallel activities, retries, a
 *                         timer and a child workflow (notifyCustomerWorkflow)
 *   - approvalWorkflow    stays running, waiting for an `approve` update
 *                         for at most a day
 *   - pipelineWorkflow    completes after twelve stages, with a patch marker
 *                         before each stage
 *   - pollWorkflow        continues as new three times, then completes
 *   - draftReviewWorkflow a fake AI loop (draft, review, revise) with loop
 *                         markers: done in round 4 of at most 5
 *   - longRefineWorkflow  a loop of 25 rounds that continues as new every
 *                         10 rounds (three runs)
 *   - reportWorkflow      completes with large outputs stored in S3 (only
 *                         when PAYLOAD_S3_ENDPOINT is set)
 *
 * Environment: TEMPORAL_ADDRESS (default localhost:7233), TEMPORAL_NAMESPACE
 * (default `default`), ENTITY_REF_ATTRIBUTE (default BackstageEntityRef; set
 * to an empty string when the search attribute is not registered). The
 * approval workflow sets the ApprovalPending attribute (Bool) when it is
 * registered.
 *
 * S3 payloads (optional): PAYLOAD_S3_ENDPOINT (for example
 * http://localhost:9100), PAYLOAD_S3_BUCKET (default temporal-payloads),
 * PAYLOAD_S3_REGION, PAYLOAD_S3_ACCESS_KEY, PAYLOAD_S3_SECRET_KEY. When the
 * endpoint is set, the client and the worker use the S3 payload codec and
 * the bucket is created when it is missing.
 */
const { Client, Connection } = require('@temporalio/client');
const { NativeConnection, Worker } = require('@temporalio/worker');
const activities = require('./activities');
const { payloadStorage } = require('./payloads');

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
  // The TemporalWorkflow entities example-order-workflow and
  // example-payment-workflow (examples/entities.yaml) match these runs by
  // workflow type and task queue. Two orders give the statistics card more
  // than one run.
  return Promise.all([
    client.workflow.start('orderWorkflow', {
      ...common,
      workflowId: `example-order-${suffix}`,
      args: [{ orderId: `order-${suffix}`, sku: 'BOOK-1', quantity: 2 }],
    }),
    client.workflow.start('orderWorkflow', {
      ...common,
      workflowId: `example-order-${suffix}-b`,
      args: [{ orderId: `order-${suffix}-b`, sku: 'PEN-2', quantity: 1 }],
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
    client.workflow.start('fulfillmentWorkflow', {
      ...common,
      workflowId: `example-fulfillment-${suffix}`,
      args: [
        {
          orderId: `order-${suffix}-f`,
          items: ['BOOK-1', 'PEN-2'],
          email: 'customer@example.com',
        },
      ],
    }),
    client.workflow.start('pipelineWorkflow', {
      ...common,
      workflowId: `example-pipeline-${suffix}`,
      args: [{ buildId: `build-${suffix}`, commit: 'abc1234' }],
    }),
    client.workflow.start('pollWorkflow', {
      ...common,
      workflowId: `example-poll-${suffix}`,
      args: [{ source: 'inventory-feed', rounds: 4 }],
    }),
    client.workflow.start('draftReviewWorkflow', {
      ...common,
      workflowId: `example-draft-review-${suffix}`,
      args: [{ topic: 'release notes', seed: 1, maxRounds: 5 }],
    }),
    client.workflow.start('longRefineWorkflow', {
      ...common,
      workflowId: `example-long-refine-${suffix}`,
      args: [{ document: 'design doc', totalRounds: 25, every: 10 }],
    }),
  ]);
}

/** Starts the approval workflow, with ApprovalPending when registered. */
async function startApproval(client, withSearchAttributes) {
  const suffix = Date.now().toString(36);
  const base =
    withSearchAttributes && entityRefAttribute
      ? { [entityRefAttribute]: [entityRef] }
      : {};
  const options = {
    taskQueue,
    workflowId: `example-approval-${suffix}`,
    args: [{ requestId: `req-${suffix}`, amount: 1200 }],
  };
  try {
    return await client.workflow.start('approvalWorkflow', {
      ...options,
      searchAttributes: { ...base, ApprovalPending: [true] },
    });
  } catch (err) {
    console.warn(
      `Could not start with search attribute ApprovalPending (${err.message}); starting without it`,
    );
    return client.workflow.start('approvalWorkflow', {
      ...options,
      searchAttributes: Object.keys(base).length > 0 ? base : undefined,
    });
  }
}

async function main() {
  const storage = await payloadStorage();
  const dataConverter = storage?.dataConverter;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace, dataConverter });

  let handles;
  try {
    handles = await startAll(client, true);
    handles.withSearchAttributes = true;
  } catch (err) {
    if (!entityRefAttribute) throw err;
    console.warn(
      `Could not start with search attribute ${entityRefAttribute} (${err.message}); starting without it`,
    );
    handles = await startAll(client, false);
    handles.withSearchAttributes = false;
  }
  const [
    order,
    secondOrder,
    payment,
    deployment,
    fulfillment,
    pipelineRun,
    poll,
    draftReview,
    longRefine,
  ] = handles;
  const approval = await startApproval(client, handles.withSearchAttributes);
  const report = storage
    ? await client.workflow.start('reportWorkflow', {
        taskQueue,
        workflowId: `example-report-${Date.now().toString(36)}`,
        args: [{ reportId: 'weekly-sales' }],
        searchAttributes:
          handles.withSearchAttributes && entityRefAttribute
            ? { [entityRefAttribute]: [entityRef] }
            : undefined,
      })
    : undefined;
  for (const h of [...handles, approval, ...(report ? [report] : [])])
    console.log(`Started ${h.workflowId}`);

  const workerConnection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    dataConverter,
  });

  await worker.runUntil(async () => {
    for (const o of [order, secondOrder]) {
      console.log(`orderWorkflow result: ${JSON.stringify(await o.result())}`);
    }
    await payment.result().then(
      () => console.log('paymentWorkflow unexpectedly succeeded'),
      err =>
        console.log(
          `paymentWorkflow failed as expected: ${err.cause?.message}`,
        ),
    );
    console.log(
      `fulfillmentWorkflow result: ${JSON.stringify(
        await fulfillment.result(),
      )}`,
    );
    console.log(
      `pipelineWorkflow result: ${JSON.stringify(await pipelineRun.result())}`,
    );
    if (report) {
      console.log(
        `reportWorkflow result: ${JSON.stringify(await report.result())}`,
      );
    }
    // Follows the runs of the workflow ID to the last one.
    console.log(`pollWorkflow result: ${JSON.stringify(await poll.result())}`);
    console.log(
      `draftReviewWorkflow result: ${JSON.stringify(
        await draftReview.result(),
      )}`,
    );
    console.log(
      `longRefineWorkflow result: ${JSON.stringify(await longRefine.result())}`,
    );
    // A comment on the approval; the workflow keeps waiting for approval.
    await approval.signal('comment', 'Please check the amount');
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
