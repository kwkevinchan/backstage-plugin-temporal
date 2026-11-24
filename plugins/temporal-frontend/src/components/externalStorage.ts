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

import { configApiRef, useApi } from '@backstage/core-plugin-api';
import type { ExternalPayload } from '../common';

const BUCKET_PLACEHOLDER = 'temporal-bucket-placeholder';
const KEY_PLACEHOLDER = 'temporal-key-placeholder';
const warnedTemplates = new Set<string>();

function isDynamicObjectUrlHost(template: string): boolean {
  const sample = template
    .split('{bucket}')
    .join(BUCKET_PLACEHOLDER)
    .split('{key}')
    .join(KEY_PLACEHOLDER);
  let url: URL;
  try {
    url = new URL(sample);
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
 * `temporal.externalStorage.objectUrl`, the template of the link to a stored
 * payload, when it is set.
 */
export function useExternalObjectUrlTemplate(): string | undefined {
  const config = useApi(configApiRef);
  return config.getOptionalString('temporal.externalStorage.objectUrl');
}

/**
 * The link to a stored payload: `template` with `{bucket}` and `{key}`
 * replaced by the URL-encoded values. The bucket and the key come from the
 * workflow history, so they are untrusted input: they are encoded, and a
 * link is made only when the result is an `https:` URL with a fixed trusted
 * domain or host suffix.
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
  const filled = trimmed
    .split('{bucket}')
    .join(encodeURIComponent(external.bucket))
    .split('{key}')
    .join(encodeURIComponent(external.key));
  try {
    const url = new URL(filled);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
