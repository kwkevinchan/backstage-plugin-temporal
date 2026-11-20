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

import {
  NamespaceNotFoundError,
  ScheduleNotFoundError,
  ServiceError,
} from '@temporalio/client';
import {
  mapChainCommandError,
  mapCommandError,
  mapConnectionError,
  mapTemporalError,
} from './errors';

const grpc = (code: number) =>
  Object.assign(new Error(`code ${code}`), { code });

describe('mapTemporalError', () => {
  it.each([
    [5, 'NotFoundError'],
    [3, 'InputError'],
    [14, 'ServiceUnavailableError'],
    // The backend's own credentials were refused: not the user's fault.
    [7, 'ServiceUnavailableError'],
    [16, 'ServiceUnavailableError'],
    // No answer in time, and the backend's connection rate limited.
    [4, 'ServiceUnavailableError'],
    [8, 'ServiceUnavailableError'],
  ])('maps gRPC code %i to %s', (code, name) => {
    expect(() => mapTemporalError(grpc(code))).toThrow(
      expect.objectContaining({ name }),
    );
  });

  it('reads the gRPC error that the schedule client wraps', async () => {
    const wrapped = (code: number) =>
      new ServiceError('Failed to list schedules', {
        cause: Object.assign(new Error(`code ${code}`), {
          code,
          details: 'refused',
        }),
      });
    expect(() => mapTemporalError(wrapped(14))).toThrow(
      expect.objectContaining({
        name: 'ServiceUnavailableError',
        message: expect.stringContaining('Failed to list schedules: refused'),
      }),
    );
    expect(() => mapTemporalError(wrapped(16))).toThrow(
      expect.objectContaining({ name: 'ServiceUnavailableError' }),
    );
    expect(() =>
      mapTemporalError(new ScheduleNotFoundError('not found', 'nightly')),
    ).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
    expect(() =>
      mapTemporalError(new NamespaceNotFoundError('team-a')),
    ).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
  });

  it('says why Temporal did not answer', () => {
    expect(() => mapTemporalError(grpc(4))).toThrow(
      'Temporal did not answer in time: code 4',
    );
    expect(() => mapTemporalError(grpc(8))).toThrow(
      'Temporal is rate limiting the backend: code 8',
    );
  });

  it('keeps other errors', () => {
    const error = grpc(13);
    expect(() => mapTemporalError(error)).toThrow(error);
  });
});

describe('mapConnectionError', () => {
  it('maps a failed connection to a 503, like an unavailable server', () => {
    const failed = new ServiceError('Failed to connect to Temporal server', {
      cause: Object.assign(new Error('code 14'), {
        code: 14,
        details: 'connection refused',
      }),
    });
    expect(() => mapConnectionError(failed)).toThrow(
      expect.objectContaining({
        name: 'ServiceUnavailableError',
        message:
          'Temporal is not reachable: Failed to connect to Temporal server: connection refused',
      }),
    );
    expect(() => mapConnectionError(new Error('timed out'))).toThrow(
      expect.objectContaining({
        name: 'ServiceUnavailableError',
        message: 'Temporal is not reachable: timed out',
      }),
    );
  });
});

describe('mapCommandError', () => {
  it.each([
    // A workflow ID that is taken, or a workflow that is not running.
    [6, 'ConflictError'],
    [9, 'ConflictError'],
    [4, 'ServiceUnavailableError'],
    [5, 'NotFoundError'],
    [3, 'InputError'],
    [14, 'ServiceUnavailableError'],
    [7, 'ServiceUnavailableError'],
    [16, 'ServiceUnavailableError'],
    [8, 'ServiceUnavailableError'],
  ])('maps gRPC code %i to %s', (code, name) => {
    expect(() => mapCommandError(grpc(code))).toThrow(
      expect.objectContaining({ name }),
    );
  });

  it('reads the gRPC error that the schedule client wraps', () => {
    const wrapped = new ServiceError('Failed to pause schedule', {
      cause: Object.assign(new Error('code 9'), {
        code: 9,
        details: 'already paused',
      }),
    });
    expect(() => mapCommandError(wrapped)).toThrow(
      expect.objectContaining({
        name: 'ConflictError',
        message: 'Failed to pause schedule: already paused',
      }),
    );
    expect(() =>
      mapCommandError(new ScheduleNotFoundError('not found', 'nightly')),
    ).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
  });

  it('keeps other errors', () => {
    const error = grpc(13);
    expect(() => mapCommandError(error)).toThrow(error);
  });
});

describe('mapChainCommandError', () => {
  it('maps gRPC NOT_FOUND for an already completed chain to ConflictError', () => {
    const error = Object.assign(new Error('code 5'), {
      code: 5,
      details: 'workflow execution already completed',
    });
    expect(() => mapChainCommandError('wf-1', error)).toThrow(
      expect.objectContaining({
        name: 'ConflictError',
        message: 'Workflow wf-1 has already ended',
      }),
    );
  });

  it('maps gRPC NOT_FOUND for a different chain to ConflictError', () => {
    const error = Object.assign(new Error('code 5'), {
      code: 5,
      details: 'workflow execution not found',
    });
    expect(() => mapChainCommandError('wf-1', error)).toThrow(
      expect.objectContaining({
        name: 'ConflictError',
        message: 'Workflow wf-1 now belongs to a different execution chain',
      }),
    );
  });

  it('falls back to mapCommandError for non-NOT_FOUND errors', () => {
    expect(() => mapChainCommandError('wf-1', grpc(9))).toThrow(
      expect.objectContaining({ name: 'ConflictError' }),
    );
    expect(() => mapChainCommandError('wf-1', grpc(14))).toThrow(
      expect.objectContaining({ name: 'ServiceUnavailableError' }),
    );
    const other = grpc(13);
    expect(() => mapChainCommandError('wf-1', other)).toThrow(other);
  });
});
