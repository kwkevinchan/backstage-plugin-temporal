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

import { S3PayloadReader } from './S3PayloadReader';

/** A fake S3 client that answers GetObject with these bytes. */
function fakeClient(
  object: Uint8Array,
  options: { ignoreRange?: boolean } = {},
) {
  const destroy = jest.fn();
  const send = jest.fn(async (command: any) => {
    const range: string | undefined = command.input.Range;
    const match =
      range && !options.ignoreRange && /^bytes=0-(\d+)$/.exec(range);
    const body = match ? object.slice(0, Number(match[1]) + 1) : object;
    return {
      Body: { transformToByteArray: async () => body, destroy },
      ContentLength: body.length,
      ...(match
        ? { ContentRange: `bytes 0-${body.length - 1}/${object.length}` }
        : {}),
    };
  });
  return { send, destroy };
}

describe('S3PayloadReader', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(7);

  it('reads an object up to the limit, asking for one byte more', async () => {
    const client = fakeClient(bytes(10));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    expect((await reader.get('k', 10)).length).toBe(10);
    expect(client.send.mock.calls[0][0].input).toEqual({
      Bucket: 'b',
      Key: 'k',
      Range: 'bytes=0-10',
    });
  });

  it('refuses a larger object from its Content-Range, without reading it', async () => {
    const client = fakeClient(bytes(11));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    await expect(reader.get('k', 10)).rejects.toThrow(
      'S3 object k is larger than 10 bytes',
    );
    expect(client.destroy).toHaveBeenCalled();
  });

  it('refuses a larger object when the service ignores the range', async () => {
    const client = fakeClient(bytes(11), { ignoreRange: true });
    const reader = new S3PayloadReader({ bucket: 'b', client });
    await expect(reader.get('k', 10)).rejects.toThrow('larger than 10 bytes');
  });

  it('reads the whole object without a limit', async () => {
    const client = fakeClient(bytes(11));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    expect((await reader.get('k')).length).toBe(11);
    expect(client.send.mock.calls[0][0].input.Range).toBeUndefined();
  });
});
