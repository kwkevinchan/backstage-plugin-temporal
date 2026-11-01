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

import { useState } from 'react';
import { Button } from '@backstage/ui';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal-react';

/** Example workflow action used by both development apps. */
export function CopyWorkflowIdAction(props: TemporalWorkflowExtensionProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onPress={async () => {
        await window.navigator.clipboard
          ?.writeText(props.workflow.workflowId)
          .catch(() => undefined);
        setCopied(true);
      }}
    >
      {copied ? 'Copied' : 'Copy workflow ID'}
    </Button>
  );
}
