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

import type { JsonObject } from '@backstage/types';

/** The kinds of payload the plugin cannot decode. */
export type UndecodableKind =
  | 'encrypted'
  | 'binary'
  | 'protobuf'
  | 'invalidJson'
  | 'custom';

/** What to tell the user about a payload the plugin cannot decode. */
export interface UndecodableInfo {
  kind: UndecodableKind;
  label: string;
  description: string;
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Tells apart the payloads that cannot be decoded, by their encoding (and
 * the metadata the encoding names). The default data converter has five
 * encodings; `binary/encrypted` is the convention of the Temporal encryption
 * samples. Any other encoding comes from a payload codec or a custom data
 * converter.
 */
export function undecodableInfo(
  encoding: string,
  metadata?: JsonObject,
): UndecodableInfo {
  switch (encoding) {
    case 'binary/encrypted': {
      const keyId = text(metadata?.['encryption-key-id']);
      return {
        kind: 'encrypted',
        label: 'Encrypted',
        description: `Encrypted by a payload codec${
          keyId ? ` (key ID ${keyId})` : ''
        }. The plugin does not decrypt payloads.`,
      };
    }
    case 'binary/plain':
      return {
        kind: 'binary',
        label: 'Binary data',
        description: 'Not text, so only its size is shown.',
      };
    case 'binary/protobuf': {
      const type = text(metadata?.messageType);
      return {
        kind: 'protobuf',
        label: 'Protobuf binary',
        description: `${
          type ? `Message type ${type}. ` : ''
        }Reading it needs the protobuf schema.`,
      };
    }
    case 'json/plain':
    case 'json/protobuf':
      return {
        kind: 'invalidJson',
        label: 'Invalid JSON',
        description: 'The content is not valid JSON.',
      };
    default:
      return {
        kind: 'custom',
        label: 'Custom encoding',
        description: 'Encoded by a payload codec or a custom data converter.',
      };
  }
}
