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

import type { WorkflowFailure } from '../common';
import { Text } from '@backstage/ui';
import { tp } from './styles';

function flatten(failure: WorkflowFailure): WorkflowFailure[] {
  const chain: WorkflowFailure[] = [];
  let current: WorkflowFailure | undefined = failure;
  while (current && chain.length < 50) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/** A failure and its cause chain, outermost first. */
export function FailureView(props: { failure: WorkflowFailure }) {
  const chain = flatten(props.failure);
  return (
    <div>
      {chain.map((f, i) => (
        <div
          key={i}
          className={tp('tp-failure')}
          data-first={i === 0}
          style={{ marginLeft: i * 12 }}
          data-testid="failure-level"
        >
          <Text as="p" variant="body-x-small" color="secondary">
            {i === 0 ? 'Failure' : 'Caused by'}
            {f.kind ? ` · ${f.kind}` : ''}
            {f.type ? ` · ${f.type}` : ''}
            {f.nonRetryable ? ' · non-retryable' : ''}
          </Text>
          <Text as="p" variant="body-small" style={{ wordBreak: 'break-word' }}>
            {f.message || '(no message)'}
          </Text>
          {f.stackTrace && (
            <details>
              <summary>
                <Text as="span" variant="body-x-small" color="secondary">
                  Stack trace
                </Text>
              </summary>
              <pre className={tp('tp-pre')}>{f.stackTrace}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
