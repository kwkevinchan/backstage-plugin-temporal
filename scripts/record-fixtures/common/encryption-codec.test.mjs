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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEncryptionCodec } from './encryption-codec.mjs';

// Stands in for the protobuf `Payload` class so the test needs no packages:
// the codec only calls `Payload.encode(p).finish()` and `Payload.decode(bytes)`.
const TextPayload = {
  encode: payload => ({ finish: () => Buffer.from(String(payload.text)) }),
  decode: bytes => ({ text: Buffer.from(bytes).toString('utf8') }),
};

test('round-trips a payload and tags it as encrypted', async () => {
  const codec = createEncryptionCodec({ Payload: TextPayload });
  const [encrypted] = await codec.encode([{ text: 'S3CR3T-hello' }]);
  assert.equal(
    Buffer.from(encrypted.metadata.encoding).toString(),
    'binary/encrypted',
  );
  assert.equal(
    Buffer.from(encrypted.metadata['encryption-key-id']).toString(),
    'test-key-id',
  );
  assert.ok(!Buffer.from(encrypted.data).includes('S3CR3T-hello'));
  const [decoded] = await codec.decode([encrypted]);
  assert.equal(decoded.text, 'S3CR3T-hello');
});

test('decrypts a payload of the committed codec fixture', async () => {
  const file = new URL(
    '../../../test-fixtures/event-groups/codec-loop.json',
    import.meta.url,
  );
  const history = JSON.parse(readFileSync(file, 'utf8'));
  const started = history.events[0];
  const input =
    started.workflowExecutionStartedEventAttributes.input.payloads[0];
  const codec = createEncryptionCodec({ Payload: TextPayload });
  const [decoded] = await codec.decode([
    {
      metadata: Object.fromEntries(
        Object.entries(input.metadata).map(([k, v]) => [
          k,
          Buffer.from(v, 'base64'),
        ]),
      ),
      data: Buffer.from(input.data, 'base64'),
    },
  ]);
  // The decrypted bytes are a serialized `Payload`: metadata plus JSON data.
  assert.match(decoded.text, /json\/plain/);
  assert.match(decoded.text, /"topic"/);
});
