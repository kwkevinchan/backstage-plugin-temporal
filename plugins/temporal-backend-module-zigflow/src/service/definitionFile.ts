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

import { constants, lstat, open, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { TargetError, TooLargeError } from './definitionErrors';

export const FILE_FOLDER_MESSAGE =
  'A target next to a file location must stay in the folder of the entity file';

/** Reads all of a stream, failing as soon as it passes `maxBytes`. */
export async function readLimited(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new TooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** True when `path` is `root` or a path below it. */
export function isInside(root: string, path: string): boolean {
  const inside = relative(root, path);
  return (
    inside !== '' &&
    inside !== '..' &&
    !inside.startsWith(`..${sep}`) &&
    !isAbsolute(inside)
  );
}

/**
 * Reads a regular file in the folder `root`, failing when it is larger than
 * `maxBytes`. Symlinks may point only to files in the real folder of `root`.
 */
export async function readFileLimited(
  path: string,
  root: string,
  maxBytes: number,
) {
  // A file outside the folder, a missing file and one that cannot be read
  // all give the same answer, and nothing outside the folder is opened.
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new TargetError(FILE_FOLDER_MESSAGE);
  }
  let realFile: string;
  try {
    realFile = await realpath(path);
  } catch (error) {
    // Only a name that is missing in a real folder inside `root` is reported
    // as missing; a link that leads nowhere, or to a place without access,
    // looks like any other file outside the folder.
    if ((error as { code?: string }).code === 'ENOENT') {
      const exists = await lstat(path).then(
        () => true,
        () => false,
      );
      const parent = await realpath(dirname(path)).catch(() => undefined);
      if (
        !exists &&
        parent !== undefined &&
        (parent === realRoot || isInside(realRoot, parent))
      ) {
        throw error;
      }
    }
    throw new TargetError(FILE_FOLDER_MESSAGE);
  }
  if (!isInside(realRoot, realFile)) throw new TargetError(FILE_FOLDER_MESSAGE);
  // Without O_NONBLOCK, opening a FIFO waits until another process writes.
  const handle = await open(
    realFile,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new TargetError('The target is not a regular file');
    }
    // The opened file must be the checked one: a link that changes between
    // `realpath` and `open` gives another device or inode.
    const checked = await stat(realFile);
    if (checked.dev !== opened.dev || checked.ino !== opened.ino) {
      throw new TargetError(FILE_FOLDER_MESSAGE);
    }
    if (opened.size > maxBytes) throw new TooLargeError();
    // Read up to one byte past the limit: some files (such as those in
    // /proc) report a size of 0 or change after `stat`.
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw new TooLargeError();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}
