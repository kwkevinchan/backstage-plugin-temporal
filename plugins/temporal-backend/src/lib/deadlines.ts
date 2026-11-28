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

/**
 * How long the backend waits for one call to Temporal, in milliseconds. The
 * client has no deadline of its own: without one, a call to a server that
 * does not answer waits for ever.
 */
export const TEMPORAL_DEADLINES = {
  /** One read: a describe, a page of history, a schedule's describe. */
  read: 10_000,
  /** A list or a count, with every page the list reads. */
  list: 15_000,
  /** A signal, cancel, terminate, start, or a schedule's pause, unpause or trigger. */
  operation: 10_000,
  /**
   * A query of the user. The server gives up on a query that no worker
   * answers after 30 seconds (`DEADLINE_EXCEEDED`); this is a little
   * longer, so that the server's answer arrives first.
   */
  query: 35_000,
  /**
   * The send of an update, and each poll for its outcome, each on its own.
   * The server answers each of them after at most 20 seconds, with the
   * update's stage when it is not finished yet.
   */
  update: 30_000,
  /**
   * A custom action, with every call its client makes. An action extends
   * it for its own calls with `connection.withDeadline`, which replaces the
   * deadline for the calls made inside it.
   */
  action: 60_000,
} as const;
