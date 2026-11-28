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

import { posix } from 'node:path';
import type { ScmIntegrations } from '@backstage/integration';

/** One host (and optional path prefix) entry in `temporal.definitions.allow`. */
export interface DefinitionAllowRule {
  host: string;
  paths?: string[];
}

export interface CompiledAllowRule {
  rawHost: string;
  domain: string;
  isWildcard: boolean;
  hasPaths: boolean;
  matchesHostname(url: URL): boolean;
  matchesHost(url: URL): boolean;
  matchesPath(normalizedPath: string): boolean;
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

export function compileAllowRule(rule: DefinitionAllowRule): CompiledAllowRule {
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

export function matchesAnyIntegration(
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
