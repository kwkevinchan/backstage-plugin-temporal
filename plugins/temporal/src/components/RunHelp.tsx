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

import { useId } from 'react';
import { ButtonIcon, Tooltip, TooltipTrigger } from '@backstage/ui';
import { RiInformationLine } from '@remixicon/react';
import { tp } from './styles';

/** What a run of a workflow that continues as new is, in one sentence. */
export const RUN_HELP =
  'This workflow continued as new: long workflows restart as a new run ' +
  '(same Workflow ID, new Run ID) to keep their history small.';

/**
 * An info button that explains runs of a workflow that continues as new.
 * The text shows as a tooltip on hover and keyboard focus, and screen
 * readers read it as the description of the button.
 */
export function RunHelp() {
  const id = useId();
  return (
    <span className={tp('tp-help')}>
      <TooltipTrigger delay={200}>
        <ButtonIcon
          size="small"
          variant="tertiary"
          icon={<RiInformationLine aria-hidden />}
          aria-label="About runs"
          aria-describedby={id}
          data-testid="run-help"
        />
        <Tooltip>{RUN_HELP}</Tooltip>
      </TooltipTrigger>
      <span id={id} hidden>
        {RUN_HELP}
      </span>
    </span>
  );
}
