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
import { ButtonIcon } from '@backstage/ui';
import { RiCheckLine, RiFileCopyLine } from '@remixicon/react';

/** Copies text to the clipboard and shows a check mark for a moment when it worked. */
export function CopyButton(props: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ButtonIcon
      size="small"
      variant="tertiary"
      aria-label={props.label ?? 'Copy'}
      icon={copied ? <RiCheckLine /> : <RiFileCopyLine />}
      onPress={async () => {
        try {
          await window.navigator.clipboard.writeText(props.text);
        } catch {
          // Not allowed or no clipboard: show no check mark.
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
