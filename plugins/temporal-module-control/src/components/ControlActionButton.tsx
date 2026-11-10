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
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal';
import {
  controlError,
  ErrorAlert,
  JsonView,
  tp,
  useControlPermission,
  WithReason,
} from '@kwkevinchan/backstage-plugin-temporal/ui';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import { useTemporalControlApi } from '../api';

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
  /** The JSON body sent to the action. Defaults to no body. */
  body?: (workflow: WorkflowDetail) => JsonValue | undefined;
  /**
   * The permission of the backend action. When set, the button is disabled
   * for users who do not have it on the workflow's entity.
   */
  permission?: ResourcePermission<'catalog-entity'>;
}

type Outcome = { result?: JsonValue } | { error: Error };

function PermissionGate(props: {
  permission: ResourcePermission<'catalog-entity'>;
  resourceRef?: string;
  children(allowed: boolean): JSX.Element;
}) {
  const { allowed, loading } = useControlPermission(
    props.permission,
    props.resourceRef,
  );
  return (
    <WithReason
      reason={
        !allowed && !loading
          ? `You do not have permission for this action (${props.permission.name})`
          : undefined
      }
    >
      {props.children(allowed)}
    </WithReason>
  );
}

/**
 * A button that runs a custom action of the backend and shows its result.
 * With `confirm`, it asks first.
 */
export function ControlActionButton(
  props: TemporalWorkflowExtensionProps & {
    action: TemporalControlActionButtonOptions;
  },
) {
  const { action, workflow, entity } = props;
  const entityRef = entity ? stringifyEntityRef(entity) : undefined;
  const api = useTemporalControlApi();
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
        action.body?.(workflow),
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

  const button = (allowed: boolean) => (
    <Button
      variant="secondary"
      isPending={pending}
      isDisabled={!allowed}
      onPress={() => (action.confirm ? setConfirming(true) : run())}
    >
      {action.label}
    </Button>
  );

  return (
    <>
      {action.permission ? (
        <PermissionGate
          permission={action.permission}
          resourceRef={entityRef ?? workflow.entityRef}
        >
          {button}
        </PermissionGate>
      ) : (
        button(true)
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
                <ErrorAlert error={outcome.error} />
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
