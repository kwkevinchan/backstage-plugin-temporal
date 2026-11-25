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

const {
  createEventGroup,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} = require('@temporalio/workflow');

const { draft, notify } = proxyActivities({
  startToCloseTimeout: '10 seconds',
});

const reviewWithSummary = summary =>
  proxyActivities({ startToCloseTimeout: '10 seconds', summary }).review;

const hintSignal = defineSignal('hint');

/** SDK 1.24 `createEventGroup(label, { id })` nested loop with signal handler. */
async function groupLoop() {
  let latestHint = '';
  setHandler(hintSignal, async message => {
    latestHint = message;
    await notify({ message: `收到提示：${message}` });
  });

  const loop = createEventGroup('Loop draft-review', {
    id: 'loop:draft-review',
  });
  let feedback;
  await loop.withScope(async () => {
    for (let round = 1; round <= 3; round += 1) {
      const roundGroup = createEventGroup(`draft-review · round ${round}`, {
        id: `loop:draft-review:${round}`,
      });
      await roundGroup.withScope(async () => {
        await draft({ topic: 'Event Groups 範例', round, feedback });
        await sleep('2 seconds');
        const suffix = feedback ? `（改：${feedback}）` : '';
        feedback = await reviewWithSummary(`review round ${round}`)({
          text: `第 ${round} 版：Event Groups 範例${suffix}`,
          round,
          ...(latestHint ? { hint: latestHint } : {}),
        });
      });
    }
  });

  const wrapUp = createEventGroup('Wrap-up', { id: 'wrap-up' });
  await proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [wrapUp],
  }).notify({ message: '完成，3 輪' });
  await notify({ message: '沒有群組的步驟' });
  return 'ok';
}

/** SDK 1.24 group without explicit ID: the SDK derives a 40-char hex hash ID. */
async function groupWithoutId() {
  const group = createEventGroup('Group without id');
  await group.withScope(async () => {
    await notify({ message: 'no id' });
  });
  return 'ok';
}

module.exports = { groupLoop, groupWithoutId };
