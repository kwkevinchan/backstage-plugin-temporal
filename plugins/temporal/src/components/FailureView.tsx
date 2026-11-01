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

import type { WorkflowFailure } from '@kwkevinchan/backstage-plugin-temporal-common';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';

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
    <Box>
      {chain.map((f, i) => (
        <Box
          key={i}
          ml={i * 2}
          mb={1.5}
          pl={1.5}
          borderLeft={3}
          borderColor={i === 0 ? 'error.main' : 'divider'}
          data-testid="failure-level"
        >
          <Typography variant="caption" color="textSecondary">
            {i === 0 ? 'Failure' : 'Caused by'}
            {f.kind ? ` · ${f.kind}` : ''}
            {f.type ? ` · ${f.type}` : ''}
            {f.nonRetryable ? ' · non-retryable' : ''}
          </Typography>
          <Typography variant="body2" style={{ wordBreak: 'break-word' }}>
            {f.message || '(no message)'}
          </Typography>
          {f.stackTrace && (
            <details>
              <summary>
                <Typography variant="caption" component="span">
                  Stack trace
                </Typography>
              </summary>
              <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {f.stackTrace}
              </pre>
            </details>
          )}
        </Box>
      ))}
    </Box>
  );
}
