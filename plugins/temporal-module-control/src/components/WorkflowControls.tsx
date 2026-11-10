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
import type { WorkflowHandler } from '@kwkevinchan/backstage-plugin-temporal-common';
import { stringifyEntityRef } from '@backstage/catalog-model';
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
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal';
import {
  controlError,
  ErrorAlert,
  MessageDialog,
  MessageDialogText,
  PermissionButton,
  useWorkflowHandlers,
} from '@kwkevinchan/backstage-plugin-temporal/ui';
import { SchemaArgsField } from './SchemaArgsField';
import {
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import { useTemporalControlApi } from '../api';
import { useControlConfig } from './config';

type MessageKind = 'signal' | 'update';
type Open = MessageKind | 'cancel' | 'terminate' | 'rerun' | undefined;

const MESSAGE_TEXT: Record<MessageKind, MessageDialogText> = {
  signal: {
    label: 'Signal name',
    done: 'Signal',
    doneSuffix: ' sent',
    title: 'Send a signal',
    submit: 'Send signal',
    help: 'The workflow gets the signal the next time it runs; there is no result.',
  },
  update: {
    label: 'Update name',
    done: 'Update',
    doneSuffix: ' done',
    title: 'Send an update',
    submit: 'Send update',
    help: 'The workflow handles the update and returns a result, or rejects it.',
  },
};

/** Asks before cancel, terminate (with a reason) or rerun. */
function ConfirmDialog(props: {
  title: string;
  description: string;
  confirm: string;
  /** Label of the button that closes the dialog. */
  dismiss: string;
  destructive?: boolean;
  /** Ask for a reason, required. */
  reason?: boolean;
  onConfirm(reason: string): Promise<void>;
  onClose(): void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const confirm = async () => {
    setPending(true);
    setError(undefined);
    try {
      await props.onConfirm(reason.trim());
      props.onClose();
    } catch (e) {
      setError(controlError(e));
      setPending(false);
    }
  };
  return (
    <Dialog isOpen onOpenChange={open => !open && props.onClose()} width={480}>
      <DialogHeader>{props.title}</DialogHeader>
      <DialogBody>
        <Flex direction="column" gap="3">
          <Text variant="body-medium">{props.description}</Text>
          {props.reason && (
            <TextField
              label="Reason"
              value={reason}
              onChange={setReason}
              isRequired
            />
          )}
          {error && <ErrorAlert error={error} />}
        </Flex>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" slot="close">
          {props.dismiss}
        </Button>
        <Button
          variant="primary"
          destructive={props.destructive}
          isPending={pending}
          isDisabled={props.reason && !reason.trim()}
          onPress={confirm}
        >
          {props.confirm}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * The operations on a workflow in the action bar of the details page:
 * signal, update, cancel and terminate while it runs; rerun once it is
 * closed. Each button is disabled when the user does not have its
 * permission on the workflow's entity.
 */
export function WorkflowControls(props: TemporalWorkflowExtensionProps) {
  const { workflow, entity, reload } = props;
  const api = useTemporalControlApi();
  const navigate = useNavigate();
  const config = useControlConfig();
  const [open, setOpen] = useState<Open>();
  const running = workflow.status === 'Running';
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const resourceRef = entityRef ?? workflow.entityRef;
  const ref = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
  const handlers = useWorkflowHandlers(
    ref,
    entityRef,
    open === 'signal' || open === 'update',
  );
  const close = () => setOpen(undefined);

  const messageOptions = (kind: MessageKind): [WorkflowHandler[], boolean] => {
    const defined =
      (kind === 'signal' ? handlers?.signals : handlers?.updates) ?? [];
    const allowed =
      kind === 'signal' ? config.allowedSignals : config.allowedUpdates;
    if (allowed.length > 0) {
      // Only the configured names, with what the workflow tells of them.
      return [
        allowed.map(name => defined.find(h => h.name === name) ?? { name }),
        false,
      ];
    }
    return [defined, true];
  };

  return (
    <>
      {running && (
        <>
          <PermissionButton
            label="Signal…"
            permission={temporalWorkflowSignalPermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('signal')}
          />
          <PermissionButton
            label="Update…"
            permission={temporalWorkflowUpdatePermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('update')}
          />
          <PermissionButton
            label="Cancel"
            permission={temporalWorkflowCancelPermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('cancel')}
          />
          <PermissionButton
            label="Terminate"
            destructive
            permission={temporalWorkflowTerminatePermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('terminate')}
          />
        </>
      )}
      {!running && (
        <PermissionButton
          label="Rerun"
          permission={temporalWorkflowRerunPermission}
          resourceRef={resourceRef}
          onPress={() => setOpen('rerun')}
        />
      )}

      {(open === 'signal' || open === 'update') && (
        <MessageDialog
          key={open}
          kind={open}
          text={MESSAGE_TEXT[open]}
          handlers={messageOptions(open)[0]}
          allowsCustomValue={messageOptions(open)[1]}
          argsField={SchemaArgsField}
          showResult={open === 'update'}
          send={async request => {
            let result = {};
            if (open === 'signal') {
              await api.signalWorkflow(ref, request, { entityRef });
            } else {
              result = await api.updateWorkflow(ref, request, { entityRef });
            }
            reload();
            return result;
          }}
          onClose={close}
        />
      )}
      {open === 'cancel' && (
        <ConfirmDialog
          title="Cancel this workflow?"
          description="The workflow is asked to cancel. It can clean up before it closes, or ignore the request."
          confirm="Cancel workflow"
          dismiss="Keep running"
          onClose={close}
          onConfirm={async () => {
            await api.cancelWorkflow(ref, { entityRef });
            reload();
          }}
        />
      )}
      {open === 'terminate' && (
        <ConfirmDialog
          title="Terminate this workflow?"
          description="The workflow stops at once, without running any more code. The reason is kept in its history."
          confirm="Terminate"
          dismiss="Keep running"
          destructive
          reason
          onClose={close}
          onConfirm={async reason => {
            await api.terminateWorkflow(ref, { reason }, { entityRef });
            reload();
          }}
        />
      )}
      {open === 'rerun' && (
        <ConfirmDialog
          title="Run this workflow again?"
          description="A new workflow starts with the input, type, task queue and search attributes of this run, under a new workflow ID. This run stays as it is."
          confirm="Rerun"
          dismiss="Close"
          onClose={close}
          onConfirm={async () => {
            const started = await api.rerunWorkflow(ref, {}, { entityRef });
            if (props.workflowHref) navigate(props.workflowHref(started));
            else reload();
          }}
        />
      )}
    </>
  );
}
