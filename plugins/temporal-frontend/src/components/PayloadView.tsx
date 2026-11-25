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

import type { JsonObject, JsonValue } from '@backstage/types';
import type { DecodedPayload, ExternalPayload } from '../common';
import { Text } from '@backstage/ui';
import { CopyButton } from './CopyButton';
import { ExternalPayloadView } from './ExternalPayloadView';
import { undecodableInfo } from './payloadKind';
import { tp } from './styles';

function isDecoded(value: unknown): value is DecodedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { encoding?: unknown }).encoding === 'string' &&
    ('value' in value || 'undecodable' in value || 'external' in value)
  );
}

/** A payload in External Storage: where it is stored, and no value. */
function isReference(
  value: unknown,
): value is { encoding: string; external: ExternalPayload } {
  if (!isDecoded(value) || !('external' in value)) return false;
  const e = (value as { external?: Partial<ExternalPayload> }).external;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.store === 'string' &&
    typeof e.bucket === 'string' &&
    typeof e.key === 'string' &&
    typeof e.sha256 === 'string' &&
    typeof e.size === 'number'
  );
}

function summary(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
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
    const info = undecodableInfo(payload.encoding, payload.metadata);
    const metadata = Object.entries(payload.metadata ?? {});
    return (
      <div style={{ display: 'grid', gap: 2 }} data-kind={info.kind}>
        <Text as="p" variant="body-small" color="secondary">
          {info.label} ({payload.encoding || 'unknown encoding'}, {payload.size}{' '}
          bytes)
        </Text>
        <Text as="p" variant="body-small" color="secondary">
          {info.description}
        </Text>
        {metadata.map(([key, value]) => (
          <Text key={key} as="p" variant="body-small" color="secondary">
            {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
          </Text>
        ))}
      </div>
    );
  }
  if (isReference(payload)) {
    return <ExternalPayloadView external={payload.external} />;
  }
  const value =
    isDecoded(payload) && 'value' in payload ? payload.value : payload;
  return <JsonView value={value as JsonValue} open={props.open} />;
}

/**
 * A decoded payload, or an array of them (several arguments). Payloads that
 * could not be decoded show their kind, encoding, size and metadata;
 * payloads stored in External Storage show where they are stored.
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

/**
 * The memo of a workflow: its JSON, with the entries that are stored in
 * External Storage shown like the inputs and results of steps.
 */
export function MemoView(props: { memo: JsonObject }) {
  const entries = Object.entries(props.memo);
  const stored = entries.filter(([, value]) => isReference(value));
  if (stored.length === 0) return <JsonView value={props.memo} />;
  const rest = Object.fromEntries(
    entries.filter(([, value]) => !isReference(value)),
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {Object.keys(rest).length > 0 && <JsonView value={rest as JsonObject} />}
      {stored.map(([name, value]) => (
        <div key={name} style={{ display: 'grid', gap: 4 }}>
          <Text as="span" variant="body-small" weight="bold">
            {name}
          </Text>
          <PayloadView payload={value} />
        </div>
      ))}
    </div>
  );
}
