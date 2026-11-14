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

import {
  Connection,
  defaultPayloadConverter,
  Payload,
  ScheduleClient,
} from '@temporalio/client';
import { decodeJsonPayloads, encodeJsonPayloads } from './payloads';

/**
 * A schedule client of a namespace that reads the schedules with payloads
 * it cannot decode, too. Only for reading and for patches (pause, unpause,
 * trigger): a schedule's memo and action arguments are decoded by the client
 * whether or not the plugin shows them, so one schedule encoded by a payload
 * codec (encryption, compression) would fail every list and operation. Its
 * codec turns a payload the default converter cannot read into its
 * description (`{ encoding, size, undecodable: true }`, like the payloads of
 * workflows).
 *
 * Writing is refused: `update()` and `create()` would write the descriptions
 * back in place of the user's encrypted arguments, so `encode` throws.
 *
 * The SDK decodes through `payloadCodecs` from the last to the first; a codec
 * that decodes the payloads (a Codec Server) belongs after this one in the
 * array, so that it runs before it.
 */
export function scheduleClientOf(
  connection: Connection,
  namespace: string,
): ScheduleClient {
  return new ScheduleClient({
    connection,
    namespace,
    dataConverter: {
      payloadCodecs: [
        {
          async encode() {
            throw new Error(
              'This schedule client only reads schedules and patches them; it does not write payloads',
            );
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
        },
      ],
    },
  });
}
