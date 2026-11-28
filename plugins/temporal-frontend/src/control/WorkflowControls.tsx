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

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowMessageDefinition } from '../common';
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
import { temporalApiRef } from '../extensions';
import type { TemporalWorkflowExtensionProps } from '../extensions';
import {
  ControlError,
  controlError,
  ControlErrorAlert,
  PermissionButton,
} from '../components/messages/shared';
import {
  MessageDialog,
  type MessageDialogText,
  useWorkflowMessageDefinitions,
} from '../components/messages/MessageDialog';
import {
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
} from '../common';
import { useApi } from '@backstage/core-plugin-api';
import { useControlConfig, useControlEnabled } from './config';

/** A new update ID; `crypto.randomUUID` needs a secure context. */
function newUpdateId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 0x3) | 0x8).toString(16);
  });
}

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
    help: 'Applies to the workflow’s current running execution (including if this run continues as new). The workflow handles the update and returns a result, or rejects it.',
  },
};

function messageText(
  kind: MessageKind,
  continuedAsNew: boolean,
): MessageDialogText {
  if (kind === 'signal') return MESSAGE_TEXT.signal;
  return {
    ...MESSAGE_TEXT.update,
    help: continuedAsNew
      ? 'This run already continued as new. The update is sent to the run of this workflow that is currently running, and returns its result or rejects it.'
      : MESSAGE_TEXT.update.help,
  };
}

/** Asks before cancel, terminate (with a reason) or rerun. */
export function ConfirmDialog(props: {
  title: string;
  description: string;
  confirm: string;
  /** Label of the button that closes the dialog. */
  dismiss: string;
  destructive?: boolean;
  /** Ask for a reason: required with `true`, or left out with `'optional'`. */
  reason?: boolean | 'optional';
  onConfirm(reason: string): Promise<void>;
  onClose(): void;
  /** The details page of the run, for the links of its errors. */
  context?: TemporalWorkflowExtensionProps;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ControlError>();
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
              label={
                props.reason === 'optional' ? 'Reason (optional)' : 'Reason'
              }
              value={reason}
              onChange={setReason}
              maxLength={1000}
              isRequired={props.reason === true}
            />
          )}
          {error && <ControlErrorAlert error={error} context={props.context} />}
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
          isDisabled={props.reason === true && !reason.trim()}
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
function WorkflowControlsContent(props: TemporalWorkflowExtensionProps) {
  const { workflow, entity, reload } = props;
  const api = useApi(temporalApiRef);
  const navigate = useNavigate();
  const config = useControlConfig();
  const [open, setOpen] = useState<Open>();
  const running = workflow.status === 'Running';
  const continuedAsNew = workflow.status === 'ContinuedAsNew';
  const canOperateChain = running || continuedAsNew;
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const resourceRef = entityRef ?? workflow.entityRef;
  const ref = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
  const messageDefinitions = useWorkflowMessageDefinitions(
    ref,
    entityRef,
    open === 'signal' || open === 'update',
  );
  // The update ID of the request being tried again: the same while the
  // name and the arguments stay as they are, so that a retry after a timeout
  // does not send a second update.
  const updateAttempt = useRef<{ request: string; updateId: string }>();
  const close = () => {
    updateAttempt.current = undefined;
    setOpen(undefined);
  };

  const messageOptions = (
    kind: MessageKind,
  ): [WorkflowMessageDefinition[], boolean] => {
    const defined =
      (kind === 'signal'
        ? messageDefinitions?.signals
        : messageDefinitions?.updates) ?? [];
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
        <PermissionButton
          label="Signal…"
          permission={temporalWorkflowSignalPermission}
          resourceRef={resourceRef}
          additionalResourceRef={workflow.workflowEntityRef}
          onPress={() => setOpen('signal')}
        />
      )}
      {canOperateChain && (
        <>
          <PermissionButton
            label="Update…"
            permission={temporalWorkflowUpdatePermission}
            resourceRef={resourceRef}
            additionalResourceRef={workflow.workflowEntityRef}
            onPress={() => {
              updateAttempt.current = undefined;
              setOpen('update');
            }}
          />
          <PermissionButton
            label="Cancel"
            permission={temporalWorkflowCancelPermission}
            resourceRef={resourceRef}
            additionalResourceRef={workflow.workflowEntityRef}
            onPress={() => setOpen('cancel')}
          />
          <PermissionButton
            label="Terminate"
            destructive
            permission={temporalWorkflowTerminatePermission}
            resourceRef={resourceRef}
            additionalResourceRef={workflow.workflowEntityRef}
            onPress={() => setOpen('terminate')}
          />
        </>
      )}
      {!running && (
        <PermissionButton
          label="Rerun"
          permission={temporalWorkflowRerunPermission}
          resourceRef={resourceRef}
          additionalResourceRef={workflow.workflowEntityRef}
          onPress={() => setOpen('rerun')}
        />
      )}

      {(open === 'signal' || open === 'update') && (
        <MessageDialog
          key={open}
          kind={open}
          text={messageText(open, continuedAsNew)}
          messageDefinitions={messageOptions(open)[0]}
          allowsCustomValue={messageOptions(open)[1]}
          showResult={open === 'update'}
          context={props}
          send={async request => {
            let result = {};
            if (open === 'signal') {
              await api.signalWorkflow(ref, request, { entityRef });
            } else {
              const key = JSON.stringify([request.name, request.args]);
              if (updateAttempt.current?.request !== key) {
                updateAttempt.current = {
                  request: key,
                  updateId: newUpdateId(),
                };
              }
              const { updateId } = updateAttempt.current;
              result = await api.updateWorkflow(
                ref,
                { ...request, updateId },
                { entityRef },
              );
              // Sent again, the same update would not run a second time.
              updateAttempt.current = undefined;
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
          description={
            continuedAsNew
              ? 'This run already continued as new. If this workflow still has a running run, cancellation is requested for it; it can clean up before it closes, or ignore the request. Nothing happens when the whole workflow has already ended.'
              : 'Asks the workflow’s current running execution to cancel (including if this run continues as new). It can clean up before it closes, or ignore the request.'
          }
          confirm="Cancel workflow"
          dismiss="Keep running"
          context={props}
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
          description={
            continuedAsNew
              ? 'This run already continued as new. Terminating stops the run of this workflow that is currently running at once, without running any more code. The reason is kept in its history.'
              : 'Stops the workflow’s current running execution at once (including if this run continues as new), without running any more code. The reason is kept in its history.'
          }
          confirm="Terminate"
          dismiss="Keep running"
          destructive
          reason
          context={props}
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
          context={props}
          onClose={close}
          onConfirm={async () => {
            const started = await api.rerunWorkflow(ref, {}, { entityRef });
            navigate(props.workflowHref(started));
          }}
        />
      )}
    </>
  );
}

/**
 * The operations on a workflow in the action bar of the details page. Renders nothing when `temporal.control.enabled` is false.
 */
export function WorkflowControls(props: TemporalWorkflowExtensionProps) {
  return useControlEnabled() ? <WorkflowControlsContent {...props} /> : null;
}
