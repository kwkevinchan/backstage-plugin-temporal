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

// Activities of the YAML example workflows (examples/workflows), which
// Zigflow runs. Zigflow calls them with `call: activity` on the
// backstage-example task queue, with the arguments of the YAML.
const { ApplicationFailure } = require('@temporalio/activity');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function validateOrder(order) {
  await pause(300);
  return { orderId: order?.orderId, valid: true };
}

async function packItem(item) {
  await pause(200);
  return { item, packed: true };
}

async function checkFraud(orderId) {
  await pause(400);
  return { orderId, risk: 'low' };
}

async function holdStock(items) {
  await pause(600);
  return { held: Array.isArray(items) ? items.length : 0 };
}

async function chargeOrder(orderId) {
  await pause(200);
  throw ApplicationFailure.create({
    message: `Card declined for ${orderId}`,
    type: 'CardDeclined',
    nonRetryable: true,
  });
}

async function refundOrder(orderId) {
  await pause(200);
  return { orderId, refunded: true };
}

async function bookExpressCourier(orderId) {
  await pause(300);
  return { orderId, courier: 'express', tracking: `EX-${orderId}` };
}

async function notifyCustomer(orderId) {
  await pause(200);
  return { orderId, sent: true };
}

module.exports = {
  validateOrder,
  packItem,
  checkFraud,
  holdStock,
  chargeOrder,
  refundOrder,
  bookExpressCourier,
  notifyCustomer,
};
