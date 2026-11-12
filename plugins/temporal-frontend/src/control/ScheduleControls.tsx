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
import { stringifyEntityRef } from '@backstage/catalog-model';
import type { TemporalScheduleActionProps } from '../extensions';
import { PermissionButton } from '../components/messages/MessageDialog';
import {
  temporalWorkflowStartPermission,
  TemporalScheduleOperation,
} from '../common';
import { useApi } from '@backstage/core-plugin-api';
import { temporalControlApiRef } from './api';
import { useControlEnabled } from './config';
import { ConfirmDialog } from './WorkflowControls';

const TEXT: Record<
  TemporalScheduleOperation,
  { label: string; title: string; description: string; confirm: string }
> = {
  pause: {
    label: 'Pause',
    title: 'Pause this schedule?',
    description:
      'It starts no workflows until it is resumed. Workflows it already started keep running.',
    confirm: 'Pause',
  },
  unpause: {
    label: 'Resume',
    title: 'Resume this schedule?',
    description: 'It starts workflows again at its next times.',
    confirm: 'Resume',
  },
  trigger: {
    label: 'Run now',
    title: 'Start a workflow of this schedule now?',
    description:
      'The schedule starts one workflow now, as at one of its times, with its overlap policy.',
    confirm: 'Run now',
  },
};

/**
 * "Pause" or "Resume", and "Run now", on a schedule. They need
 * `temporal.workflow.start`.
 */
function ScheduleControlsContent(props: TemporalScheduleActionProps) {
  const { schedule, entity, reload } = props;
  const api = useApi(temporalControlApiRef);
  const [open, setOpen] = useState<TemporalScheduleOperation>();
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const operations: TemporalScheduleOperation[] = [
    schedule.paused ? 'unpause' : 'pause',
    'trigger',
  ];
  return (
    <>
      {operations.map(operation => (
        <PermissionButton
          key={operation}
          label={TEXT[operation].label}
          permission={temporalWorkflowStartPermission}
          resourceRef={entityRef}
          onPress={() => setOpen(operation)}
        />
      ))}
      {open && (
        <ConfirmDialog
          title={TEXT[open].title}
          description={TEXT[open].description}
          confirm={TEXT[open].confirm}
          dismiss="Close"
          onClose={() => setOpen(undefined)}
          onConfirm={async () => {
            await api.runScheduleOperation(
              {
                namespace: schedule.namespace,
                scheduleId: schedule.scheduleId,
              },
              open,
              undefined,
              { entityRef },
            );
            reload();
            // The schedule list catches up a moment later.
            setTimeout(reload, 1500);
          }}
        />
      )}
    </>
  );
}

/**
 * "Pause" or "Resume", and "Run now", on a schedule. Renders nothing when `temporal.control.enabled` is false.
 */
export function ScheduleControls(props: TemporalScheduleActionProps) {
  return useControlEnabled() ? <ScheduleControlsContent {...props} /> : null;
}
