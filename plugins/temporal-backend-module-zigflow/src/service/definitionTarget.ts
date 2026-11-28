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

import { dirname, posix, resolve } from 'node:path';
import {
  ANNOTATION_LOCATION,
  Entity,
  parseLocationRef,
} from '@backstage/catalog-model';
import type { ScmIntegrations } from '@backstage/integration';
import type { CompiledAllowRule } from './definitionAllow';
import { TargetError } from './definitionErrors';
import { FILE_FOLDER_MESSAGE, isInside } from './definitionFile';
import { decodeFully, hasControlChar, parseRepoUrl } from './repoUrl';

/** Where a definition is read from. */
export type DefinitionLocation =
  | { type: 'url'; target: string }
  | {
      type: 'file';
      target: string;
      /** The folder of the entity file; the file must stay in it. */
      root: string;
    };

/** What decides whether a target may be read. */
export interface DefinitionTargetRules {
  integrations: ScmIntegrations;
  /** The compiled entries of `temporal.definitions.allow`. */
  allow: CompiledAllowRule[];
  /** `temporal.definitions.readFileLocations`. */
  readFileLocations: boolean;
}

const SAME_REPO_MESSAGE =
  'Relative definition targets must stay in the repository of the entity; to read from another repository or host, use an absolute URL and allow it in temporal.definitions.allow';

const SAME_FOLDER_MESSAGE =
  'On this host, relative definition targets must stay in the folder of the entity file or below it; to read another file, use an absolute URL and allow it in temporal.definitions.allow';

/**
 * Resolves a target: an absolute `http(s)` URL must match
 * `temporal.definitions.allow` and has no user name or password, while a
 * relative path must stay inside the repository of the entity's
 * `backstage.io/managed-by-location` (or inside the entity folder for
 * allowed `file:` locations). The target must be a `.yaml` or `.yml`
 * file.
 */
export function resolveDefinitionTarget(
  entity: Entity,
  rawTarget: string,
  rules: DefinitionTargetRules,
): DefinitionLocation {
  const where = resolveLocation(entity, rawTarget, rules);
  if (!isYamlFile(where, rules.integrations)) {
    throw new TargetError(
      'A serverless-workflow definition must be a .yaml or .yml file',
    );
  }
  return where;
}

/** True when the file of a location is named `*.yaml` or `*.yml`. */
function isYamlFile(
  where: DefinitionLocation,
  integrations: ScmIntegrations,
): boolean {
  const isYaml = (path: string) => /\.ya?ml$/i.test(path);
  if (where.type === 'file') return isYaml(where.target);
  const url = new URL(where.target);
  if (isYaml(decodeFully(url.pathname))) return true;
  // Azure DevOps names the file in the `path` query parameter.
  const queryPath = url.searchParams.get('path');
  return (
    integrations.byUrl(where.target)?.type === 'azure' &&
    queryPath !== null &&
    isYaml(decodeFully(queryPath))
  );
}

function resolveLocation(
  entity: Entity,
  rawTarget: string,
  rules: DefinitionTargetRules,
): DefinitionLocation {
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
    if (url.username || url.password) {
      throw new TargetError(
        'Absolute definition URLs must not contain a user name or password',
      );
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
    const hostMatches = rules.allow.filter(rule => rule.matchesHost(url));
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
    const baseIntegration = rules.integrations.byUrl(location.target);
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
    let depth = decodedTarget.startsWith('/') ? 0 : baseRepo.dirSegments.length;
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
      resolved = rules.integrations.resolveUrl({
        url: target,
        base: location.target,
      });
    } catch {
      throw new TargetError(outside);
    }
    const resolvedIntegration = rules.integrations.byUrl(resolved);
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
    if (!rules.readFileLocations) {
      throw new TargetError(
        'Definitions next to file locations are not read; set temporal.definitions.readFileLocations',
      );
    }
    const base = dirname(location.target);
    const file = resolve(base, target);
    // Only files in the folder of the entity file or below it; symlinks
    // are checked when the file is read.
    if (!isInside(base, file)) {
      throw new TargetError(FILE_FOLDER_MESSAGE);
    }
    return { type: 'file', target: file, root: base };
  }
  throw new TargetError(
    `Locations of type ${location.type} are not supported; use an absolute URL and allow it in temporal.definitions.allow`,
  );
}
