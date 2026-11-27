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
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
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
import type { TemporalWorkflowDefinitionSpec } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  findSymbolLines,
  sourceLanguageOf,
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

/** One host (and optional path prefix) entry in `temporal.definitions.allow`. */
export interface DefinitionAllowRule {
  host: string;
  paths?: string[];
}

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
  /**
   * Hosts (and optional path prefixes) from which absolute `http(s)` URLs
   * may be read. Empty by default, so absolute URLs are rejected unless
   * listed here.
   */
  allow?: DefinitionAllowRule[];
}

interface CompiledAllowRule {
  rawHost: string;
  domain: string;
  isWildcard: boolean;
  hasPaths: boolean;
  matchesHostname(url: URL): boolean;
  matchesHost(url: URL): boolean;
  matchesPath(normalizedPath: string): boolean;
}

const SAME_REPO_MESSAGE =
  'Relative definition targets must stay in the repository of the entity; to read from another repository or host, use an absolute URL and allow it in temporal.definitions.allow';

const SAME_FOLDER_MESSAGE =
  'On this host, relative definition targets must stay in the folder of the entity file or below it; to read another file, use an absolute URL and allow it in temporal.definitions.allow';

/** True when `value` contains an ASCII control (U+0000–U+001F) or DEL. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function decodePercentChunk(chunk: string): string {
  try {
    return decodeURIComponent(chunk);
  } catch {
    return chunk.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
}

/** Repeatedly percent-decodes valid `%XX` sequences until the string stops changing. */
function decodeFully(value: string): string {
  let decoded = value;
  let previous: string;
  do {
    previous = decoded;
    decoded = decoded.replace(/(?:%[0-9a-f]{2})+/gi, decodePercentChunk);
  } while (decoded !== previous);
  return decoded;
}

function effectivePort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === 'http:' ? 80 : 443;
}

function compilePortMatcher(
  portSpec: string | undefined,
  rawHost: string,
): (url: URL) => boolean {
  if (portSpec === undefined) {
    return url => !url.port;
  }
  const rangeParts = portSpec.split('-');
  if (rangeParts.length === 1 && /^\d+$/.test(rangeParts[0])) {
    const port = Number(rangeParts[0]);
    if (port >= 1 && port <= 65535) {
      return url => effectivePort(url) === port;
    }
  } else if (
    rangeParts.length === 2 &&
    /^\d+$/.test(rangeParts[0]) &&
    /^\d+$/.test(rangeParts[1])
  ) {
    const start = Number(rangeParts[0]);
    const end = Number(rangeParts[1]);
    if (start >= 1 && end <= 65535 && start <= end) {
      return url => {
        const urlPort = effectivePort(url);
        return urlPort >= start && urlPort <= end;
      };
    }
  }
  throw new Error(`temporal.definitions.allow: invalid host "${rawHost}"`);
}

function compileAllowRule(rule: DefinitionAllowRule): CompiledAllowRule {
  if (!rule.host || /\s|[/?#\\]/.test(rule.host)) {
    throw new Error(`temporal.definitions.allow: invalid host "${rule.host}"`);
  }
  const hostParts = rule.host.split(':');
  if (hostParts.length > 2 || !hostParts[0]) {
    throw new Error(`temporal.definitions.allow: invalid host "${rule.host}"`);
  }
  const rawHostname = hostParts[0].toLowerCase();
  if (hostParts.length === 2 && !hostParts[1]) {
    throw new Error(`temporal.definitions.allow: invalid host "${rule.host}"`);
  }
  if (
    rawHostname.includes('*') &&
    (!rawHostname.startsWith('*.') ||
      rawHostname.length <= 2 ||
      rawHostname.slice(2).includes('*') ||
      rawHostname.slice(2).startsWith('.'))
  ) {
    throw new Error(
      `temporal.definitions.allow: invalid host wildcard "${rule.host}"`,
    );
  }
  const isWildcard = rawHostname.startsWith('*.');
  const domainPart = isWildcard ? rawHostname.slice(2) : rawHostname;
  let normalizedDomain: string;
  try {
    const parsedHost = new URL(`http://${domainPart}`);
    if (
      parsedHost.username ||
      parsedHost.password ||
      parsedHost.port ||
      parsedHost.pathname !== '/' ||
      !parsedHost.hostname ||
      domainPart.startsWith('.')
    ) {
      throw new Error('invalid host');
    }
    normalizedDomain = parsedHost.hostname.toLowerCase();
  } catch {
    throw new Error(`temporal.definitions.allow: invalid host "${rule.host}"`);
  }
  const matchesPort = compilePortMatcher(hostParts[1], rule.host);
  const matchesHostname = isWildcard
    ? (url: URL) => {
        const suffix = `.${normalizedDomain}`;
        const host = url.hostname.toLowerCase();
        return host.length > suffix.length && host.endsWith(suffix);
      }
    : (url: URL) => url.hostname.toLowerCase() === normalizedDomain;

  let matchesPath: (normalizedPath: string) => boolean = () => true;
  if (rule.paths !== undefined) {
    const matchers = rule.paths.map(pathEntry => {
      if (
        !pathEntry.startsWith('/') ||
        /\s|\\|\0/.test(pathEntry) ||
        pathEntry.split('/').includes('..')
      ) {
        throw new Error(
          `temporal.definitions.allow: invalid path "${pathEntry}"`,
        );
      }
      const normalized = posix.normalize(pathEntry);
      const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
      return (targetPath: string) =>
        targetPath === normalized || targetPath.startsWith(prefix);
    });
    matchesPath = (targetPath: string) => matchers.some(m => m(targetPath));
  }

  return {
    rawHost: rule.host,
    domain: normalizedDomain,
    isWildcard,
    hasPaths: rule.paths !== undefined,
    matchesHostname,
    matchesHost: url => matchesHostname(url) && matchesPort(url),
    matchesPath,
  };
}

function matchesAnyIntegration(
  rule: CompiledAllowRule,
  integrations: ScmIntegrations,
): boolean {
  if (!rule.isWildcard && integrations.byHost(rule.domain)) {
    return true;
  }
  for (const integration of integrations.list()) {
    const host =
      (integration as { config?: { host?: unknown } }).config?.host ??
      integration.title;
    if (typeof host !== 'string' || !host) continue;
    try {
      const url = new URL(`https://${host}`);
      if (rule.matchesHostname(url)) return true;
    } catch {
      // Ignore malformed integration host entries when matching warnings.
    }
  }
  return false;
}

interface ParsedRepoUrl {
  kind: 'repo' | 'folder';
  repoKey: string;
  ref?: string;
  dirSegments: string[];
  origin: string;
  search: string;
  folderPrefix: string;
}

/** True for AWS S3 path-style hosts, where the first path segment is the bucket. */
function isS3PathStyleHost(hostname: string): boolean {
  return /^s3([.-][^.]+)*\.amazonaws\.com(\.cn)?$/i.test(hostname);
}

/**
 * Extracts the repository identity (`origin` + owner/repo or project/repo),
 * optional branch/ref, and file directory segments inside the repository from
 * an SCM file URL, or falls back to the entity file's folder boundary for
 * other URL shapes (such as Gerrit, CodeCommit, or Harness). Each repository
 * URL shape applies only to its integration type and to hosts without an
 * integration.
 */
function parseRepoUrl(
  rawUrl: string,
  integrationType?: string,
): ParsedRepoUrl | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  const pathname = decodeFully(parsed.pathname);
  if (
    pathname.includes('\\') ||
    hasControlChar(pathname) ||
    pathname.split('/').includes('..')
  ) {
    return undefined;
  }

  const allSegments = pathname.split('/').filter(Boolean);
  const folderPrefix =
    allSegments.length >= 2 ? `/${allSegments.slice(0, -1).join('/')}/` : '/';
  const typeIs = (type: string) =>
    integrationType === type || integrationType === undefined;

  // Azure DevOps: /{org}/{project}/_git/{repo}?path=/... (or /{project}/_git/{repo})
  const azureMatch = typeIs('azure')
    ? /^\/(.+\/_git\/[^/]+)\/?$/.exec(pathname)
    : null;
  if (azureMatch) {
    const queryPath = parsed.searchParams.get('path');
    if (!queryPath) return undefined;
    const decodedQueryPath = decodeFully(queryPath);
    if (
      decodedQueryPath.includes('\\') ||
      hasControlChar(decodedQueryPath) ||
      decodedQueryPath.split('/').includes('..')
    ) {
      return undefined;
    }
    const cleanPath = decodedQueryPath.replace(/^\/+/, '');
    if (!cleanPath) return undefined;
    const parts = cleanPath.split('/').filter(Boolean);
    return {
      kind: 'repo',
      repoKey: `${parsed.origin}/${azureMatch[1]}`,
      ref: parsed.searchParams.get('version') ?? undefined,
      dirSegments: parts.slice(0, -1),
      origin: parsed.origin,
      search: parsed.search,
      folderPrefix,
    };
  }

  // GitLab: /{group...}/{repo}/-/(blob|tree|raw|edit)/{ref}/{filepath}
  const gitlabMatch = typeIs('gitlab')
    ? /^\/(.+?)\/-\/(?:blob|tree|raw|edit)\/([^/]+)\/(.+)$/.exec(pathname)
    : null;
  if (gitlabMatch) {
    const [, repoPath, ref, filepath] = gitlabMatch;
    const parts = filepath.split('/').filter(Boolean);
    return {
      kind: 'repo',
      repoKey: `${parsed.origin}/${repoPath}`,
      ref,
      dirSegments: parts.slice(0, -1),
      origin: parsed.origin,
      search: parsed.search,
      folderPrefix,
    };
  }

  // GitLab legacy URLs without `/-/`: /{group...}/{repo}/blob/{ref}/{filepath}
  // GitLab splits at the first `/blob/` segment to separate the project path.
  if (integrationType === 'gitlab') {
    const gitlabLegacyMatch = /^\/(.+?)\/blob\/([^/]+)\/(.+)$/.exec(pathname);
    if (gitlabLegacyMatch) {
      const [, repoPath, ref, filepath] = gitlabLegacyMatch;
      const parts = filepath.split('/').filter(Boolean);
      return {
        kind: 'repo',
        repoKey: `${parsed.origin}/${repoPath}`,
        ref,
        dirSegments: parts.slice(0, -1),
        origin: parsed.origin,
        search: parsed.search,
        folderPrefix,
      };
    }
  }

  // Bitbucket Server: /projects/{project}/repos/{repo}/(browse|raw)/{filepath}
  const bbServerMatch = typeIs('bitbucketServer')
    ? /^\/(projects\/[^/]+\/repos\/[^/]+)\/(?:browse|raw)\/(.+)$/.exec(pathname)
    : null;
  if (bbServerMatch) {
    const [, repoPath, filepath] = bbServerMatch;
    const parts = filepath.split('/').filter(Boolean);
    return {
      kind: 'repo',
      repoKey: `${parsed.origin}/${repoPath}`,
      ref: parsed.searchParams.get('at') ?? undefined,
      dirSegments: parts.slice(0, -1),
      origin: parsed.origin,
      search: parsed.search,
      folderPrefix,
    };
  }

  // Gitea: /{owner}/{repo}/(src|raw)/(branch|commit|tag)/{ref}/{filepath}
  const giteaMatch = typeIs('gitea')
    ? /^\/([^/]+\/[^/]+)\/(?:src|raw)\/(?:branch|commit|tag)\/([^/]+)\/(.+)$/.exec(
        pathname,
      )
    : null;
  if (giteaMatch) {
    const [, repoPath, ref, filepath] = giteaMatch;
    const parts = filepath.split('/').filter(Boolean);
    return {
      kind: 'repo',
      repoKey: `${parsed.origin}/${repoPath}`,
      ref,
      dirSegments: parts.slice(0, -1),
      origin: parsed.origin,
      search: parsed.search,
      folderPrefix,
    };
  }

  // GitHub, Bitbucket Cloud, and hosts without a configured integration:
  // exact two-segment /{owner}/{repo}/(blob|tree|raw|edit|src)/{ref}/{filepath}.
  if (
    integrationType === 'github' ||
    integrationType === 'bitbucketCloud' ||
    integrationType === undefined
  ) {
    const stdMatch =
      /^\/([^/]+\/[^/]+)\/(?:blob|tree|raw|edit|src)\/([^/]+)\/(.+)$/.exec(
        pathname,
      );
    if (stdMatch) {
      const [, repoPath, ref, filepath] = stdMatch;
      const parts = filepath.split('/').filter(Boolean);
      return {
        kind: 'repo',
        repoKey: `${parsed.origin}/${repoPath}`,
        ref,
        dirSegments: parts.slice(0, -1),
        origin: parsed.origin,
        search: parsed.search,
        folderPrefix,
      };
    }
  }

  // Raw GitHub URLs: /{owner}/{repo}/{ref}/{filepath}
  if (parsed.hostname.toLowerCase() === 'raw.githubusercontent.com') {
    const rawMatch = /^\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/.exec(pathname);
    if (rawMatch) {
      const [, repoPath, ref, filepath] = rawMatch;
      const parts = filepath.split('/').filter(Boolean);
      return {
        kind: 'repo',
        repoKey: `${parsed.origin}/${repoPath}`,
        ref,
        dirSegments: parts.slice(0, -1),
        origin: parsed.origin,
        search: parsed.search,
        folderPrefix,
      };
    }
    return undefined;
  }

  // Other URL shapes (e.g. Gerrit, CodeCommit, Harness): bound relative
  // targets to the folder of the entity file. A file at the root of a host
  // without an integration is bounded by the host root: the bucket of an S3
  // virtual-hosted URL, the whole host otherwise. On S3 path-style hosts that
  // root holds every bucket, so they are left out. The catalog reads no entity
  // file from a one-segment URL of such a host; the check is a second guard.
  if (
    allSegments.length >= 2 ||
    (allSegments.length === 1 &&
      integrationType === undefined &&
      !isS3PathStyleHost(parsed.hostname))
  ) {
    return {
      kind: 'folder',
      repoKey: `${parsed.origin}${folderPrefix}`,
      dirSegments: [],
      origin: parsed.origin,
      search: parsed.search,
      folderPrefix,
    };
  }

  return undefined;
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
/** The workflow type of a `TemporalWorkflow` entity (`spec.workflowType`). */
function workflowTypeOf(entity: Entity): string | undefined {
  const type = (entity.spec as { workflowType?: unknown } | undefined)
    ?.workflowType;
  return typeof type === 'string' ? type : undefined;
}

export class DefinitionReader {
  readonly maxBytes: number;
  private readonly reader: UrlReaderService;
  private readonly integrations: ScmIntegrations;
  private readonly logger?: LoggerService;
  private readonly readFileLocations: boolean;
  private readonly allow: CompiledAllowRule[];

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
      readFileLocations:
        config.getOptionalBoolean('temporal.definitions.readFileLocations') ??
        false,
      allow,
    });
    for (const rule of definitionReader.allow) {
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
    this.integrations = options.integrations;
    this.logger = options.logger;
    this.maxBytes = options.maxBytes ?? DEFAULT_DEFINITION_MAX_BYTES;
    this.readFileLocations = options.readFileLocations ?? false;
    this.allow = (options.allow ?? []).map(compileAllowRule);
  }

  /**
   * Resolves a target: an absolute `http(s)` URL must match
   * `temporal.definitions.allow`, while a relative path must stay inside the
   * repository of the entity's `backstage.io/managed-by-location` (or inside
   * the entity folder for allowed `file:` locations).
   */
  resolve(
    entity: Entity,
    rawTarget: string,
  ): { type: 'url' | 'file'; target: string } {
    // Reject controls in the raw target and its fully decoded form first,
    // including the edges. Trimming them off before the check would hide
    // "\thttps://..." and "%0ahttps://...", and URL parsers also delete
    // interior tab, LF, and CR.
    if (hasControlChar(rawTarget) || hasControlChar(decodeFully(rawTarget))) {
      throw new TargetError(SAME_REPO_MESSAGE);
    }
    const target = rawTarget.trim();
    const decodedTrimmed = decodeFully(target).trim();
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
      const decodedPath = decodeFully(url.pathname);
      if (
        decodedPath.includes('\\') ||
        hasControlChar(decodedPath) ||
        decodedPath.split('/').includes('..')
      ) {
        throw new TargetError(
          'Absolute definition URL paths must not contain "..", "\\", or control characters',
        );
      }
      const hostMatches = this.allow.filter(rule => rule.matchesHost(url));
      if (hostMatches.length === 0) {
        throw new TargetError(
          `Absolute definition URLs from ${url.host} are not allowed; use a path relative to the entity, or add host: ${url.host} under temporal.definitions.allow`,
        );
      }
      const normalizedPath = posix.normalize(decodedPath);
      if (!hostMatches.some(rule => rule.matchesPath(normalizedPath))) {
        throw new TargetError(
          `The path ${url.pathname} on ${url.host} is not allowed; use a path relative to the entity, or add it under temporal.definitions.allow (paths)`,
        );
      }
      return { type: 'url', target: url.toString() };
    }

    const targetPathRaw = target.split(/[?#]/, 1)[0];
    const decodedTarget = decodeFully(targetPathRaw).trim();
    if (
      !targetPathRaw.trim() ||
      target.includes('\\') ||
      decodedTrimmed.includes('\\')
    ) {
      throw new TargetError(
        'Relative definition targets must be valid relative paths without "\\", control characters, or empty paths',
      );
    }
    if (
      target.startsWith('//') ||
      decodedTrimmed.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/i.test(decodedTrimmed)
    ) {
      throw new TargetError(SAME_REPO_MESSAGE);
    }

    const annotation = entity.metadata.annotations?.[ANNOTATION_LOCATION];
    if (!annotation) {
      throw new TargetError(
        'The entity has no location to resolve a relative target against; use an absolute URL and allow it in temporal.definitions.allow',
      );
    }
    let location: { type: string; target: string };
    try {
      location = parseLocationRef(annotation);
    } catch {
      throw new TargetError(`Invalid ${ANNOTATION_LOCATION} annotation`);
    }
    if (location.type === 'url') {
      const baseIntegration = this.integrations.byUrl(location.target);
      const baseRepo = parseRepoUrl(location.target, baseIntegration?.type);
      if (!baseRepo) {
        throw new TargetError(
          `Could not determine the repository from ${ANNOTATION_LOCATION}; use an absolute URL and allow it in temporal.definitions.allow`,
        );
      }
      const outside =
        baseRepo.kind === 'folder' ? SAME_FOLDER_MESSAGE : SAME_REPO_MESSAGE;
      if (baseRepo.kind === 'folder' && decodedTarget.startsWith('/')) {
        throw new TargetError(outside);
      }
      let depth = decodedTarget.startsWith('/')
        ? 0
        : baseRepo.dirSegments.length;
      for (const segment of decodedTarget.split('/')) {
        if (!segment || segment === '.') {
          continue;
        }
        if (segment === '..') {
          depth -= 1;
          if (depth < 0) {
            throw new TargetError(outside);
          }
        } else {
          depth += 1;
        }
      }
      let resolved: string;
      try {
        resolved = this.integrations.resolveUrl({
          url: target,
          base: location.target,
        });
      } catch {
        throw new TargetError(outside);
      }
      const resolvedIntegration = this.integrations.byUrl(resolved);
      if (baseIntegration !== resolvedIntegration) {
        throw new TargetError(outside);
      }
      const resolvedRepo = parseRepoUrl(resolved, resolvedIntegration?.type);
      if (!resolvedRepo) {
        throw new TargetError(outside);
      }
      if (baseRepo.kind === 'folder') {
        const resolvedUrl = new URL(resolved);
        const resolvedPathname = posix.normalize(
          decodeFully(resolvedUrl.pathname),
        );
        if (
          resolvedUrl.origin !== baseRepo.origin ||
          resolvedUrl.search !== baseRepo.search ||
          !resolvedPathname.startsWith(baseRepo.folderPrefix) ||
          resolvedPathname.length <= baseRepo.folderPrefix.length
        ) {
          throw new TargetError(outside);
        }
      } else if (
        resolvedRepo.kind !== 'repo' ||
        resolvedRepo.repoKey !== baseRepo.repoKey ||
        resolvedRepo.ref !== baseRepo.ref
      ) {
        throw new TargetError(SAME_REPO_MESSAGE);
      }
      return { type: 'url', target: resolved };
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
      `Locations of type ${location.type} are not supported; use an absolute URL and allow it in temporal.definitions.allow`,
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
      this.logger
        ?.child({ entityRef: base.entityRef })
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
      const name = error instanceof Error ? error.name : '';
      this.logger
        ?.child({ entityRef: base.entityRef, targetType: where.type })
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
    if (spec.format === 'source') {
      // Source code: shown as text with the workflow's function marked.
      const language = sourceLanguageOf(spec.target);
      const symbol = spec.symbol ?? workflowTypeOf(entity);
      const result: WorkflowDefinitionResponse = {
        ...base,
        url,
        content,
        size: buffer.length,
        language,
      };
      if (symbol) {
        result.symbol = symbol;
        const lines = findSymbolLines(content, symbol, language);
        if (lines) result.symbolLines = lines;
      }
      return result;
    }
    return {
      ...base,
      url,
      content,
      size: buffer.length,
      ...parseDefinition(content),
    };
  }
}
