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
 * The loop marker format. The format is a specification: workflows written
 * with other SDKs (Go, Python, Java) follow it by hand, and the Backstage
 * backend reads it from the history. See the README of this package.
 */

/** First path segment of a loop marker. */
export const LOOP_MARKER_PREFIX = 'loop';

/** Name of the query that returns the {@link LoopsState} of a running workflow. */
export const LOOP_STATE_QUERY = '__loop_state';

/** Memo key with the {@link LoopsState}, upserted after each round. */
export const LOOP_STATE_MEMO_KEY = 'temporal.loops';

/** Memo key of a child workflow started in a round, with its {@link LoopMarker}. */
export const LOOP_MARKER_MEMO_KEY = 'temporal.loop';

/** Version of the {@link LoopsState} format. */
export const LOOP_STATE_VERSION = 1;

/**
 * Which loop, round and step an activity or child workflow belongs to.
 *
 * @public
 */
export interface LoopMarker {
  /** Name of the loop, unique within the workflow. */
  loop: string;
  /** Round of the loop, from 1, counted across continue-as-new runs. */
  iteration: number;
  /** Name of the step in the round, for example the activity type. */
  step: string;
  /**
   * Which call of the same step in the same round, from 1. Only the second
   * and later calls carry it in the marker.
   */
  occurrence?: number;
}

const MARKER_PATTERN =
  /(?:^|\/)loop\/([^/]+)\/([1-9]\d*)\/([^/]+)(?:\/([1-9]\d*))?$/;

/**
 * The marker text `loop/<loop>/<iteration>/<step>[/<occurrence>]`. Loop and
 * step names are percent-encoded (like `encodeURIComponent`), so they may
 * contain any character.
 *
 * @public
 */
export function formatLoopMarker(marker: LoopMarker): string {
  if (!marker.loop) throw new TypeError('The loop name must not be empty');
  if (!marker.step) throw new TypeError('The step name must not be empty');
  if (!Number.isInteger(marker.iteration) || marker.iteration < 1) {
    throw new TypeError('The iteration must be an integer from 1');
  }
  const base = [
    LOOP_MARKER_PREFIX,
    encodeURIComponent(marker.loop),
    String(marker.iteration),
    encodeURIComponent(marker.step),
  ].join('/');
  return marker.occurrence && marker.occurrence > 1
    ? `${base}/${marker.occurrence}`
    : base;
}

/**
 * Reads a loop marker from an activity ID (`loop/...`) or a child workflow
 * ID that ends with one (`<anything>/loop/...`). Returns undefined for any
 * other text.
 *
 * @public
 */
export function parseLoopMarker(text: string): LoopMarker | undefined {
  const match = MARKER_PATTERN.exec(text);
  if (!match) return undefined;
  try {
    const marker: LoopMarker = {
      loop: decodeURIComponent(match[1]),
      iteration: Number(match[2]),
      step: decodeURIComponent(match[3]),
    };
    if (match[4]) marker.occurrence = Number(match[4]);
    return marker;
  } catch {
    return undefined;
  }
}
