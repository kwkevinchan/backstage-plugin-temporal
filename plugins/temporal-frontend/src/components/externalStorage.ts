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
 * link is made only when the result is an `https:` URL.
 */
export function externalObjectUrl(
  template: string | undefined,
  external: Pick<ExternalPayload, 'bucket' | 'key'>,
): string | undefined {
  if (!template || !/^https:\/\//i.test(template.trim())) return undefined;
  const filled = template
    .trim()
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
