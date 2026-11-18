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

import { externalObjectUrl } from './externalStorage';

const template = 'https://console.example.com/s3/{bucket}?prefix={key}';

describe('externalObjectUrl', () => {
  it('fills in the bucket and the key', () => {
    expect(
      externalObjectUrl(template, { bucket: 'payloads', key: 'v0/ns/d/abc' }),
    ).toBe('https://console.example.com/s3/payloads?prefix=v0%2Fns%2Fd%2Fabc');
  });

  it('fills in every use of a placeholder', () => {
    expect(
      externalObjectUrl('https://x.example.com/{bucket}/{bucket}', {
        bucket: 'b',
        key: 'k',
      }),
    ).toBe('https://x.example.com/b/b');
  });

  it.each([
    ['a/b', 'a%2Fb'],
    ['a?b', 'a%3Fb'],
    ['a#b', 'a%23b'],
    ['a b', 'a%20b'],
    ['a&b=c', 'a%26b%3Dc'],
    ['../x', '..%2Fx'],
  ])('encodes %j in the key as %s', (key, encoded) => {
    expect(externalObjectUrl(template, { bucket: 'b', key })).toBe(
      `https://console.example.com/s3/b?prefix=${encoded}`,
    );
  });

  it('keeps a bucket from changing the path, the query or the host', () => {
    expect(
      externalObjectUrl(template, { bucket: 'b/../x?y#z w', key: 'k' }),
    ).toBe('https://console.example.com/s3/b%2F..%2Fx%3Fy%23z%20w?prefix=k');
    expect(
      externalObjectUrl('https://{bucket}.example.com/', {
        bucket: 'evil.com/',
        key: 'k',
      }),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    '',
    'http://console.example.com/{bucket}',
    `${'java'}script:alert({key})`,
    'ftp://console.example.com/{bucket}',
    '//console.example.com/{bucket}',
    '/relative/{bucket}',
    '{bucket}',
    'https://',
  ])('makes no link for the template %j', value => {
    expect(externalObjectUrl(value, { bucket: 'b', key: 'k' })).toBeUndefined();
  });
});
