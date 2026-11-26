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

import { undecodableInfo } from './payloadKind';

describe('undecodableInfo', () => {
  it('tells the five kinds apart', () => {
    expect(undecodableInfo('binary/encrypted').kind).toBe('encrypted');
    expect(undecodableInfo('binary/plain').kind).toBe('binary');
    expect(undecodableInfo('binary/protobuf').kind).toBe('protobuf');
    expect(undecodableInfo('json/plain').kind).toBe('invalidJson');
    expect(undecodableInfo('json/protobuf').kind).toBe('invalidJson');
    expect(undecodableInfo('binary/custom').kind).toBe('custom');
    expect(undecodableInfo('').kind).toBe('custom');
  });

  it('names the key ID and the message type when metadata has them', () => {
    expect(
      undecodableInfo('binary/encrypted', { 'encryption-key-id': 'key-1' })
        .description,
    ).toContain('key ID key-1');
    expect(
      undecodableInfo('binary/protobuf', { messageType: 'acme.Order' })
        .description,
    ).toContain('acme.Order');
    expect(undecodableInfo('binary/encrypted', {}).description).not.toContain(
      'key ID',
    );
  });
});
