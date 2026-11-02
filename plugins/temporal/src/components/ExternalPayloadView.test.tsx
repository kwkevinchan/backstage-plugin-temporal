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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import type { ExternalPayload } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  temporalApiRef,
  TemporalWorkflowProvider,
} from '@kwkevinchan/backstage-plugin-temporal-react';
import { formatBytes } from './ExternalPayloadView';
import { PayloadView } from './PayloadView';

const base: ExternalPayload = {
  store: 's3',
  bucket: 'payloads',
  key: 'tp/default/wf-1/abc',
  size: 1048576,
  sha256: 'a'.repeat(64),
  encoding: 'json/plain',
  contentType: 'application/json',
  state: 'preview',
  preview: '{"rows":[1,2',
  previewTruncated: true,
  downloadable: true,
};

const workflow = {
  namespace: 'default',
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowType: 'reportWorkflow',
  status: 'Completed' as const,
};

function renderWithApi(payload: unknown, downloadPayload = jest.fn()) {
  render(
    <TestApiProvider apis={[[temporalApiRef, { downloadPayload } as any]]}>
      <TemporalWorkflowProvider
        value={{ workflow, entity: undefined, reload: () => {} } as any}
      >
        <PayloadView payload={payload as any} />
      </TemporalWorkflowProvider>
    </TestApiProvider>,
  );
  return downloadPayload;
}

describe('payloads stored in S3', () => {
  beforeAll(() => {
    (URL as any).createObjectURL = jest.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = jest.fn();
    // jsdom does not navigate.
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  it('formats sizes', () => {
    expect(formatBytes(10)).toBe('10 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
  });

  it('shows size, preview and a download button', async () => {
    const download = renderWithApi(
      { encoding: 'json/claim-check', external: base },
      jest.fn(async () => new Blob(['{}'])),
    );
    expect(screen.getByText('Stored in S3')).toBeInTheDocument();
    expect(screen.getByText('1 MB · application/json')).toBeInTheDocument();
    expect(screen.getByTestId('payload-preview')).toHaveTextContent(
      '{"rows":[1,2…',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        { namespace: 'default', workflowId: 'wf-1', runId: 'run-1' },
        { key: base.key, entityRef: undefined },
      ),
    );
  });

  it('shows the value of payloads shown inline', () => {
    renderWithApi({
      encoding: 'json/plain',
      value: { rows: [1] },
      external: { ...base, state: 'inline', size: 2048, preview: undefined },
    });
    expect(screen.getByText('{"rows":[1]}')).toBeInTheDocument();
    expect(screen.getByText('2 KB · application/json')).toBeInTheDocument();
  });

  it('shows images as a thumbnail', async () => {
    renderWithApi(
      {
        encoding: 'json/claim-check',
        external: {
          ...base,
          contentType: 'image/png',
          encoding: 'binary/plain',
          preview: undefined,
        },
      },
      jest.fn(async () => new Blob([new Uint8Array([1])])),
    );
    expect(await screen.findByTestId('payload-thumbnail')).toHaveAttribute(
      'src',
      'blob:x',
    );
  });

  it('shows the claim check when S3 is not configured', () => {
    render(
      <PayloadView
        payload={{
          encoding: 'json/claim-check',
          external: {
            ...base,
            state: 'unconfigured',
            preview: undefined,
            downloadable: undefined,
          },
        }}
      />,
    );
    expect(
      screen.getByText('Stored externally (S3 is not configured in Backstage)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`s3://payloads/${base.key} · SHA-256 ${base.sha256}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});
