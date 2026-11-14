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

import { decodeJsonPayloads, encodeJsonPayloads } from './payloads';

describe('payloads', () => {
  it('round-trips JSON values like the default data converter', () => {
    const encoded = encodeJsonPayloads([{ priority: 'high' }, 3]);
    expect(Buffer.from(encoded.payloads[0].metadata.encoding).toString()).toBe(
      'json/plain',
    );
    expect(decodeJsonPayloads(encoded)).toEqual([{ priority: 'high' }, 3]);
    expect(decodeJsonPayloads(encodeJsonPayloads(['one']))).toBe('one');
    expect(decodeJsonPayloads({ payloads: [] })).toBeUndefined();
  });

  it('reads the protobuf JSON form (base64 text)', () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    expect(
      decodeJsonPayloads({
        payloads: [
          { metadata: { encoding: b64('json/plain') }, data: b64('{"a":1}') },
        ],
      }),
    ).toEqual({ a: 1 });
  });

  it('describes payloads it cannot decode', () => {
    expect(
      decodeJsonPayloads({
        payloads: [
          {
            metadata: { encoding: Buffer.from('binary/encrypted') },
            data: Buffer.from([1, 2, 3]),
          },
        ],
      }),
    ).toEqual({ encoding: 'binary/encrypted', size: 3, undecodable: true });
    expect(
      decodeJsonPayloads({
        payloads: [{ metadata: { encoding: Buffer.from('binary/null') } }],
      }),
    ).toBeNull();
  });
});
