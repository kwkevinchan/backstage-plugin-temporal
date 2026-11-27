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
import { temporalApiRef } from '../extensions';
import type { TemporalWorkflowListActionProps } from '../extensions';
import {
  controlError,
  JsonArgsField,
  parseArgs,
  PermissionButton,
} from '../components/messages/shared';
import { ErrorAlert } from '../components/feedback';
import {
  getTemporalWorkflowExampleArgs,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
  getTemporalWorkflowSource,
  temporalWorkflowStartPermission,
  WorkflowRunRef,
} from '../common';
import { useApi } from '@backstage/core-plugin-api';
import { useControlEnabled } from './config';

function specOf(entity: Entity | undefined) {
  if (!entity) return undefined;
  try {
    return getTemporalWorkflowSource(entity);
  } catch {
    return undefined;
  }
}

function StartWorkflowDialog(props: {
  entity?: Entity;
  onClose(): void;
  onStarted(ref: WorkflowRunRef): void;
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
  // The entity gives what it names; the dialog asks for the rest: both for
  // the Temporal page, or for an entity whose source cannot be read, the
  // task queue for an entity that names none.
  const askType = !spec;
  const askQueue = !spec?.taskQueue;
  const typeError =
    askType && workflowType !== '' && !isValidWorkflowTypeName(workflowType);
  const queueError =
    askQueue && taskQueue !== '' && !isValidTaskQueueName(taskQueue);
  const ready =
    !('error' in parsed) &&
    (!askType || (workflowType !== '' && !typeError)) &&
    (!askQueue || (taskQueue !== '' && !queueError));

  const start = async () => {
    if (!ready || 'error' in parsed) return;
    setPending(true);
    setError(undefined);
    try {
      const started = await api.startWorkflow(
        {
          workflowId: workflowId.trim() || undefined,
          workflowType: askType ? workflowType : undefined,
          taskQueue: askQueue ? taskQueue : undefined,
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
          {spec && (
            <Text variant="body-small" color="secondary">
              Starts {spec.workflowTypes[0]}
              {spec.taskQueue ? ` on task queue ${spec.taskQueue}` : ''}.
            </Text>
          )}
          {askType && (
            <TextField
              label="Workflow type"
              value={workflowType}
              onChange={setWorkflowType}
              isRequired
              isInvalid={typeError}
            />
          )}
          {askQueue && (
            <TextField
              label="Task queue"
              description={
                spec ? 'The workflow does not name a task queue.' : undefined
              }
              value={taskQueue}
              onChange={setTaskQueue}
              isRequired
              isInvalid={queueError}
            />
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
 * starts that workflow, with the example input of the entity filled in; the
 * task queue is asked for when the entity names none. Without an entity (the
 * Temporal page) the workflow type and task queue are asked for. Opens the new workflow once it has started. A list action:
 * the list of a `TemporalWorkflow` entity and the Temporal page show it.
 */
function StartWorkflowButtonContent(props: TemporalWorkflowListActionProps) {
  const { entity } = props;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PermissionButton
        label="Start workflow"
        action="start"
        permission={temporalWorkflowStartPermission}
        resourceRef={entity ? stringifyEntityRef(entity) : undefined}
        variant="primary"
        size="small"
        iconStart={<RiPlayLine />}
        onPress={() => setOpen(true)}
      />
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

/**
 * "Start workflow" above a workflow list. Renders nothing when `temporal.control.enabled` is false.
 */
export function StartWorkflowButton(props: TemporalWorkflowListActionProps) {
  return useControlEnabled() ? <StartWorkflowButtonContent {...props} /> : null;
}
