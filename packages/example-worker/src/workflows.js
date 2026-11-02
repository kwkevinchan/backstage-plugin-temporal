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
 * Example workflows for local development. Plain JavaScript, so no build step
 * is needed; the Temporal worker bundles this file itself.
 */
const {
  proxyActivities,
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  defineUpdate,
  executeChild,
  patched,
  setHandler,
  sleep,
  upsertSearchAttributes,
  workflowInfo,
} = require('@temporalio/workflow');

const { reserveStock, chargeCard, deploy } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 2, initialInterval: '1 second' },
});

const { waitForUpstream } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  // Keeps retrying, so the workflow stays running with a pending activity.
  retry: { initialInterval: '30 seconds', backoffCoefficient: 1 },
});

/** Completes successfully. */
async function orderWorkflow(order) {
  const reservation = await reserveStock(order);
  return { orderId: order.orderId, reservation, status: 'confirmed' };
}

/** Fails with a cause chain: workflow failure -> activity failure -> card error. */
async function paymentWorkflow(payment) {
  try {
    await chargeCard(payment);
  } catch (err) {
    throw ApplicationFailure.create({
      message: `Payment ${payment.paymentId} could not be completed`,
      type: 'PaymentFailed',
      nonRetryable: true,
      cause: err,
    });
  }
  return 'paid';
}

/** Stays running: waits on an activity that keeps failing and retrying. */
async function deploymentWorkflow(deployment) {
  await deploy(deployment);
  await waitForUpstream(deployment);
  return 'deployed';
}

const { pickItems, printLabel, sendEmail } = proxyActivities({
  startToCloseTimeout: '10 seconds',
});

const { bookCourier } = proxyActivities({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5, initialInterval: '1 second' },
});

/**
 * Completes with every kind of step: two activities in parallel, an
 * activity that succeeds on its third attempt, a timer and a child
 * workflow.
 */
async function fulfillmentWorkflow(order) {
  const [picked, label] = await Promise.all([
    pickItems(order),
    printLabel(order),
  ]);
  const shipment = await bookCourier(order);
  // Wait for the courier to pick the parcel up.
  await sleep('2 seconds');
  const info = workflowInfo();
  const notice = await executeChild(notifyCustomerWorkflow, {
    workflowId: `${info.workflowId}-notify`,
    args: [{ orderId: order.orderId, email: order.email }],
    // Keeps the entity reference, so the child is listed for the same entity.
    searchAttributes: info.searchAttributes,
  });
  return { picked, label, shipment, notice };
}

/** Child workflow of fulfillmentWorkflow. */
async function notifyCustomerWorkflow(notice) {
  return sendEmail(notice);
}

const commentSignal = defineSignal('comment');
const approveUpdate = defineUpdate('approve');

/**
 * Stays running until someone approves: waits for the `approve` update and
 * records `comment` signals. Sets the ApprovalPending search attribute,
 * when it is registered, so the plugin shows "Waiting for approval".
 */
async function approvalWorkflow(request) {
  const comments = [];
  let approver;
  setHandler(commentSignal, text => {
    comments.push(text);
  });
  setHandler(
    approveUpdate,
    async by => {
      approver = by;
      return { approvedBy: by };
    },
    {
      validator: by => {
        if (!by) throw new Error('approver is required');
      },
    },
  );
  const hasAttribute =
    'ApprovalPending' in (workflowInfo().searchAttributes ?? {});
  // Waits at most a day; the open timer is the time limit of the wait.
  const approved = await condition(() => approver !== undefined, '24 hours');
  if (hasAttribute) upsertSearchAttributes({ ApprovalPending: [false] });
  if (!approved) {
    throw ApplicationFailure.create({
      message: `Request ${request.requestId} was not approved in time`,
      type: 'ApprovalTimedOut',
      nonRetryable: true,
    });
  }
  return { request: request.requestId, approver, comments };
}

/** Stages of pipelineWorkflow, one activity each. */
const PIPELINE_STAGES = [
  'checkoutSource',
  'installDependencies',
  'runLinters',
  'runUnitTests',
  'buildPackage',
  'scanDependencies',
  'buildImage',
  'pushImage',
  'deployStaging',
  'runSmokeTests',
  'deployProduction',
  'notifyTeam',
];

const pipeline = proxyActivities({ startToCloseTimeout: '10 seconds' });

/**
 * Completes after twelve stages in a row. A patch marker is recorded
 * before each stage, the way DSL runners record markers between their
 * steps; the plugin leaves markers out of the graph by default.
 */
async function pipelineWorkflow(build) {
  const results = [];
  for (const stage of PIPELINE_STAGES) {
    // Records a marker the first time each patch ID is seen.
    patched(`pipeline-${stage}`);
    results.push(await pipeline[stage](build));
  }
  return { build: build.buildId, stages: results.length };
}

const { checkSource } = proxyActivities({ startToCloseTimeout: '10 seconds' });

/**
 * Polls a source in rounds and continues as new after each round, so one
 * workflow ID has several runs. The last round completes.
 */
async function pollWorkflow(poll) {
  const round = poll.round ?? 1;
  await checkSource({ ...poll, round });
  await sleep('1 second');
  if (round < poll.rounds) {
    await continueAsNew({ ...poll, round: round + 1 });
  }
  return { source: poll.source, rounds: round };
}

const { buildReport, summarizeReport, renderChart } = proxyActivities({
  startToCloseTimeout: '30 seconds',
});

/**
 * Produces large outputs (about 1 MB of JSON, 180 KiB of JSON and a PNG).
 * With the S3 payload codec they are stored in S3 and the history keeps
 * claim checks. Started only when S3 is configured for the worker.
 */
async function reportWorkflow(request) {
  const report = await buildReport(request);
  const summary = await summarizeReport({ reportId: report.reportId });
  const chart = await renderChart();
  return {
    reportId: report.reportId,
    rows: report.generatedRows,
    summaryLines: summary.totals.length,
    chartBytes: chart.length,
  };
}

module.exports = {
  reportWorkflow,
  orderWorkflow,
  paymentWorkflow,
  deploymentWorkflow,
  fulfillmentWorkflow,
  notifyCustomerWorkflow,
  approvalWorkflow,
  pipelineWorkflow,
  pollWorkflow,
};
