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

import { open } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type {
  LoggerService,
  UrlReaderService,
} from '@backstage/backend-plugin-api';
import {
  ANNOTATION_LOCATION,
  Entity,
  parseLocationRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import type { Config } from '@backstage/config';
import { ScmIntegrations } from '@backstage/integration';
import type { JsonObject } from '@backstage/types';
import { isMap, isSeq, LineCounter, parseDocument } from 'yaml';
import type { TemporalWorkflowDefinitionSpec } from '@kwkevinchan/backstage-plugin-temporal-backend';
import {
  walkDefinitionTasks,
  WorkflowDefinitionError,
  WorkflowDefinitionResponse,
  WorkflowDefinitionTask,
} from '../common/definition';

/** Largest definition file read by default: 1 MiB. */
export const DEFAULT_DEFINITION_MAX_BYTES = 1024 * 1024;
/** Upper limit of `temporal.definitions.maxBytes`: 8 MiB. */
const MAX_DEFINITION_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Most aliases resolved while a definition is turned into data. A few
 * aliases are fine; "billion laughs" files that expand aliases of aliases
 * fail instead of filling the memory.
 */
export const MAX_ALIAS_COUNT = 100;

/** Thrown when a file is larger than the limit. */
class TooLargeError extends Error {}

/** A target that is not allowed, or a location it cannot be resolved from. */
class TargetError extends Error {}

export interface DefinitionReaderOptions {
  reader: UrlReaderService;
  integrations: ScmIntegrations;
  logger?: LoggerService;
  maxBytes?: number;
  /**
   * Reads definitions next to entities loaded from `file:` locations (the
   * catalog of a development setup). Off by default.
   */
  readFileLocations?: boolean;
}

/** Reads all of a stream, failing as soon as it passes `maxBytes`. */
async function readLimited(stream: Readable, maxBytes: number) {
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

/** Reads a local file, failing when it is larger than `maxBytes`. */
async function readFileLimited(path: string, maxBytes: number) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) throw new TooLargeError();
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Last line with text in `[start, end)`, from 1. */
function lastLine(
  text: string,
  lineCounter: LineCounter,
  start: number,
  end: number,
): number {
  let at = Math.min(end, text.length) - 1;
  while (at > start && /\s/.test(text[at])) at--;
  return lineCounter.linePos(Math.max(at, start)).line;
}

/**
 * Parses a definition file without running anything: plain YAML 1.2 (core
 * schema, no custom tags), unique keys, a limit on aliases. Returns the data,
 * the tasks with their lines, and an error for invalid files.
 */
export function parseDefinition(text: string): {
  document?: JsonObject;
  tasks: WorkflowDefinitionTask[];
  error?: WorkflowDefinitionError;
} {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    schema: 'core',
    merge: false,
    uniqueKeys: true,
    strict: true,
  });
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const pos = first.linePos?.[0] ?? lineCounter.linePos(first.pos[0]);
    return {
      tasks: [],
      error: {
        kind: 'parse',
        message: first.message.split('\n')[0],
        line: pos?.line,
        column: pos?.col,
      },
    };
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    return {
      tasks: [],
      error: {
        kind: 'parse',
        message:
          error instanceof Error && /alias/i.test(error.message)
            ? `The file uses too many aliases (more than ${MAX_ALIAS_COUNT})`
            : 'The file could not be read as YAML',
      },
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      tasks: [],
      error: { kind: 'format', message: 'The file is not a YAML object' },
    };
  }
  const document = JSON.parse(JSON.stringify(data)) as JsonObject;
  if (!Array.isArray(document.do)) {
    return {
      document,
      tasks: [],
      error: {
        kind: 'format',
        message: 'The file has no task list (do) at the top level',
      },
    };
  }
  const tasks: WorkflowDefinitionTask[] = [];
  walkDefinitionTasks(document, visit => {
    // The list item `{ <name>: <task> }` spans the name and the task.
    const item = doc.getIn(visit.path.slice(0, -1), true);
    const range = isMap(item) || isSeq(item) ? item.range : undefined;
    if (!range) return;
    tasks.push({
      pointer: visit.pointer,
      name: visit.name,
      startLine: lineCounter.linePos(range[0]).line,
      endLine: lastLine(text, lineCounter, range[0], range[1]),
    });
  });
  const dsl = (document.document as JsonObject | undefined)?.dsl;
  if (typeof dsl === 'string' && !/^1\./.test(dsl)) {
    return {
      document,
      tasks,
      error: {
        kind: 'format',
        message: `DSL version ${dsl} is not supported; the page reads 1.x`,
      },
    };
  }
  return { document, tasks };
}

/**
 * Reads the definition files of `TemporalWorkflow` entities with the
 * backend's URL reader, so only configured integrations (and
 * `backend.reading.allow`) are read.
 */
export class DefinitionReader {
  readonly maxBytes: number;
  private readonly reader: UrlReaderService;
  private readonly integrations: ScmIntegrations;
  private readonly logger?: LoggerService;
  private readonly readFileLocations: boolean;

  static fromConfig(
    config: Config,
    reader: UrlReaderService,
    logger?: LoggerService,
  ): DefinitionReader {
    const maxBytes =
      config.getOptionalNumber('temporal.definitions.maxBytes') ??
      DEFAULT_DEFINITION_MAX_BYTES;
    if (
      !Number.isInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_DEFINITION_MAX_BYTES
    ) {
      throw new Error(
        `temporal.definitions.maxBytes must be between 1 and ${MAX_DEFINITION_MAX_BYTES}`,
      );
    }
    return new DefinitionReader({
      reader,
      integrations: ScmIntegrations.fromConfig(config),
      logger,
      maxBytes,
      readFileLocations:
        config.getOptionalBoolean('temporal.definitions.readFileLocations') ??
        false,
    });
  }

  constructor(options: DefinitionReaderOptions) {
    this.reader = options.reader;
    this.integrations = options.integrations;
    this.logger = options.logger;
    this.maxBytes = options.maxBytes ?? DEFAULT_DEFINITION_MAX_BYTES;
    this.readFileLocations = options.readFileLocations ?? false;
  }

  /**
   * Where a target is: an absolute `http(s)` URL as it is, a relative path
   * against the location the entity was read from.
   */
  resolve(
    entity: Entity,
    target: string,
  ): { type: 'url' | 'file'; target: string } {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        throw new TargetError('spec.definition.target is not a valid URL');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TargetError('Only http and https URLs are read');
      }
      return { type: 'url', target: url.toString() };
    }
    const annotation = entity.metadata.annotations?.[ANNOTATION_LOCATION];
    if (!annotation) {
      throw new TargetError(
        'The entity has no location to resolve a relative target against; use an absolute URL',
      );
    }
    let location: { type: string; target: string };
    try {
      location = parseLocationRef(annotation);
    } catch {
      throw new TargetError(`Invalid ${ANNOTATION_LOCATION} annotation`);
    }
    if (location.type === 'url') {
      return {
        type: 'url',
        target: this.integrations.resolveUrl({
          url: target,
          base: location.target,
        }),
      };
    }
    if (location.type === 'file') {
      if (!this.readFileLocations) {
        throw new TargetError(
          'Definitions next to file locations are not read; set temporal.definitions.readFileLocations',
        );
      }
      const base = dirname(location.target);
      const file = resolve(base, target);
      const inside = relative(base, file);
      // Only files in the folder of the entity file or below it.
      if (
        inside.startsWith(`..${sep}`) ||
        inside === '..' ||
        isAbsolute(inside)
      ) {
        throw new TargetError(
          'A target next to a file location must stay in the folder of the entity file',
        );
      }
      return { type: 'file', target: file };
    }
    throw new TargetError(
      `Locations of type ${location.type} are not supported; use an absolute URL`,
    );
  }

  private async fetch(where: { type: 'url' | 'file'; target: string }) {
    if (where.type === 'file') {
      return readFileLimited(where.target, this.maxBytes);
    }
    const response = await this.reader.readUrl(where.target);
    if (response.stream) {
      return readLimited(response.stream(), this.maxBytes);
    }
    const buffer = await response.buffer();
    if (buffer.length > this.maxBytes) throw new TooLargeError();
    return buffer;
  }

  /** Reads and parses the definition of a `TemporalWorkflow` entity. */
  async read(
    entity: Entity,
    spec: TemporalWorkflowDefinitionSpec,
  ): Promise<WorkflowDefinitionResponse> {
    const base: WorkflowDefinitionResponse = {
      entityRef: stringifyEntityRef(entity),
      format: spec.format,
      target: spec.target,
      maxBytes: this.maxBytes,
      tasks: [],
    };
    let where: { type: 'url' | 'file'; target: string };
    try {
      where = this.resolve(entity, spec.target);
    } catch (error) {
      return {
        ...base,
        error: {
          kind: 'read',
          message:
            error instanceof TargetError
              ? error.message
              : 'spec.definition.target could not be resolved',
        },
      };
    }
    // A local path stays in the backend; the page shows the target instead.
    const url = where.type === 'url' ? where.target : undefined;
    let buffer: Buffer;
    try {
      buffer = await this.fetch(where);
    } catch (error) {
      if (error instanceof TooLargeError) {
        return {
          ...base,
          url,
          error: {
            kind: 'tooLarge',
            message: `The file is larger than ${this.maxBytes} bytes`,
          },
        };
      }
      const name = error instanceof Error ? error.name : '';
      this.logger?.warn(
        `Could not read the definition of ${base.entityRef}: ${error}`,
      );
      return {
        ...base,
        url,
        error: {
          kind: 'read',
          message:
            name === 'NotFoundError' ||
            (error as { code?: string }).code === 'ENOENT'
              ? 'The file was not found'
              : `The file could not be read${
                  error instanceof Error && name !== 'Error' ? ` (${name})` : ''
                }: check the target and the integrations of the backend`,
        },
      };
    }
    const content = buffer.toString('utf8');
    return {
      ...base,
      url,
      content,
      size: buffer.length,
      ...parseDefinition(content),
    };
  }
}
