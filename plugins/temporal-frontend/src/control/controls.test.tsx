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

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router-dom';
import type { Entity } from '@backstage/catalog-model';
import {
  configApiRef,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal';
import type { WorkflowDetail } from '@kwkevinchan/backstage-plugin-temporal-common';
import { TemporalControlApi, temporalControlApiRef } from './api';
import { StartWorkflowButton } from './components/StartWorkflow';
import { WorkflowControls } from './components/WorkflowControls';
import { ScheduleControls } from './components/ScheduleControls';
import { createTemporalControlActionDef } from './index';

// usePermission caches results across tests; this one answers from `denied`.
let denied: string[] = [];
jest.mock('@backstage/plugin-permission-react', () => ({
  usePermission: (input: { permission: { name: string } }) => ({
    loading: false,
    allowed: !denied.includes(input.permission.name),
  }),
}));

const failedWorkflow: WorkflowDetail = {
  namespace: 'default',
  workflowId: 'payment-1',
  runId: 'run-2',
  workflowType: 'paymentWorkflow',
  taskQueue: 'orders',
  status: 'Failed',
  startTime: '2026-01-01T11:00:00.000Z',
  closeTime: '2026-01-01T11:00:01.000Z',
  pendingActivities: [],
};
const running: WorkflowDetail = { ...failedWorkflow, status: 'Running' };
const ref = {
  namespace: running.namespace,
  workflowId: running.workflowId,
  runId: running.runId,
};
const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders', namespace: 'default' },
  spec: {},
};
const entityRef = 'component:default/orders';
const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
  },
};

function mockControlApi(): jest.Mocked<TemporalControlApi> {
  return {
    signalWorkflow: jest.fn().mockResolvedValue(undefined),
    updateWorkflow: jest.fn().mockResolvedValue({ result: 'ok' }),
    cancelWorkflow: jest.fn().mockResolvedValue(undefined),
    terminateWorkflow: jest.fn().mockResolvedValue(undefined),
    rerunWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'order-1-rerun-abc',
      runId: 'run-new',
    }),
    startWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'started-1',
      runId: 'run-started',
    }),
    runWorkflowAction: jest.fn().mockResolvedValue({ result: { ok: true } }),
    runScheduleOperation: jest.fn().mockResolvedValue(undefined),
  };
}

function Opened() {
  const { workflowId } = useParams();
  return <p>Opened {workflowId}</p>;
}

function render(
  element: JSX.Element,
  options?: { deny?: string[]; control?: object; handlers?: object },
) {
  const api = mockControlApi();
  const temporal = {
    getWorkflowHandlers: jest.fn().mockResolvedValue(
      options?.handlers ?? {
        signals: [{ name: 'addNote' }],
        updates: [],
        queries: [{ name: 'state' }],
      },
    ),
  };
  denied = options?.deny ?? [];
  return {
    api,
    temporal,
    ...renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalControlApiRef, api],
          [temporalApiRef, temporal as any],
          [
            identityApiRef,
            mockApis.identity({ userEntityRef: 'user:default/alice' }),
          ],
          [
            configApiRef,
            mockApis.config({
              data: { temporal: { control: options?.control ?? {} } },
            }),
          ],
        ]}
      >
        <Routes>
          <Route path="/" element={element} />
          <Route path="/wf/:workflowId" element={<Opened />} />
        </Routes>
      </TestApiProvider>,
    ),
  };
}

const href = (r: { workflowId: string }) => `/wf/${r.workflowId}`;

describe('WorkflowControls', () => {
  it('shows the operations of a running workflow', async () => {
    render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
    );
    for (const name of ['Signal…', 'Update…', 'Cancel']) {
      expect(await screen.findByRole('button', { name })).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: 'Terminate' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Rerun' })).toBeNull();
  });

  it('shows rerun for a closed workflow', async () => {
    render(
      <WorkflowControls
        workflow={failedWorkflow}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Rerun' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Signal…' })).toBeNull();
  });

  it('disables operations without permission and says why', async () => {
    render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
      { deny: ['temporal.workflow.terminate'] },
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled(),
    );
    expect(
      await screen.findByTitle(/You do not have permission to terminate/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('sends a signal with JSON arguments', async () => {
    const reload = jest.fn();
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={reload}
        workflowHref={href}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Signal…' }),
    );
    const name = await screen.findByRole('combobox', { name: /Signal name/ });
    await waitFor(() => expect(name).toHaveValue('addNote'));
    const args = screen.getByRole('textbox', { name: 'Arguments (JSON)' });
    await userEvent.clear(args);
    await userEvent.click(args);
    await userEvent.paste('["hello"');
    expect(screen.getByRole('button', { name: 'Send signal' })).toBeDisabled();
    await userEvent.paste(']');
    await userEvent.click(screen.getByRole('button', { name: 'Send signal' }));
    expect(await screen.findByText('Signal addNote sent')).toBeInTheDocument();
    expect(api.signalWorkflow).toHaveBeenCalledWith(
      ref,
      { name: 'addNote', args: ['hello'] },
      { entityRef },
    );
    expect(reload).toHaveBeenCalled();
  });

  it('fills the JSON field with the example of a described handler', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
      {
        handlers: {
          signals: [
            {
              name: 'addNote',
              description: 'Adds a note to the ticket',
              example: { text: 'hello', by: '' },
              userField: 'by',
            },
          ],
          updates: [],
          queries: [],
        },
      },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Signal…' }),
    );
    expect(
      await screen.findByText('Adds a note to the ticket'),
    ).toBeInTheDocument();
    const args = screen.getByRole('textbox', { name: 'Arguments (JSON)' });
    await waitFor(() =>
      expect(JSON.parse((args as HTMLTextAreaElement).value)).toEqual({
        text: 'hello',
        by: 'user:default/alice',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send signal' }));
    expect(await screen.findByText('Signal addNote sent')).toBeInTheDocument();
    expect(api.signalWorkflow).toHaveBeenCalledWith(
      ref,
      { name: 'addNote', args: [{ text: 'hello', by: 'user:default/alice' }] },
      { entityRef },
    );
  });

  it('shows a form for a handler with an input schema', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
      {
        handlers: {
          signals: [],
          updates: [
            {
              name: 'approve',
              inputSchema: {
                type: 'object',
                required: ['comment'],
                properties: {
                  approved: { type: 'boolean', title: 'Approved' },
                  comment: { type: 'string', title: 'Comment' },
                  by: { type: 'string', title: 'By' },
                },
              },
              example: { approved: false },
              userField: 'by',
            },
          ],
          queries: [],
        },
      },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update…' }),
    );
    expect(await screen.findByTestId('message-form')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Arguments (JSON)' }),
    ).toBeNull();
    const by = screen.getByRole('textbox', { name: 'By' });
    await waitFor(() => expect(by).toHaveValue('user:default/alice'));
    expect(by).toHaveAttribute('readonly');
    const send = screen.getByRole('button', { name: 'Send update' });
    // The comment is required.
    await waitFor(() => expect(send).toBeDisabled());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Approved' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /Comment/ }),
      'Looks good',
    );
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    expect(api.updateWorkflow).toHaveBeenCalledWith(
      ref,
      {
        name: 'approve',
        args: [
          { approved: true, comment: 'Looks good', by: 'user:default/alice' },
        ],
      },
      { entityRef },
    );
  });

  it('shows a form for a handler whose argument is a string', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
      {
        handlers: {
          signals: [
            {
              name: 'addNote',
              inputSchema: { type: 'string', title: 'Note', minLength: 1 },
              example: 'Called the customer',
            },
          ],
          updates: [],
          queries: [],
        },
      },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Signal…' }),
    );
    const note = await screen.findByRole('textbox', { name: /Note/ });
    // Not `root`: that is the ID of the element the app is mounted in.
    expect(note.id).not.toBe('root');
    expect(document.querySelectorAll(`[id="${note.id}"]`)).toHaveLength(1);
    await waitFor(() => expect(note).toHaveValue('Called the customer'));
    await userEvent.clear(note);
    await userEvent.type(note, 'Checked the tray');
    await userEvent.click(screen.getByRole('button', { name: 'Send signal' }));
    expect(await screen.findByText('Signal addNote sent')).toBeInTheDocument();
    expect(api.signalWorkflow).toHaveBeenCalledWith(
      ref,
      { name: 'addNote', args: ['Checked the tray'] },
      { entityRef },
    );
  });

  it('shows the result and the error of an update', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
      { control: { allowedUpdates: ['setPriority'] } },
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Update…' }),
    );
    const name = await screen.findByRole('combobox', { name: /Update name/ });
    expect(name).toHaveValue('setPriority');
    api.updateWorkflow.mockResolvedValueOnce({ result: { priority: 'high' } });
    await userEvent.click(screen.getByRole('button', { name: 'Send update' }));
    expect(
      await screen.findByTestId('workflow-update-result'),
    ).toHaveTextContent('priority');
    // A ResponseError: the backend's message is shown, not the status.
    api.updateWorkflow.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with 400 Bad Request'), {
        body: { error: { message: 'priority is invalid' } },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send update' }));
    expect(await screen.findByText('priority is invalid')).toBeInTheDocument();
  });

  it('terminates only with a reason', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={running}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Terminate' }),
    );
    await screen.findByRole('dialog');
    expect(
      screen.getAllByRole('button', { name: 'Terminate' }).at(-1),
    ).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: /Reason/ }),
      'stuck',
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Terminate' }).at(-1)!,
    );
    await waitFor(() =>
      expect(api.terminateWorkflow).toHaveBeenCalledWith(
        ref,
        { reason: 'stuck' },
        { entityRef },
      ),
    );
  });

  it('opens the new workflow after a rerun', async () => {
    const { api } = render(
      <WorkflowControls
        workflow={failedWorkflow}
        entity={entity}
        reload={jest.fn()}
        workflowHref={href}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Rerun' }));
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Rerun' }).at(-1)!,
    );
    expect(
      await screen.findByText('Opened order-1-rerun-abc'),
    ).toBeInTheDocument();
    expect(api.rerunWorkflow).toHaveBeenCalledWith(ref, {}, { entityRef });
  });
});

describe('without a registered control API', () => {
  it('calls the backend with its own client (legacy apps)', async () => {
    const fetch = jest.fn(async () => new Response('{}', { status: 200 }));
    denied = [];
    renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, mockApis.discovery()],
          [fetchApiRef, { fetch }],
          [configApiRef, mockApis.config()],
          [temporalApiRef, {} as any],
        ]}
      >
        <WorkflowControls
          workflow={running}
          entity={entity}
          reload={jest.fn()}
        />
      </TestApiProvider>,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel workflow' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String((fetch.mock.calls[0] as any[])[0])).toMatch(
      /\/workflows\/payment-1\/runs\/run-2\/cancel\?entityRef=component%3Adefault%2Forders$/,
    );
  });
});

describe('StartWorkflowButton', () => {
  it('starts a workflow of a TemporalWorkflow entity with its example input', async () => {
    const withInput = {
      ...workflowEntity,
      spec: { ...workflowEntity.spec, exampleInput: { orderId: 'o-1' } },
    };
    const { api } = render(
      <StartWorkflowButton entity={withInput} workflowHref={href} />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Start workflow' }),
    );
    expect(screen.getByRole('textbox', { name: 'Input (JSON)' })).toHaveValue(
      JSON.stringify([{ orderId: 'o-1' }], null, 2),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Workflow ID' }),
      'my-run',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Opened started-1')).toBeInTheDocument();
    expect(api.startWorkflow).toHaveBeenCalledWith(
      {
        workflowId: 'my-run',
        workflowType: undefined,
        taskQueue: undefined,
        args: [{ orderId: 'o-1' }],
      },
      { entityRef: 'temporalworkflow:default/order-workflow' },
    );
  });

  it('asks for the type and the task queue on the Workflows page', async () => {
    const { api } = render(<StartWorkflowButton workflowHref={href} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Start workflow' }),
    );
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: /Workflow type/ }),
      'jobWorkflow',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: /Task queue/ }),
      'jobs',
    );
    await userEvent.click(start);
    await waitFor(() =>
      expect(api.startWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowType: 'jobWorkflow',
          taskQueue: 'jobs',
          args: [],
        }),
        { entityRef: undefined },
      ),
    );
  });

  it('is disabled without the start permission', async () => {
    render(
      <StartWorkflowButton entity={workflowEntity} workflowHref={href} />,
      {
        deny: ['temporal.workflow.start'],
      },
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start workflow' }),
      ).toBeDisabled(),
    );
  });
});

describe('ControlActionButton', () => {
  it('runs a custom backend action and shows its result', async () => {
    const def = createTemporalControlActionDef({
      actionId: 'escalate',
      label: 'Escalate',
      body: w => ({ workflowId: w.workflowId }),
    });
    const reload = jest.fn();
    const Action = def.component;
    const { api } = render(
      <Action workflow={running} entity={entity} reload={reload} />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Escalate' }),
    );
    expect(
      await screen.findByTestId('workflow-action-result'),
    ).toHaveTextContent('ok');
    expect(api.runWorkflowAction).toHaveBeenCalledWith(
      ref,
      'escalate',
      { workflowId: running.workflowId },
      { entityRef },
    );
    expect(reload).toHaveBeenCalled();
    expect(def.id).toBe('escalate');
  });
});

describe('ScheduleControls', () => {
  const schedule = {
    namespace: 'default',
    scheduleId: 'nightly',
    workflowType: 'orderWorkflow',
    spec: ['every 1h'],
    paused: false,
    nextActionTimes: [],
    recentActions: [],
  };

  it('pauses a schedule after confirming, then reloads', async () => {
    const reload = jest.fn();
    const { api } = render(
      <ScheduleControls schedule={schedule} entity={entity} reload={reload} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(screen.getByText('Pause this schedule?')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause' }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.runScheduleOperation).toHaveBeenCalledWith(
      { namespace: 'default', scheduleId: 'nightly' },
      'pause',
      undefined,
      { entityRef },
    );
  });

  it('resumes a paused schedule and runs one now', async () => {
    const { api } = render(
      <ScheduleControls
        schedule={{ ...schedule, paused: true }}
        reload={jest.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Run now',
      }),
    );
    await waitFor(() =>
      expect(api.runScheduleOperation).toHaveBeenCalledWith(
        { namespace: 'default', scheduleId: 'nightly' },
        'trigger',
        undefined,
        { entityRef: undefined },
      ),
    );
  });

  it('is disabled without temporal.workflow.start', async () => {
    render(
      <ScheduleControls
        schedule={schedule}
        entity={entity}
        reload={jest.fn()}
      />,
      { deny: ['temporal.workflow.start'] },
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled(),
    );
  });
});
