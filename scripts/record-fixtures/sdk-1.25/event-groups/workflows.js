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
  continueAsNew,
  createEventGroup,
  defineSignal,
  executeChild,
  proxyActivities,
  proxyLocalActivities,
  setHandler,
  sleep,
} = require('@temporalio/workflow');

const { draft, review, notify, slowStep } = proxyActivities({
  startToCloseTimeout: '10 seconds',
});

const { localStep } = proxyLocalActivities({
  startToCloseTimeout: '10 seconds',
});

const hintSignal = defineSignal('hint');

/**
 * NOTE on @temporalio/workflow@1.24 vs @temporalio/workflow@1.25 `proxyActivities`:
 * verify whether `review(input, options)` works or only activity options are at
 * `proxyActivities`. Wait — `proxyActivities` takes ActivityOptions once; OR in
 * Temporal SDK `summary` is passed on `proxyActivities` unless `summary` per
 * call or separate proxy is used! Let's use per-call summary helper with
 * proxyActivities({ startToCloseTimeout: '10 seconds', summary })!
 */
const reviewWithSummary = summary =>
  proxyActivities({ startToCloseTimeout: '10 seconds', summary }).review;

/** SDK 1.25 `createEventGroup(id, { label })` nested loop (and codec variant). */
async function groupLoop() {
  let latestHint = '';
  setHandler(hintSignal, async message => {
    latestHint = message;
    await notify({ message: `收到提示：${message}` });
  });

  const loop = createEventGroup('loop:draft-review', {
    label: 'Loop draft-review',
  });
  let feedback;
  await loop.withScope(async () => {
    for (let round = 1; round <= 3; round += 1) {
      const roundGroup = createEventGroup(`loop:draft-review:${round}`, {
        label: `draft-review · round ${round}`,
      });
      await roundGroup.withScope(async () => {
        await draft({ topic: 'Event Groups 範例', round, feedback });
        await sleep('2 seconds');
        const suffix = feedback ? `（改：${feedback}）` : '';
        const callReview = reviewWithSummary(`review round ${round}`);
        feedback = await callReview({
          text: `第 ${round} 版：Event Groups 範例${suffix}`,
          round,
          ...(latestHint ? { hint: latestHint } : {}),
        });
      });
    }
  });

  const wrapUp = createEventGroup('wrap-up', { label: 'Wrap-up' });
  await proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [wrapUp],
  }).notify({ message: '完成，3 輪' });
  await notify({ message: '沒有群組的步驟' });
  return 'ok';
}

/** Loop in one outer group without nested round groups. */
async function flatGroup() {
  const flat = createEventGroup('loop:flat', { label: 'Loop flat' });
  await flat.withScope(async () => {
    for (let round = 1; round <= 3; round += 1) {
      await draft({ topic: 'flat', round });
      await review({ text: `第 ${round} 版：flat`, round });
    }
  });
  return 'ok';
}

/** Parallel scopes, nested scopes, and steps tagged with option groups. */
async function parallelGroups() {
  const a = createEventGroup('par:a', { label: 'Parallel A' });
  const sub = createEventGroup('par:a:sub', { label: 'Nested in A' });
  const b = createEventGroup('par:b', { label: 'Parallel B' });
  const tagX = createEventGroup('tag:x', { label: 'Tag X' });
  const tagY = createEventGroup('tag:y', { label: 'Tag Y' });

  await Promise.all([
    a.withScope(async () => {
      await slowStep({ name: 'a1', ms: 300 });
      await sub.withScope(() => slowStep({ name: 'a-sub-1', ms: 100 }));
      await slowStep({ name: 'a2', ms: 300 });
    }),
    b.withScope(async () => {
      await slowStep({ name: 'b1', ms: 100 });
      await sleep(200);
      await slowStep({ name: 'b2', ms: 500 });
    }),
  ]);

  await proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [tagX, tagY],
  }).slowStep({ name: 'x-and-y', ms: 10 });
  await proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [tagY],
  }).slowStep({ name: 'y-only', ms: 10 });
  await proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [a, tagX],
  }).slowStep({ name: 'a-and-x', ms: 10 });
  return 'ok';
}

/** Ambiguous overlapping/shared option groups across steps. */
async function ambiguousGroups() {
  const ambA = createEventGroup('amb:a', { label: 'A' });
  const ambZ = createEventGroup('amb:z', { label: 'Z' });
  const ambP = createEventGroup('amb:p', { label: 'P' });
  const ambQ = createEventGroup('amb:q', { label: 'Q' });

  await ambA.withScope(async () => {
    await slowStep({ name: 'a-1', ms: 10 });
    await proxyActivities({
      startToCloseTimeout: '10 seconds',
      eventGroups: [ambZ],
    }).slowStep({ name: 'a-2-and-z', ms: 10 });
  });

  const pqActivities = proxyActivities({
    startToCloseTimeout: '10 seconds',
    eventGroups: [ambP, ambQ],
  });
  await pqActivities.slowStep({ name: 'p-and-q-1', ms: 10 });
  await pqActivities.slowStep({ name: 'p-and-q-2', ms: 10 });
  return 'ok';
}

/** Child workflow invoked inside a parent loop and via `eventGroups` option. */
async function childWithGroup({ round }) {
  await notify({ message: `子流程，第 ${round} 輪` });
  const own = createEventGroup('child:own', { label: 'Child own group' });
  await own.withScope(async () => {
    await notify({ message: '子流程自己的群組' });
  });
  return { round };
}

/** Local activity + child workflows inside and via option event groups. */
async function groupsWithChildren({
  childIdPrefix = 'event-groups-child',
} = {}) {
  const outer = createEventGroup('loop:child', { label: 'Loop child' });
  await outer.withScope(async () => {
    const r1 = createEventGroup('loop:child:1', { label: 'child · round 1' });
    await r1.withScope(() => draft({ topic: 'child', round: 1 }));

    const r2 = createEventGroup('loop:child:2', { label: 'child · round 2' });
    await r2.withScope(async () => {
      await draft({ topic: 'child', round: 2 });
      await localStep({ round: 2 });
      await executeChild(childWithGroup, {
        workflowId: `${childIdPrefix}.child-2`,
        args: [{ round: 2 }],
      });
    });
  });

  const extra = createEventGroup('extra:child-option', {
    label: 'child via option',
  });
  await executeChild(childWithGroup, {
    workflowId: `${childIdPrefix}.child-opt`,
    args: [{ round: 99 }],
    eventGroups: [extra],
  });
  return 'ok';
}

/** Unlabeled (`labelBytes: 0`) or long-labeled (`labelBytes: 4000`) event group. */
async function labelSizes({ labelBytes = 0 } = {}) {
  const group =
    labelBytes > 0
      ? createEventGroup(`label-${labelBytes}`, {
          label: 'a'.repeat(labelBytes),
        })
      : createEventGroup('label-0');
  await group.withScope(() => notify({ message: `label ${labelBytes} bytes` }));
  return 'ok';
}

/** Loop that continues as new after `perRun` rounds within `loop:can`. */
async function continueAsNewGroups({
  nextRound = 1,
  maxRounds = 5,
  perRun = 2,
} = {}) {
  const loop = createEventGroup('loop:can', { label: 'Loop can' });
  let round = nextRound;
  await loop.withScope(async () => {
    const end = Math.min(maxRounds, nextRound + perRun - 1);
    for (; round <= end; round += 1) {
      const rg = createEventGroup(`loop:can:${round}`, {
        label: `can · round ${round}`,
      });
      await rg.withScope(async () => {
        await draft({ topic: 'can', round });
        await sleep('1 second');
      });
    }
    if (round <= maxRounds) {
      await continueAsNew({ nextRound: round, maxRounds, perRun });
    }
  });
  return 'ok';
}

module.exports = {
  groupLoop,
  flatGroup,
  parallelGroups,
  ambiguousGroups,
  childWithGroup,
  groupsWithChildren,
  labelSizes,
  continueAsNewGroups,
};
