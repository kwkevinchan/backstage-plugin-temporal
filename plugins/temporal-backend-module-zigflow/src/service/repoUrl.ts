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

/** True when `value` contains an ASCII control (U+0000–U+001F) or DEL. */
export function hasControlChar(value: string): boolean {
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
export function decodeFully(value: string): string {
  let decoded = value;
  let previous: string;
  do {
    previous = decoded;
    decoded = decoded.replace(/(?:%[0-9a-f]{2})+/gi, decodePercentChunk);
  } while (decoded !== previous);
  return decoded;
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
  // Labels exclude both separators, so each hostname splits in one way only
  // and a long run of "-" cannot make the match backtrack exponentially.
  return /^s3(?:[.-][^.-]+)*\.amazonaws\.com(?:\.cn)?$/i.test(hostname);
}

/**
 * Extracts the repository identity (`origin` + owner/repo or project/repo),
 * optional branch/ref, and file directory segments inside the repository from
 * an SCM file URL, or falls back to the entity file's folder boundary for
 * other URL shapes (such as Gerrit, CodeCommit, or Harness). Each repository
 * URL shape applies only to its integration type and to hosts without an
 * integration.
 */
export function parseRepoUrl(
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
