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

import { Alert, Skeleton, Flex } from '@backstage/ui';

/** An error from the backend, with its message. */
export function ErrorAlert(props: { error: Error; title?: string }) {
  const { error } = props;
  return (
    <Alert
      status="danger"
      icon
      title={props.title ?? error.message}
      description={props.title ? error.message : undefined}
      data-testid="temporal-error"
    />
  );
}

/** Placeholder rows while data loads. */
export function Loading(props: { rows?: number; label?: string }) {
  return (
    <Flex
      direction="column"
      gap="2"
      role="progressbar"
      aria-label={props.label ?? 'Loading'}
    >
      {Array.from({ length: props.rows ?? 3 }, (_, i) => (
        <Skeleton key={i} width="100%" height={20} />
      ))}
    </Flex>
  );
}
