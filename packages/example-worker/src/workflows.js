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
  defineSignal,
  defineUpdate,
  executeChild,
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
  await condition(() => approver !== undefined);
  if (hasAttribute) upsertSearchAttributes({ ApprovalPending: [false] });
  return { request: request.requestId, approver, comments };
}

module.exports = {
  orderWorkflow,
  paymentWorkflow,
  deploymentWorkflow,
  fulfillmentWorkflow,
  notifyCustomerWorkflow,
  approvalWorkflow,
};
