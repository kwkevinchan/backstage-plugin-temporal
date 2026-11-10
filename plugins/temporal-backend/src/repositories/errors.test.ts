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

import { mapTemporalError } from './TemporalReadRepository';

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
  ])('maps gRPC code %i to %s', (code, name) => {
    expect(() => mapTemporalError(grpc(code))).toThrow(
      expect.objectContaining({ name }),
    );
  });

  it('keeps other errors', () => {
    const error = grpc(13);
    expect(() => mapTemporalError(error)).toThrow(error);
  });
});
