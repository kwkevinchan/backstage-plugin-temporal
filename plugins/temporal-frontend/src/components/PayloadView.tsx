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

import { useState } from 'react';
import type { JsonValue } from '@backstage/types';
import type { ExternalPayload } from '@kwkevinchan/backstage-plugin-temporal-common';
import { ButtonIcon, Text } from '@backstage/ui';
import { RiCheckLine, RiFileCopyLine } from '@remixicon/react';
import { ExternalPayloadView } from './ExternalPayloadView';
import { tp } from './styles';

type Decoded =
  | { encoding: string; value: JsonValue; external?: ExternalPayload }
  | { encoding: string; size: number; undecodable: true }
  | { encoding: string; external: ExternalPayload };

function isDecoded(value: unknown): value is Decoded {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { encoding?: unknown }).encoding === 'string' &&
    ('value' in value || 'undecodable' in value || 'external' in value)
  );
}

function summary(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Copies text to the clipboard and shows a check mark for a moment. */
export function CopyButton(props: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ButtonIcon
      size="small"
      variant="tertiary"
      aria-label={props.label ?? 'Copy'}
      icon={copied ? <RiCheckLine /> : <RiFileCopyLine />}
      onPress={async () => {
        await window.navigator.clipboard
          ?.writeText(props.text)
          .catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

/** JSON that can be folded and copied. Objects start folded unless `open`. */
export function JsonView(props: { value: JsonValue; open?: boolean }) {
  const { value } = props;
  const text = JSON.stringify(value, null, 2);
  if (value === null || typeof value !== 'object') {
    return (
      <Text as="span" variant="body-small" style={{ wordBreak: 'break-word' }}>
        {JSON.stringify(value)}
      </Text>
    );
  }
  return (
    <details className={tp('tp-json')} open={props.open}>
      <summary>
        <span>{summary(value)}</span>
        <CopyButton text={text} label="Copy JSON" />
      </summary>
      <pre className={tp('tp-pre')}>{text}</pre>
    </details>
  );
}

function One(props: { payload: JsonValue; open?: boolean }) {
  const { payload } = props;
  if (isDecoded(payload) && 'undecodable' in payload) {
    return (
      <Text as="p" variant="body-small" color="secondary">
        {payload.encoding || 'unknown encoding'}, {payload.size} bytes (not
        decoded)
      </Text>
    );
  }
  const stored = isDecoded(payload)
    ? (payload as { external?: ExternalPayload; value?: JsonValue })
    : undefined;
  if (stored?.external) {
    // Stored in S3: with the value when the backend shows it inline.
    return (
      <ExternalPayloadView external={stored.external}>
        {'value' in stored && (
          <JsonView value={stored.value ?? null} open={props.open} />
        )}
      </ExternalPayloadView>
    );
  }
  const value =
    isDecoded(payload) && 'value' in payload ? payload.value : payload;
  return <JsonView value={value as JsonValue} open={props.open} />;
}

/**
 * A decoded payload, or an array of them (several arguments). Payloads that
 * could not be decoded show their encoding and size; payloads stored in S3
 * show their size, a preview and a download button.
 */
export function PayloadView(props: { payload?: JsonValue; open?: boolean }) {
  const { payload } = props;
  if (payload === undefined) {
    return (
      <Text as="span" variant="body-small" color="secondary">
        —
      </Text>
    );
  }
  if (Array.isArray(payload) && payload.every(isDecoded)) {
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        {payload.map((p, i) => (
          <One key={i} payload={p} open={props.open} />
        ))}
      </div>
    );
  }
  return <One payload={payload} open={props.open} />;
}
