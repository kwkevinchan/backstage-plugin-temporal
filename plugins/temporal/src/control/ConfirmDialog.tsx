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
import type { TemporalWorkflowExtensionProps } from '../extensions';
import {
  ControlError,
  controlError,
  ControlErrorAlert,
} from '../components/messages/shared';

/**
 * Asks before an operation on a workflow or a schedule, with a reason when
 * the operation takes one, and shows the error of an operation that fails.
 */
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
