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
import { useNavigate } from 'react-router-dom';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import {
  getTemporalWorkflowExampleArgs,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  parseTemporalWorkflowSpec,
  temporalWorkflowStartPermission,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Flex,
  Text,
  TextField,
} from '@backstage/ui';
import { RiPlayLine } from '@remixicon/react';
import { ErrorAlert } from '../feedback';
import {
  controlError,
  JsonArgsField,
  parseArgs,
  useControlConfig,
  useControlPermission,
  WithReason,
} from './shared';

function specOf(entity: Entity | undefined) {
  if (!entity) return undefined;
  try {
    return parseTemporalWorkflowSpec(entity);
  } catch {
    return undefined;
  }
}

function StartWorkflowDialog(props: {
  entity?: Entity;
  onClose(): void;
  onStarted(ref: Required<WorkflowRef>): void;
}) {
  const { entity } = props;
  const api = useApi(temporalApiRef);
  const spec = specOf(entity);
  const example = entity ? getTemporalWorkflowExampleArgs(entity) : undefined;
  const [workflowId, setWorkflowId] = useState('');
  const [workflowType, setWorkflowType] = useState('');
  const [taskQueue, setTaskQueue] = useState('');
  const [args, setArgs] = useState(
    example ? JSON.stringify(example, null, 2) : '[]',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const parsed = parseArgs(args);
  const typeError =
    !entity && workflowType !== '' && !isValidWorkflowTypeName(workflowType);
  const queueError =
    !entity && taskQueue !== '' && !isValidTaskQueueName(taskQueue);
  const ready =
    !('error' in parsed) &&
    (entity
      ? true
      : workflowType !== '' && taskQueue !== '' && !typeError && !queueError);

  const start = async () => {
    if (!ready || 'error' in parsed) return;
    setPending(true);
    setError(undefined);
    try {
      const started = await api.startWorkflow(
        {
          workflowId: workflowId.trim() || undefined,
          workflowType: entity ? undefined : workflowType,
          taskQueue: entity ? undefined : taskQueue,
          args: parsed.args,
        },
        { entityRef: entity ? stringifyEntityRef(entity) : undefined },
      );
      props.onStarted(started);
    } catch (e) {
      setError(controlError(e));
      setPending(false);
    }
  };

  return (
    <Dialog isOpen onOpenChange={open => !open && props.onClose()} width={560}>
      <DialogHeader>Start workflow</DialogHeader>
      <DialogBody>
        <Flex direction="column" gap="3">
          {spec ? (
            <Text variant="body-small" color="secondary">
              Starts {spec.workflowTypes[0]}
              {spec.taskQueue ? ` on task queue ${spec.taskQueue}` : ''}.
            </Text>
          ) : (
            <>
              <TextField
                label="Workflow type"
                value={workflowType}
                onChange={setWorkflowType}
                isRequired
                isInvalid={typeError}
              />
              <TextField
                label="Task queue"
                value={taskQueue}
                onChange={setTaskQueue}
                isRequired
                isInvalid={queueError}
              />
            </>
          )}
          <TextField
            label="Workflow ID"
            description="Leave empty to make one from the workflow type."
            value={workflowId}
            onChange={setWorkflowId}
          />
          <JsonArgsField label="Input (JSON)" value={args} onChange={setArgs} />
          {error && <ErrorAlert error={error} />}
        </Flex>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" slot="close">
          Close
        </Button>
        <Button
          variant="primary"
          isPending={pending}
          isDisabled={!ready}
          onPress={start}
        >
          Start
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * "Start workflow" with its dialog. With a `TemporalWorkflow` entity it
 * starts that workflow, with the example input of the entity filled in;
 * without one (the Workflows page) the workflow type and task queue are
 * asked for. Opens the new workflow once it has started.
 */
export function StartWorkflowButton(props: {
  entity?: Entity;
  /** Link of the details page of a workflow, relative to the list. */
  workflowHref(ref: Required<WorkflowRef>): string;
  size?: 'small' | 'medium';
}) {
  const { entity } = props;
  const config = useControlConfig();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { allowed, loading } = useControlPermission(
    temporalWorkflowStartPermission,
    entity ? stringifyEntityRef(entity) : undefined,
  );
  if (!config.enabled) return null;
  return (
    <>
      <WithReason
        reason={
          !allowed && !loading
            ? `You do not have permission to start this workflow (${temporalWorkflowStartPermission.name})`
            : undefined
        }
      >
        <Button
          variant="primary"
          size={props.size ?? 'small'}
          iconStart={<RiPlayLine />}
          isDisabled={!allowed}
          onPress={() => setOpen(true)}
        >
          Start workflow
        </Button>
      </WithReason>
      {open && (
        <StartWorkflowDialog
          entity={entity}
          onClose={() => setOpen(false)}
          onStarted={ref => {
            setOpen(false);
            navigate(props.workflowHref(ref));
          }}
        />
      )}
    </>
  );
}
