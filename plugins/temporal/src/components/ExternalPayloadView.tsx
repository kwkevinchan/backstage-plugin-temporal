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

import { ReactNode, useEffect, useState } from 'react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useApiHolder } from '@backstage/core-plugin-api';
import { Button, Flex, Text } from '@backstage/ui';
import type { ExternalPayload } from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  temporalApiRef,
  TemporalWorkflowContextValue,
  useTemporalWorkflow,
} from '../extensions';
import {
  RiCloudLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiImageLine,
} from '@remixicon/react';
import { tp } from './styles';

/** Images up to this size are shown as a thumbnail (8 MiB). */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/** `1536` becomes `1.5 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number(value.toFixed(value < 10 ? 1 : 0))} ${units[unit]}`;
}

function fileName(external: ExternalPayload): string {
  const ext: Record<string, string> = {
    'application/json': 'json',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  return `payload-${external.sha256.slice(0, 16)}.${
    ext[external.contentType] ?? 'bin'
  }`;
}

/** The workflow of the details page, or undefined outside of it. */
function useOptionalWorkflow(): TemporalWorkflowContextValue | undefined {
  try {
    // The hook reads a context and throws when there is none.
    return useTemporalWorkflow();
  } catch {
    return undefined;
  }
}

/**
 * Downloads the data of a payload through the backend, or undefined when
 * it cannot be downloaded here.
 */
function useDownload(external: ExternalPayload) {
  const api = useApiHolder().get(temporalApiRef);
  const context = useOptionalWorkflow();
  if (!external.downloadable || !context || !api?.downloadPayload) {
    return undefined;
  }
  const { workflow, entity } = context;
  const ref = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  return () =>
    api.downloadPayload!(ref, { key: external.key, entityRef: entityRef });
}

function Thumbnail(props: { load: () => Promise<Blob>; alt: string }) {
  const { load } = props;
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    load().then(
      blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Loaded once per payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (failed) {
    return (
      <Text as="p" variant="body-x-small" color="secondary">
        The image could not be loaded.
      </Text>
    );
  }
  if (!url) {
    return (
      <Text as="p" variant="body-x-small" color="secondary">
        Loading image…
      </Text>
    );
  }
  return (
    <img
      src={url}
      alt={props.alt}
      className={tp('tp-thumbnail')}
      data-testid="payload-thumbnail"
    />
  );
}

function DownloadButton(props: {
  external: ExternalPayload;
  load: () => Promise<Blob>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Flex align="center" gap="2">
      <Button
        size="small"
        variant="secondary"
        iconStart={<RiDownloadLine />}
        isDisabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const blob = await props.load();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName(props.external);
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Downloading…' : 'Download'}
      </Button>
      {error && (
        <Text variant="body-x-small" color="danger">
          {error}
        </Text>
      )}
    </Flex>
  );
}

function stateText(external: ExternalPayload): string {
  switch (external.state) {
    case 'unconfigured':
      return 'Stored in External Storage (S3 is not configured in Backstage)';
    case 'error':
      return 'Stored in S3, could not be read';
    default:
      return 'Stored in S3';
  }
}

/**
 * A payload stored in S3: an icon, the size and type, a preview of text,
 * a thumbnail of images and a download button. With `children` (the
 * decoded value of a payload shown inline), the value comes first.
 */
export function ExternalPayloadView(props: {
  external: ExternalPayload;
  children?: ReactNode;
}) {
  const { external } = props;
  const download = useDownload(external);
  const isImage = /^image\/(png|jpeg|gif|webp)$/.test(external.contentType);
  let Icon = isImage ? RiImageLine : RiCloudLine;
  if (external.state === 'error') Icon = RiErrorWarningLine;
  return (
    <div className={tp('tp-external')} data-testid="external-payload">
      {props.children}
      <Flex align="center" gap="2" style={{ flexWrap: 'wrap' }}>
        <Icon size={16} aria-hidden />
        <Text variant="body-small">{stateText(external)}</Text>
        <Text variant="body-small" color="secondary">
          {formatBytes(external.size)}
          {external.contentType ? ` · ${external.contentType}` : ''}
        </Text>
      </Flex>
      {external.error && (
        <Text as="p" variant="body-x-small" color="danger">
          {external.error}
        </Text>
      )}
      {external.preview !== undefined && (
        <pre className={tp('tp-pre')} data-testid="payload-preview">
          {external.preview}
          {external.previewTruncated ? '…' : ''}
        </pre>
      )}
      {isImage &&
        download &&
        external.state === 'preview' &&
        external.size <= MAX_THUMBNAIL_BYTES && (
          <Thumbnail load={download} alt={`Image ${external.key}`} />
        )}
      {(external.state === 'unconfigured' || external.state === 'error') && (
        <Text
          as="p"
          variant="body-x-small"
          color="secondary"
          style={{ wordBreak: 'break-all' }}
        >
          s3://{external.bucket}/{external.key} · SHA-256 {external.sha256}
        </Text>
      )}
      {download && <DownloadButton external={external} load={download} />}
    </div>
  );
}
