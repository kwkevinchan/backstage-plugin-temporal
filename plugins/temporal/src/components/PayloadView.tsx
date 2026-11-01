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

import type { JsonValue } from '@backstage/types';
import Typography from '@material-ui/core/Typography';

type Decoded =
  | { encoding: string; value: JsonValue }
  | { encoding: string; size: number; undecodable: true };

function isDecoded(value: JsonValue | undefined): value is Decoded {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.encoding === 'string' &&
    ('value' in value || 'undecodable' in value)
  );
}

function summary(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function One(props: { payload: JsonValue }) {
  const { payload } = props;
  if (isDecoded(payload) && 'undecodable' in payload) {
    return (
      <Typography variant="body2" color="textSecondary">
        {payload.encoding || 'unknown encoding'}, {payload.size} bytes (not
        decoded)
      </Typography>
    );
  }
  const value: JsonValue =
    isDecoded(payload) && 'value' in payload ? payload.value : payload;
  if (value === null || typeof value !== 'object') {
    return (
      <Typography
        variant="body2"
        component="span"
        style={{ wordBreak: 'break-word' }}
      >
        {JSON.stringify(value)}
      </Typography>
    );
  }
  return (
    <details>
      <summary>
        <Typography variant="body2" component="span">
          {summary(value)}
        </Typography>
      </summary>
      <pre
        style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Shows a decoded payload (or a list of them, one per argument) as
 * collapsible JSON. Payloads that could not be decoded show their encoding
 * and size.
 */
export function PayloadView(props: { payload?: JsonValue }) {
  const { payload } = props;
  if (payload === undefined) {
    return (
      <Typography variant="body2" color="textSecondary">
        —
      </Typography>
    );
  }
  if (Array.isArray(payload) && payload.every(isDecoded)) {
    return (
      <>
        {payload.map((p, i) => (
          <One key={i} payload={p} />
        ))}
      </>
    );
  }
  return <One payload={payload} />;
}
