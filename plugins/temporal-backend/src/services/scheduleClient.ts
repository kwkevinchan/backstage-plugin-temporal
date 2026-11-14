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

import { Connection, ScheduleClient } from '@temporalio/client';
import {
  defaultPayloadConverter,
  Payload,
  PayloadCodec,
} from '@temporalio/common';
import { decodeJsonPayloads, encodeJsonPayloads } from './payloads';

/**
 * A payload codec in front of the default data converter that turns a
 * payload the converter cannot read (binary data, or encoded by a payload
 * codec such as encryption) into its description (`{ encoding, size,
 * undecodable: true }`, like the payloads of workflows). A schedule's memo
 * and action arguments are decoded by the schedule client whether or not the
 * plugin shows them, so without this one unreadable schedule would fail
 * every list and operation. A codec that decodes them (a Codec Server) goes
 * before it.
 */
const undecodablePayloadCodec: PayloadCodec = {
  async encode(payloads) {
    return payloads;
  },
  async decode(payloads) {
    return payloads.map((payload: Payload) => {
      try {
        defaultPayloadConverter.fromPayload(payload);
        return payload;
      } catch {
        return encodeJsonPayloads([
          decodeJsonPayloads({ payloads: [payload] }) ?? null,
        ]).payloads[0] as Payload;
      }
    });
  },
};

/**
 * A schedule client of a namespace that reads the schedules with payloads
 * it cannot decode, too.
 */
export function scheduleClientOf(
  connection: Connection,
  namespace: string,
): ScheduleClient {
  return new ScheduleClient({
    connection,
    namespace,
    dataConverter: { payloadCodecs: [undecodablePayloadCodec] },
  });
}
