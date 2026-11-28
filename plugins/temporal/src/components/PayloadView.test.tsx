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

import { render, screen } from '@testing-library/react';
import { PayloadView } from './PayloadView';
import { undecodablePayloads } from '../testData';

function shown(payload: unknown): string {
  const { container, unmount } = render(
    <PayloadView payload={payload as never} />,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('PayloadView of payloads that cannot be decoded', () => {
  it('says the payload is encrypted, with the key ID', () => {
    render(<PayloadView payload={undecodablePayloads.encrypted as never} />);
    expect(
      screen.getByText('Encrypted (binary/encrypted, 64 bytes)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/key ID payments-key-1/)).toBeInTheDocument();
    expect(screen.getByText(/does not decrypt/)).toBeInTheDocument();
    expect(
      screen.getByText('encryption-key-id: payments-key-1'),
    ).toBeInTheDocument();
  });

  it('says binary data is not text', () => {
    render(<PayloadView payload={undecodablePayloads.binary as never} />);
    expect(
      screen.getByText('Binary data (binary/plain, 2048 bytes)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not text/)).toBeInTheDocument();
  });

  it('shows the message type of a protobuf payload', () => {
    render(<PayloadView payload={undecodablePayloads.protobuf as never} />);
    expect(
      screen.getByText('Protobuf binary (binary/protobuf, 96 bytes)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Message type acme.payments.v1.ChargeRequest/),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs the protobuf schema/)).toBeInTheDocument();
  });

  it('says the content of a JSON payload is not valid JSON', () => {
    render(<PayloadView payload={undecodablePayloads.invalidJson as never} />);
    expect(
      screen.getByText('Invalid JSON (json/plain, 17 bytes)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument();
  });

  it('calls any other encoding a custom encoding and lists its metadata', () => {
    render(<PayloadView payload={undecodablePayloads.custom as never} />);
    expect(
      screen.getByText('Custom encoding (binary/acme-compressed, 310 bytes)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/custom data converter/)).toBeInTheDocument();
    expect(screen.getByText('codec: zstd')).toBeInTheDocument();
  });

  it('shows different text for each kind', () => {
    const texts = Object.values(undecodablePayloads).map(shown);
    expect(new Set(texts).size).toBe(5);
  });
});
