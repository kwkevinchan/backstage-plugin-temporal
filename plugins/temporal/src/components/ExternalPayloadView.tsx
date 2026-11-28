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
import { ButtonLink, Flex, Text } from '@backstage/ui';
import { RiCloudLine, RiExternalLinkLine } from '@remixicon/react';
import type { ExternalPayload } from '../common';
import { CopyButton } from './CopyButton';
import { externalObjectUrl } from './externalStorage';
import { tp } from './styles';

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

/**
 * A payload that a worker stored in External Storage: where it is
 * (`s3://bucket/key`) and its SHA-256, with copy buttons. The data is not
 * shown. With `temporal.externalStorage.objectUrl` set, an Open link goes
 * to the object.
 */
export function ExternalPayloadView(props: { external: ExternalPayload }) {
  const { external } = props;
  const location = `${external.store}://${external.bucket}/${external.key}`;
  const config = useApi(configApiRef);
  const url = externalObjectUrl(
    config.getOptionalString('temporal.externalStorage.objectUrl'),
    external,
  );
  return (
    <div className={tp('tp-external')} data-testid="external-payload">
      <Flex align="center" gap="2" style={{ flexWrap: 'wrap' }}>
        <RiCloudLine size={16} aria-hidden />
        <Text variant="body-small">Stored in External Storage</Text>
        {external.size > 0 && (
          <Text variant="body-small" color="secondary">
            {formatBytes(external.size)}
          </Text>
        )}
        {url && (
          <ButtonLink
            variant="secondary"
            size="small"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            iconEnd={<RiExternalLinkLine />}
          >
            Open
          </ButtonLink>
        )}
      </Flex>
      <Flex align="center" gap="1">
        <Text
          variant="body-x-small"
          color="secondary"
          style={{ wordBreak: 'break-all' }}
          data-testid="external-location"
        >
          {location}
        </Text>
        <CopyButton text={location} label="Copy location" />
      </Flex>
      <Flex align="center" gap="1">
        <Text
          variant="body-x-small"
          color="secondary"
          style={{ wordBreak: 'break-all' }}
          data-testid="external-sha256"
        >
          SHA-256 {external.sha256}
        </Text>
        <CopyButton text={external.sha256} label="Copy SHA-256" />
      </Flex>
    </div>
  );
}
