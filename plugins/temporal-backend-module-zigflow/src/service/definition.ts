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

import type {
  LoggerService,
  UrlReaderService,
} from '@backstage/backend-plugin-api';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type { Config } from '@backstage/config';
import { ScmIntegrations } from '@backstage/integration';
import type { TemporalWorkflowDefinitionSpec } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import type { WorkflowDefinitionResponse } from '../common/definition';
import {
  compileAllowRule,
  DefinitionAllowRule,
  matchesAnyIntegration,
} from './definitionAllow';
import { TargetError, TooLargeError } from './definitionErrors';
import { readFileLimited, readLimited } from './definitionFile';
import {
  DefinitionLocation,
  DefinitionTargetRules,
  resolveDefinitionTarget,
} from './definitionTarget';
import { parseDefinition } from './definitionYaml';

/** Largest definition file read by default: 1 MiB. */
export const DEFAULT_DEFINITION_MAX_BYTES = 1024 * 1024;
/** Upper limit of `temporal.definitions.maxBytes`: 8 MiB. */
const MAX_DEFINITION_MAX_BYTES = 8 * 1024 * 1024;

class RateLimitError extends Error {}

export const DEFAULT_CACHE_TTL_SECONDS = 30;
export const MAX_CACHE_TTL_SECONDS = 600;
export const DEFAULT_CACHE_MAX_ENTRIES = 100;
export const DEFAULT_MAX_CONCURRENT_READS = 4;
export const DEFAULT_MAX_READS_PER_MINUTE = 120;

interface CacheEntry {
  buffer: Buffer;
  expiresAt: number;
}

export interface DefinitionReaderOptions {
  reader: UrlReaderService;
  integrations: ScmIntegrations;
  logger?: LoggerService;
  maxBytes?: number;
  /**
   * How long a file read from a URL is kept in memory, in seconds. 0 turns
   * the cache off. Defaults to 30.
   */
  cacheTtlSeconds?: number;
  /** Most files the cache keeps; the least recently used is dropped. */
  cacheMaxEntries?: number;
  /** Most URL reads that run at the same time; the others wait. */
  maxConcurrentReads?: number;
  /** Most URL reads started in a minute; further reads fail until it ends. */
  maxReadsPerMinute?: number;
  /**
   * Reads definitions next to entities loaded from `file:` locations (the
   * catalog of a development setup). Off by default.
   */
  readFileLocations?: boolean;
  /**
   * Hosts (and optional path prefixes) from which absolute `http(s)` URLs
   * may be read. Empty by default, so absolute URLs are rejected unless
   * listed here.
   */
  allow?: DefinitionAllowRule[];
}

/**
 * Reads the definition files of `TemporalWorkflow` entities. URLs are read
 * with the backend's URL reader, so only configured integrations (and
 * `backend.reading.allow`) are read; absolute URLs must also match
 * `temporal.definitions.allow`. Files next to entities from `file:`
 * locations are read from the disk only with
 * `temporal.definitions.readFileLocations`.
 */
export class DefinitionReader {
  readonly maxBytes: number;
  private readonly reader: UrlReaderService;
  private readonly logger?: LoggerService;
  private readonly targetRules: DefinitionTargetRules;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly maxConcurrentReads: number;
  private readonly maxReadsPerMinute: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private windowStart = 0;
  private windowReads = 0;

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
    const intOption = (
      key: string,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const value =
        config.getOptionalNumber(`temporal.definitions.${key}`) ?? fallback;
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(
          `temporal.definitions.${key} must be a whole number between ${min} and ${max}`,
        );
      }
      return value;
    };
    const cacheTtlSeconds = intOption(
      'cacheTtlSeconds',
      DEFAULT_CACHE_TTL_SECONDS,
      0,
      MAX_CACHE_TTL_SECONDS,
    );
    const cacheMaxEntries = intOption(
      'cacheMaxEntries',
      DEFAULT_CACHE_MAX_ENTRIES,
      1,
      10000,
    );
    const maxConcurrentReads = intOption(
      'maxConcurrentReads',
      DEFAULT_MAX_CONCURRENT_READS,
      1,
      100,
    );
    const maxReadsPerMinute = intOption(
      'maxReadsPerMinute',
      DEFAULT_MAX_READS_PER_MINUTE,
      1,
      100000,
    );
    const allow = config
      .getOptionalConfigArray('temporal.definitions.allow')
      ?.map(entry => ({
        host: entry.getString('host'),
        paths: entry.getOptionalStringArray('paths'),
      }));
    const integrations = ScmIntegrations.fromConfig(config);
    const definitionReader = new DefinitionReader({
      reader,
      integrations,
      logger,
      maxBytes,
      cacheTtlSeconds,
      cacheMaxEntries,
      maxConcurrentReads,
      maxReadsPerMinute,
      readFileLocations:
        config.getOptionalBoolean('temporal.definitions.readFileLocations') ??
        false,
      allow,
    });
    for (const rule of definitionReader.targetRules.allow) {
      if (!rule.hasPaths && matchesAnyIntegration(rule, integrations)) {
        logger
          ?.child({ host: rule.rawHost })
          .warn(
            'temporal.definitions.allow allows every path on an integration-backed host; set paths for this entry (see the Security / Zigflow definition reading section in the README)',
          );
      }
    }
    return definitionReader;
  }

  constructor(options: DefinitionReaderOptions) {
    this.reader = options.reader;
    this.logger = options.logger;
    this.maxBytes = options.maxBytes ?? DEFAULT_DEFINITION_MAX_BYTES;
    this.cacheTtlMs =
      (options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
    this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
    this.maxConcurrentReads =
      options.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_READS;
    this.maxReadsPerMinute =
      options.maxReadsPerMinute ?? DEFAULT_MAX_READS_PER_MINUTE;
    this.targetRules = {
      integrations: options.integrations,
      allow: (options.allow ?? []).map(compileAllowRule),
      readFileLocations: options.readFileLocations ?? false,
    };
  }

  private async fetch(where: DefinitionLocation) {
    if (where.type === 'file') {
      return readFileLimited(where.target, where.root, this.maxBytes);
    }
    return this.fetchUrl(where.target);
  }

  /**
   * Reads a URL through a short in-memory cache. The cache belongs to this
   * process; it is not shared between backend instances. Only successful
   * reads are kept, so a failure is retried by the next request. The key is
   * the URL alone: the credentials come from the backend's integrations and
   * do not depend on the caller, and the caller's permission is checked on
   * the entity before a definition is read.
   */
  private fetchUrl(url: string): Promise<Buffer> {
    const now = Date.now();
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url);
      if (cached.expiresAt > now) {
        // Re-insert to mark it as the most recently used.
        this.cache.set(url, cached);
        return Promise.resolve(cached.buffer);
      }
    }
    const pending = this.inFlight.get(url);
    if (pending) return pending;
    if (this.windowStart + 60_000 <= now) {
      this.windowStart = now;
      this.windowReads = 0;
    }
    if (this.windowReads >= this.maxReadsPerMinute) {
      return Promise.reject(new RateLimitError());
    }
    this.windowReads += 1;
    const read = this.withSlot(() => this.readUrl(url)).then(buffer => {
      if (this.cacheTtlMs > 0) {
        this.cache.set(url, {
          buffer,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
        while (this.cache.size > this.cacheMaxEntries) {
          this.cache.delete(this.cache.keys().next().value as string);
        }
      }
      return buffer;
    });
    this.inFlight.set(url, read);
    const clear = () => {
      this.inFlight.delete(url);
    };
    read.then(clear, clear);
    return read;
  }

  private async withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrentReads) {
      await new Promise<void>(wake => this.waiting.push(wake));
    } else {
      this.running += 1;
    }
    try {
      return await run();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next(); // the slot passes to the next waiting read
      } else {
        this.running -= 1;
      }
    }
  }

  private async readUrl(url: string): Promise<Buffer> {
    const response = await this.reader.readUrl(url);
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
    const entityRef = stringifyEntityRef(entity);
    const base: WorkflowDefinitionResponse = {
      format: spec.format,
      target: spec.target,
      tasks: [],
    };
    let where: DefinitionLocation;
    try {
      where = resolveDefinitionTarget(entity, spec.target, this.targetRules);
    } catch (error) {
      this.logger
        ?.child({ entityRef: entityRef })
        .debug('The target of a definition cannot be used', error as Error);
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
      if (error instanceof TargetError) {
        return {
          ...base,
          url,
          error: { kind: 'read', message: error.message },
        };
      }
      if (error instanceof RateLimitError) {
        return {
          ...base,
          url,
          error: {
            kind: 'read',
            message:
              'Too many definition files were read in the last minute; try again shortly',
          },
        };
      }
      const name = error instanceof Error ? error.name : '';
      this.logger
        ?.child({ entityRef: entityRef, targetType: where.type })
        .warn('Could not read the definition of an entity', error as Error);
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
    const parsed = parseDefinition(content);
    // A file that is not a valid definition may be another file of the
    // repository: its text is not returned.
    return {
      ...base,
      url,
      ...(parsed.error ? {} : { content }),
      size: buffer.length,
      ...parsed,
    };
  }
}
