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

const { ApplicationFailure, Context } = require('@temporalio/activity');

async function reserveStock(order) {
  return { sku: order.sku, quantity: order.quantity, warehouse: 'example-1' };
}

async function chargeCard(payment) {
  throw ApplicationFailure.create({
    message: `Card ending ${payment.cardLast4} was declined`,
    type: 'CardDeclined',
    nonRetryable: true,
    details: [{ code: 'insufficient_funds' }],
  });
}

async function deploy(deployment) {
  return { environment: deployment.environment, version: deployment.version };
}

async function waitForUpstream(deployment) {
  throw ApplicationFailure.create({
    message: `Upstream service for ${deployment.environment} is not ready`,
    type: 'UpstreamNotReady',
  });
}

async function pickItems(order) {
  await new Promise(r => setTimeout(r, 1500));
  return { orderId: order.orderId, picked: order.items.length };
}

async function printLabel(order) {
  await new Promise(r => setTimeout(r, 1000));
  return { orderId: order.orderId, label: `LBL-${order.orderId}` };
}

/** Fails on the first two attempts, so the step shows its retries. */
async function bookCourier(order) {
  const { attempt } = Context.current().info;
  if (attempt < 3) {
    throw ApplicationFailure.create({
      message: `Courier API busy (attempt ${attempt})`,
      type: 'CourierBusy',
    });
  }
  return { orderId: order.orderId, courier: 'example-post', attempt };
}

async function sendEmail(notice) {
  return { to: notice.email, subject: `Order ${notice.orderId} shipped` };
}

module.exports = {
  reserveStock,
  chargeCard,
  deploy,
  waitForUpstream,
  pickItems,
  printLabel,
  bookCourier,
  sendEmail,
};
