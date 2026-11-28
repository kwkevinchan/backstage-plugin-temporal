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

import { fireEvent, screen } from '@testing-library/react';
import type { JsonObject } from '@backstage/types';
import { configApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp } from '@backstage/test-utils';
import { TestApiProvider } from '@backstage/test-utils';
import type { ExternalPayload } from '../common';
import { formatBytes } from './ExternalPayloadView';
import { MemoView, PayloadView } from './PayloadView';

const external: ExternalPayload = {
  store: 's3',
  bucket: 'payloads',
  key: `v0/ns/default/wt/reportWorkflow/wi/wf-1/ri/run-1/d/sha256/${'a'.repeat(
    64,
  )}`,
  size: 1048576,
  sha256: 'a'.repeat(64),
};
const reference = { encoding: 'json/protobuf', external };

async function render(node: JSX.Element, temporal: JsonObject = {}) {
  return renderInTestApp(
    <TestApiProvider apis={[[configApiRef, new MockConfigApi({ temporal })]]}>
      {node}
    </TestApiProvider>,
  );
}

describe('payloads in External Storage', () => {
  it('formats sizes', () => {
    expect(formatBytes(10)).toBe('10 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
  });

  it('shows where the payload is and its SHA-256, and no content', async () => {
    await render(<PayloadView payload={reference as any} />);
    expect(screen.getByText('Stored in External Storage')).toBeInTheDocument();
    expect(screen.getByText('1 MB')).toBeInTheDocument();
    expect(screen.getByTestId('external-location')).toHaveTextContent(
      `s3://payloads/${external.key}`,
    );
    expect(screen.getByTestId('external-sha256')).toHaveTextContent(
      `SHA-256 ${external.sha256}`,
    );
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('copies the location and the SHA-256', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await render(<PayloadView payload={reference as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy location' }));
    expect(writeText).toHaveBeenLastCalledWith(`s3://payloads/${external.key}`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    expect(writeText).toHaveBeenLastCalledWith(external.sha256);
  });

  it('shows several arguments, one of them stored externally', async () => {
    await render(
      <PayloadView
        payload={
          [{ encoding: 'json/plain', value: { a: 1 } }, reference] as any
        }
      />,
    );
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.getAllByTestId('external-payload')).toHaveLength(1);
  });

  describe('with temporal.externalStorage.objectUrl', () => {
    it('links to the object, with the bucket and key encoded', async () => {
      await render(<PayloadView payload={reference as any} />, {
        externalStorage: {
          objectUrl: 'https://console.example.com/s3/{bucket}?prefix={key}',
        },
      });
      const link = screen.getByRole('link', { name: 'Open' });
      expect(link).toHaveAttribute(
        'href',
        `https://console.example.com/s3/payloads?prefix=${encodeURIComponent(
          external.key,
        )}`,
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does not link when the template is not https', async () => {
      await render(<PayloadView payload={reference as any} />, {
        externalStorage: { objectUrl: 'http://console.example.com/{bucket}' },
      });
      expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
      expect(screen.getByTestId('external-location')).toBeInTheDocument();
    });
  });

  describe('in a memo', () => {
    it('shows an entry that is stored externally like a step payload', async () => {
      await render(
        <MemoView memo={{ customer: 'acme', report: reference } as any} />,
      );
      expect(screen.getByText('report')).toBeInTheDocument();
      expect(screen.getByTestId('external-location')).toHaveTextContent(
        `s3://payloads/${external.key}`,
      );
      // The other entries stay JSON, and the reference is not dumped as JSON.
      expect(screen.getByText('{"customer":"acme"}')).toBeInTheDocument();
      expect(screen.queryByText(/"external"/)).toBeNull();
    });

    it.each([
      ['another encoding', { encoding: 'json/plain', external }],
      ['another key', { ...reference, value: 1 }],
      [
        'another store',
        { encoding: 'json/protobuf', external: { ...external, store: 'gcs' } },
      ],
      [
        'another field',
        {
          encoding: 'json/protobuf',
          external: { ...external, url: 'https://x.example.com' },
        },
      ],
      [
        'a SHA-256 that is not hex',
        {
          encoding: 'json/protobuf',
          external: { ...external, sha256: 'z'.repeat(64) },
        },
      ],
      [
        'a size that is not a whole number',
        { encoding: 'json/protobuf', external: { ...external, size: 1.5 } },
      ],
      [
        'an empty bucket',
        { encoding: 'json/protobuf', external: { ...external, bucket: '' } },
      ],
    ])(
      'shows a JSON entry that looks like a reference with %s as JSON, without a link',
      async (_, value) => {
        await render(<MemoView memo={{ report: value } as any} />, {
          externalStorage: {
            objectUrl: 'https://console.example.com/s3/{bucket}?prefix={key}',
          },
        });
        expect(screen.queryByTestId('external-payload')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
        expect(document.querySelector('pre')).toHaveTextContent('"report"');
      },
    );

    it('shows a memo without references as JSON', async () => {
      await render(<MemoView memo={{ customer: 'acme' }} />);
      expect(screen.getByText('{"customer":"acme"}')).toBeInTheDocument();
      expect(screen.queryByTestId('external-payload')).toBeNull();
    });
  });
});
