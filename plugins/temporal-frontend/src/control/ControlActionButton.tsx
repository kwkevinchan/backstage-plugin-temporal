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
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Flex,
  Text,
} from '@backstage/ui';
import { temporalApiRef } from '../extensions';
import type { TemporalWorkflowExtensionProps } from '../extensions';
import {
  ControlError,
  controlError,
  ControlErrorAlert,
  PermissionButton,
} from '../components/messages/shared';
import { JsonView } from '../components/PayloadView';
import { tp } from '../components/styles';
import { useApi } from '@backstage/core-plugin-api';
import { useControlEnabled } from './config';

/**
 * A button on the workflow details page that runs a custom action of the
 * backend (`POST .../actions/:actionId`, added with
 * `temporalControlExtensionPoint.addControlAction()`). The page shows the
 * result or the error and reloads the workflow.
 *
 * @public
 */
export interface TemporalControlActionButtonOptions {
  /** ID of the backend action. */
  actionId: string;
  /** Button label. */
  label: string;
  /** When set, the page asks for confirmation with this text first. */
  confirm?: string;
  /**
   * The permission of the backend action. When set, the button is disabled
   * for users who do not have it on the workflow's entity.
   */
  permission?: ResourcePermission<'catalog-entity'>;
}

type Outcome = { result?: JsonValue } | { error: ControlError };

/**
 * A button that runs a custom action of the backend and shows its result.
 * With `confirm`, it asks first.
 */
function ControlActionButtonContent(
  props: TemporalWorkflowExtensionProps & {
    action: TemporalControlActionButtonOptions;
  },
) {
  const { action, workflow, entity } = props;
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const api = useApi(temporalApiRef);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  const run = async () => {
    setPending(true);
    try {
      const response = await api.runWorkflowAction(
        {
          namespace: workflow.namespace,
          workflowId: workflow.workflowId,
          runId: workflow.runId,
        },
        action.actionId,
        undefined,
        { entityRef },
      );
      setOutcome({ result: response.result });
      props.reload();
    } catch (error) {
      setOutcome({ error: controlError(error) });
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  const press = () => (action.confirm ? setConfirming(true) : run());

  return (
    <>
      {action.permission ? (
        <PermissionButton
          label={action.label}
          action="run"
          noun="this action"
          permission={action.permission}
          resourceRef={entityRef ?? workflow.entityRef}
          additionalResourceRef={workflow.workflowEntityRef}
          isPending={pending}
          onPress={press}
        />
      ) : (
        <Button variant="secondary" isPending={pending} onPress={press}>
          {action.label}
        </Button>
      )}
      {confirming && (
        <Dialog isOpen onOpenChange={open => !open && setConfirming(false)}>
          <DialogHeader>{action.label}</DialogHeader>
          <DialogBody>
            <Text variant="body-medium">{action.confirm}</Text>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" slot="close">
              Close
            </Button>
            <Button variant="primary" isPending={pending} onPress={run}>
              {action.label}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {outcome && (
        <Dialog isOpen onOpenChange={open => !open && setOutcome(undefined)}>
          <DialogHeader>{action.label}</DialogHeader>
          <DialogBody>
            <Flex
              direction="column"
              gap="3"
              data-testid="workflow-action-result"
            >
              {'error' in outcome ? (
                <ControlErrorAlert error={outcome.error} context={props} />
              ) : (
                <>
                  <Alert status="success" icon title="Done" />
                  {outcome.result !== undefined && (
                    <div className={tp('tp-dialog-result')}>
                      <JsonView value={outcome.result} open />
                    </div>
                  )}
                </>
              )}
            </Flex>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" slot="close">
              Close
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

/**
 * A button that runs a custom action of the backend. Renders nothing when `temporal.control.enabled` is false.
 */
export function ControlActionButton(
  props: TemporalWorkflowExtensionProps & {
    action: TemporalControlActionButtonOptions;
  },
) {
  return useControlEnabled() ? <ControlActionButtonContent {...props} /> : null;
}
