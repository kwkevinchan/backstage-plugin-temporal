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

async function checkSource(poll) {
  return { source: poll.source, round: poll.round, changes: 0 };
}

/** One activity per stage of pipelineWorkflow. */
const pipelineStages = Object.fromEntries(
  [
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
  ].map(stage => [
    stage,
    async build => {
      await new Promise(r => setTimeout(r, 200));
      return { stage, build: build.buildId, ok: true };
    },
  ]),
);

/** About 1 MB of JSON rows: stored in S3, shown as a preview. */
async function buildReport(request) {
  const rows = [];
  for (let i = 0; i < 12000; i++) {
    rows.push({
      id: i,
      sku: `SKU-${String(i % 997).padStart(4, '0')}`,
      quantity: (i * 7) % 13,
      note: 'example row for the large payload demo',
    });
  }
  return { reportId: request.reportId, generatedRows: rows.length, rows };
}

/** About 180 KiB of JSON: stored in S3, small enough to show inline. */
async function summarizeReport(report) {
  return {
    reportId: report.reportId,
    totals: Array.from({ length: 3500 }, (_, i) => ({
      sku: `SKU-${String(i).padStart(4, '0')}`,
      total: (i * 31) % 1000,
      label: 'summary line',
    })),
  };
}

const { deflateSync } = require('node:zlib');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * A 480x360 PNG chart with some noise, so it does not compress below the
 * codec threshold. Returned as bytes (binary/plain payload).
 */
async function renderChart() {
  const width = 480;
  const height = 360;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 1;
  const noise = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) % 64;
  };
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const bar = Math.floor(x / 60);
      const top = height - 40 - ((bar * 53) % 260);
      const inBar = y > top && x % 60 > 10;
      const i = row + 1 + x * 3;
      raw[i] = inBar ? 30 + noise() : 190 + noise();
      raw[i + 1] = inBar ? 90 + noise() : 190 + noise();
      raw[i + 2] = inBar ? 180 + noise() : 190 + noise();
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/*
 * A fake "LLM" for the loop examples: answers from the round and a seed,
 * so the same request gives the same rounds.
 */
async function llmDraft(request) {
  const revision = request.feedback ? ` (revised: ${request.feedback})` : '';
  return `Draft ${request.round} about ${request.topic}${revision}`;
}

async function llmReview(request) {
  const score =
    Math.round(
      Math.min(1, 0.3 + 0.15 * request.round + 0.02 * request.seed) * 100,
    ) / 100;
  return {
    score,
    feedback: score < 0.8 ? `make round ${request.round + 1} shorter` : 'ok',
  };
}

async function llmRefine(request) {
  return {
    text: `${request.document} v${request.round}`,
    score: Math.round((1 - 1 / (request.round + 1)) * 100) / 100,
  };
}

async function publishDraft(request) {
  return {
    url: `https://example.com/drafts/${encodeURIComponent(request.topic)}`,
  };
}

module.exports = {
  ...pipelineStages,
  ...require('./agentActivities'),
  ...require('./zigflowActivities'),
  llmDraft,
  llmReview,
  llmRefine,
  publishDraft,
  buildReport,
  summarizeReport,
  renderChart,
  checkSource,
  reserveStock,
  chargeCard,
  deploy,
  waitForUpstream,
  pickItems,
  printLabel,
  bookCourier,
  sendEmail,
};
