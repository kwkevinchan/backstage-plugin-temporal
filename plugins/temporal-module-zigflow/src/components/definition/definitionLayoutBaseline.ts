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

// Layout produced by running `buildDefinitionGraph` and `layoutSteps(...,
// { direction: 'TB' })` on `test-fixtures/definitions/every-task.yaml`.
// Written by `node scripts/zigflow-layout-baseline.mjs`.

export const definitionLayoutBaseline = {
  width: 815,
  height: 1760,
  wrapped: false,
  nodes: [
    {
      id: '#start',
      position: { x: 217, y: 16 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/0/validate',
      position: { x: 217, y: 120 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/1/route',
      position: { x: 217, y: 224 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/2/packItems',
      position: { x: 465, y: 328 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/2/packItems/do/0/pack',
      position: { x: 579, y: 432 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/3/checks',
      position: { x: 331, y: 432 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/3/checks#join',
      position: { x: 331, y: 744 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/3/checks/fork/branches/0/fraud',
      position: { x: 207, y: 640 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/3/checks/fork/branches/1/stock',
      position: { x: 455, y: 536 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/3/checks/fork/branches/1/stock/do/0/reserve',
      position: { x: 455, y: 640 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/4/waitForPayment',
      position: { x: 331, y: 848 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/5/charge',
      position: { x: 331, y: 952 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/5/charge/try/0/chargeCard',
      position: { x: 455, y: 1160 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/5/charge#catch',
      position: { x: 207, y: 1056 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/5/charge/catch/do/0/refund',
      position: { x: 207, y: 1160 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/6/cooldown',
      position: { x: 331, y: 1264 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/7/notify',
      position: { x: 331, y: 1368 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/8/summary',
      position: { x: 331, y: 1472 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/9/mystery',
      position: { x: 331, y: 1576 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/10/stop',
      position: { x: 331, y: 1680 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/11/expressShipping',
      position: { x: 16, y: 328 },
      size: { width: 220, height: 64 },
    },
    {
      id: '/do/11/expressShipping/do/0/book',
      position: { x: 16, y: 432 },
      size: { width: 220, height: 64 },
    },
    {
      id: '#end',
      position: { x: 16, y: 536 },
      size: { width: 220, height: 64 },
    },
  ],
};
