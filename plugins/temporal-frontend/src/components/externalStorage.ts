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

import type { ExternalPayload } from '../common';

const BUCKET_PLACEHOLDER = 'temporal-bucket-placeholder';
const KEY_PLACEHOLDER = 'temporal-key-placeholder';
const warnedTemplates = new Set<string>();

function fillSample(template: string): string {
  return template
    .split('{bucket}')
    .join(BUCKET_PLACEHOLDER)
    .split('{key}')
    .join(KEY_PLACEHOLDER);
}

function isDynamicObjectUrlHost(template: string): boolean {
  let url: URL;
  try {
    url = new URL(fillSample(template));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes(BUCKET_PLACEHOLDER) && !host.includes(KEY_PLACEHOLDER)) {
    return false;
  }
  if (host === BUCKET_PLACEHOLDER || host === KEY_PLACEHOLDER) {
    return true;
  }
  const labels = host.split('.');
  let lastPlaceholderIndex = -1;
  for (let i = 0; i < labels.length; i += 1) {
    if (
      labels[i].includes(BUCKET_PLACEHOLDER) ||
      labels[i].includes(KEY_PLACEHOLDER)
    ) {
      lastPlaceholderIndex = i;
    }
  }
  const fixedSuffixLabels = labels
    .slice(lastPlaceholderIndex + 1)
    .filter(Boolean);
  return fixedSuffixLabels.length < 2;
}

/**
 * The part of the template's path before the first placeholder: a link must
 * stay under it once the URL parser has resolved its dot segments.
 */
function fixedPathPrefix(template: string): string | undefined {
  let path: string;
  try {
    path = new URL(fillSample(template)).pathname;
  } catch {
    return undefined;
  }
  const ends = [BUCKET_PLACEHOLDER, KEY_PLACEHOLDER]
    .map(placeholder => path.indexOf(placeholder))
    .filter(index => index >= 0);
  return ends.length > 0 ? path.slice(0, Math.min(...ends)) : path;
}

/**
 * Whether the path of a filled template, before the URL parser resolves it,
 * has a `.` or `..` segment (also percent-encoded, which the parser treats
 * the same). `encodeURIComponent` keeps `.` as it is, so a bucket or key of
 * `..` would otherwise move the link out of its folder.
 */
function hasDotSegment(filled: string): boolean {
  const authority = filled.indexOf('//');
  const pathStart = filled.indexOf('/', authority + 2);
  if (pathStart < 0) return false;
  const rest = filled.slice(pathStart);
  const pathEnd = rest.search(/[?#]/);
  const path = pathEnd < 0 ? rest : rest.slice(0, pathEnd);
  return path
    .split(/[/\\]/)
    .map(segment => segment.toLowerCase().split('%2e').join('.'))
    .some(segment => segment === '.' || segment === '..');
}

/**
 * The link to a stored payload: `template` with `{bucket}` and `{key}`
 * replaced by the URL-encoded values. The bucket and the key come from the
 * workflow history, so they are untrusted input: they are encoded, and a
 * link is made only when the result is an `https:` URL with a fixed trusted
 * domain or host suffix, without `.` or `..` path segments, and with the
 * template's path up to the first placeholder unchanged.
 */
export function externalObjectUrl(
  template: string | undefined,
  external: Pick<ExternalPayload, 'bucket' | 'key'>,
): string | undefined {
  const trimmed = template?.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return undefined;
  if (isDynamicObjectUrlHost(trimmed)) {
    if (!warnedTemplates.has(trimmed)) {
      warnedTemplates.add(trimmed);
      // eslint-disable-next-line no-console
      console.warn(
        'Ignoring temporal.externalStorage.objectUrl because its hostname is controlled by {bucket} or {key} without at least two fixed domain labels.',
      );
    }
    return undefined;
  }
  const prefix = fixedPathPrefix(trimmed);
  if (prefix === undefined) return undefined;
  const filled = trimmed
    .split('{bucket}')
    .join(encodeURIComponent(external.bucket))
    .split('{key}')
    .join(encodeURIComponent(external.key));
  if (hasDotSegment(filled)) return undefined;
  try {
    const url = new URL(filled);
    return url.protocol === 'https:' && url.pathname.startsWith(prefix)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
